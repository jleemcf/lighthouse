'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { presence, HEARTBEAT_MS, LOST_AFTER_MS, LAPSE_AFTER_MS } = require('../shift-presence');
const { cardFixture } = require('./card-fixture');
const { wait } = require('./helpers');
const iso = time => new Date(time).toISOString();

test('presence: one-minute heartbeat, lost at three minutes, off after twelve lost hours', () => {
  const time = Date.now();
  const board = { shift: { state: 'on', since: iso(time), heartbeat: { t: iso(time) } } };
  assert.equal(HEARTBEAT_MS, 60000);
  assert.equal(LOST_AFTER_MS, 180000);
  assert.equal(LAPSE_AFTER_MS, 43200000);
  assert.equal(presence(board, 'tools', time + LOST_AFTER_MS - 1).p, 'on');
  assert.equal(presence(board, 'tools', time + LOST_AFTER_MS).p, 'lost');
  assert.equal(presence(board, 'tools', time + LOST_AFTER_MS + LAPSE_AFTER_MS - 1).p, 'lost');
  assert.equal(presence(board, 'tools', time + LOST_AFTER_MS + LAPSE_AFTER_MS).p, 'off');
  board.instruments = { t: iso(time + 86400000) };
  board.shift.lastSeen = board.instruments.t;
  assert.equal(presence(board, 'tools', time + LOST_AFTER_MS).p, 'lost', 'helpers and posts cannot mask loss');
});

test('presence: old tools never become lost or lapsed; line mode retains its pulse rule', () => {
  const time = Date.now();
  const board = { shift: { state: 'on', since: iso(time - 3 * 86400000), lastSeen: iso(time - 3600000) } };
  for (const protocol of ['tools', 'lines']) {
    assert.equal(presence(board, protocol, time).p, 'stale');
    board.instruments = { t: iso(time) };
    assert.equal(presence(board, protocol, time).p, 'on');
    assert.equal(presence(board, protocol, time + 5 * 60000).p, 'stale');
    delete board.instruments;
  }
  board.shift.heartbeat = { t: iso(time - 3 * 86400000) };
  board.instruments = { t: iso(time) };
  assert.equal(presence(board, 'lines', time).p, 'on', 'a prior tools deployment does not change line mode');
});

test('presence: legacy no-signal shifts keep diagnostics, reminders and automatic overviews', async context => {
  for (const protocol of ['tools', 'lines']) {
    const old = iso(Date.now() - 5 * 3600000);
    const fixture = await cardFixture(
      context,
      {
        boards: {
          t: {
            id: 't',
            shift: { state: 'on', operator: 'operator', since: old, lastSeen: old, endedAt: old },
            instruments: {
              t: iso(Date.now() - 10 * 60000),
              gate: { t: iso(Date.now() - 30 * 60000), mode: 'on', failOpenSince: old },
            },
          },
        },
        cards: { 't-work': { id: 't-work', board: 't', title: 'Work', status: 'inflight', updatedAt: old } },
      },
      {
        boards: { t: { protocol, steward: true, access: { owner: 'owner', operator: 'operator' } } },
        tokens: {
          CAPTAIN: { name: 'owner', via: 'page' },
          STEWARD: { name: 'steward-t', via: 'api', mode: 'steward', board: 't' },
        },
        stewardClockMs: 20,
        staleSweepMs: 20,
        staleHours: { default: 0, held: 0, graceMin: 0 },
      },
    );
    await wait(120);
    const report = (await fixture.request('GET', '/api/boards/t/conduct', null, 'CAPTAIN')).body;
    assert.equal(report.shift, 'on', protocol);
    assert.equal(report.signals.outboxSilent, 1, protocol);
    assert.equal(report.signals.gateSilent, 1, protocol);
    assert.equal(report.signals.gateFailOpen, 1, protocol);
    assert.ok(report.signals.silenceMin >= 240, protocol);
    const state = (await fixture.request('GET', '/api/state', null, 'CAPTAIN')).body;
    assert.equal(state.stewardRequests.filter(request => request.kind === 'state').length, 1, protocol);
    assert.equal(state.boards.t.notes.filter(note => note.rule === 'stale').length, 1, protocol);
    const claim = await fixture.request('GET', '/api/steward/next', null, 'STEWARD');
    assert.ok(claim.body.job, protocol);
    assert.ok(claim.body.job.text.includes('Shift: stale.'), protocol);
  }
});

