'use strict';
// Explicit shift edges: the operator starts or ends its own board; the board may end a session after a long loss.
// State is on/off, distinct from derived on/lost/stale presence. Heartbeats update evidence, never start a shift.
// Duplicate or chronologically older edges are ignored; shadow authorization is refused by the calling route.
const { presence, HEARTBEAT_MS } = require('./shift-presence');

function transition(ctx, board, action, by, time, endedBy = 'operator') {
  const store = typeof ctx.store === 'function' ? ctx.store() : ctx.store;
  const record = store.boards[board];
  const shift = record.shift || {};
  const state = action === 'start' ? 'on' : 'off';
  if (shift.state === state) return false;
  const previous = state === 'off' ? shift.since : shift.endedAt;
  const at = Date.parse(time),
    before = Date.parse(previous || '');
  // Line clocks have second precision: reject older seconds, but clamp same-second edges to the board's clock.
  if (Math.floor(at / 1000) < Math.floor(before / 1000)) return false;
  if (at < before) time = previous;
  record.shift = Object.assign(
    shift,
    state === 'on'
      ? { state, operator: by, since: time, lastSeen: time, endedAt: null, endedBy: null }
      : { state, operator: shift.operator || by, lastSeen: time, endedAt: time, endedBy },
  );
  if (state === 'on' && record.ownership?.enforced) record.shift.id = require('node:crypto').randomUUID();
  if (state === 'on') {
    // Reannounce unhandled staff questions so the returning operator sees work left during its absence.
    for (const message of Object.values(store.comments || {})) {
      if (message.board === board && message.kind === 'staff' && !message.handled)
        ctx.change('comment', message.id, 'crm', board);
    }
  }
  ctx.pushActivity(
    record,
    by +
      ': shift ' +
      (state === 'on' ? 'started' : 'ended') +
      (endedBy === 'lapse' ? ' (session lost for 12 hours)' : ''),
    time,
  );
  ctx.change('board', board, by, board);
  return true;
}

function touch(board, time) {
  const shift = board.shift || (board.shift = { state: 'off' });
  if (Date.parse(time) > (Date.parse(shift.lastSeen || '') || 0)) shift.lastSeen = time;
}

function heartbeat(ctx, board, session) {
  // Apply an already-earned lapse before recording new evidence; a heartbeat must not resurrect the old shift.
  sweep(ctx);
  const record = ctx.store.boards[board];
  const shift = record.shift || (record.shift = { state: 'off' });
  shift.heartbeat = { t: ctx.now(), session };
  ctx.save();
}

function sweep(ctx) {
  ctx.registry?.refresh();
  const time = Date.now();
  for (const [board, record] of Object.entries(ctx.store.boards)) {
    if (ctx.cfg.boards?.[board]?.lifecycle === 'archived') continue;
    if (ctx.handoff?.enabled(board) && ['draining', 'pickup'].includes(ctx.ownership.record(board).phase)) continue;
    const protocol = ctx.cfg.boards?.[board]?.protocol;
    const current = presence(record, protocol, time);
    if (current.lapsedAt) transition(ctx, board, 'end', 'board', new Date(current.lapsedAt).toISOString(), 'lapse');
  }
}

function validate(body) {
  // Only the explicit edge fields belong here; callers cannot smuggle heartbeat or lapse policy into the record.
  if (!body || typeof body !== 'object' || Array.isArray(body)) return false;
  if (!['on', 'off'].includes(body.state)) return false;
  if (Object.keys(body).some(key => !['state', 'operator', 'since'].includes(key))) return false;
  if (body.operator !== undefined && (typeof body.operator !== 'string' || body.operator.length > 120)) return false;
  return body.since === undefined || (typeof body.since === 'string' && Number.isFinite(Date.parse(body.since)));
}

function watch(ctx) {
  sweep(ctx);
  const timer = setInterval(() => sweep(ctx), HEARTBEAT_MS);
  timer.unref();
}

module.exports = { transition, touch, heartbeat, sweep, validate, watch };