test('presence: lost suppresses automatic overviews and stale reminders; conduct agrees', async context => {
  const time = Date.now();
  const old = iso(time - 3600000);
  const fixture = await cardFixture(
    context,
    {
      boards: {
        t: {
          id: 't',
          shift: {
            state: 'on',
            operator: 'operator',
            since: old,
            lastSeen: iso(time),
            heartbeat: { t: old, session: 'gone' },
          },
          instruments: { t: iso(time) },
        },
      },
      cards: { 't-work': { id: 't-work', board: 't', title: 'Work', status: 'inflight', updatedAt: old } },
    },
    {
      boards: { t: { protocol: 'tools', steward: true, access: { owner: 'owner', operator: 'operator' } } },
      stewardClockMs: 20,
      staleSweepMs: 20,
      staleHours: { default: 0, held: 0, graceMin: 0 },
    },
  );
  await wait(120);
  const state = (await fixture.request('GET', '/api/state', null, 'CAPTAIN')).body;
  assert.equal(state.stewardRequests.filter(request => request.kind === 'state').length, 0);
  assert.equal(state.stewards.t.overviewNext, null);
  assert.equal((state.boards.t.notes || []).filter(note => note.rule === 'stale').length, 0);
  assert.equal((await fixture.request('GET', '/api/boards/t/conduct')).body.shift, 'lost');
  assert.equal((await fixture.request('POST', '/api/boards/t/heartbeat', { session: 'back' })).status, 200);
  assert.equal((await fixture.request('GET', '/api/boards/t/conduct')).body.shift, 'on');
});

test('presence: heartbeat is session-only and never starts an ended shift', async context => {
  const fixture = await cardFixture(context);
  assert.equal((await fixture.request('POST', '/api/boards/t/heartbeat', { session: 'live' }, 'LEGACY')).status, 403);
  assert.equal((await fixture.request('POST', '/api/boards/t/heartbeat', { session: 'live' })).status, 200);
  assert.equal((await fixture.request('GET', '/api/state')).body.boards.t.shift.state, 'off');
  await fixture.call('board_shift', { action: 'start' });
  await fixture.call('board_shift', { action: 'end' });
  await fixture.request('POST', '/api/boards/t/heartbeat', { session: 'live' });
  const board = (await fixture.request('GET', '/api/state')).body.boards.t;
  assert.equal(board.shift.state, 'off');
  assert.ok(board.shift.endedAt);
});

test('presence: a late heartbeat cannot revive a lapse; old kits remain on record', async context => {
  const old = iso(Date.now() - 3 * 86400000);
  const fixture = await cardFixture(context, {
    boards: {
      t: {
        id: 't',
        shift: {
          state: 'on',
          since: old,
          lastSeen: old,
          heartbeat: { t: old, session: 'gone' },
        },
      },
      lines: { id: 'lines', shift: { state: 'on', since: old, lastSeen: old } },
    },
  });
  await fixture.request('POST', '/api/boards/t/heartbeat', { session: 'late' });
  const boards = (await fixture.request('GET', '/api/state')).body.boards;
  assert.equal(boards.t.shift.state, 'off');
  assert.equal(boards.t.shift.endedBy, 'lapse');
  assert.equal(boards.lines.shift.state, 'on');
});

test('presence: lost holds pending automatic overviews, not a captain request', async context => {
  const old = iso(Date.now() - 3600000);
  const fixture = await cardFixture(
    context,
    {
      boards: { t: { id: 't', shift: { state: 'on', since: old, heartbeat: { t: old } } } },
      stewardRequests: {
        auto: {
          id: 'auto',
          board: 't',
          kind: 'state',
          by: 'board',
          state: 'pending',
          t: old,
          priority: 1,
          attempts: 0,
        },
        manual: {
          id: 'manual',
          board: 't',
          kind: 'state',
          by: 'owner',
          state: 'pending',
          t: old,
          priority: 2,
          attempts: 0,
        },
      },
    },
    {
      boards: { t: { protocol: 'tools', steward: true, access: { owner: 'owner', operator: 'operator' } } },
      tokens: {
        OPS: { name: 'operator', via: 'api', mode: 'tools' },
        STEWARD: { name: 'steward-t', via: 'api', mode: 'steward', board: 't' },
      },
    },
  );
  const claim = await fixture.request('GET', '/api/steward/next', null, 'STEWARD');
  assert.equal(claim.status, 200);
  assert.equal(claim.body.job.request, 'manual');
});
