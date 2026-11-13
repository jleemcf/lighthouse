'use strict';
// The card lifecycle shared by line, tool, legacy and CRM callers: queued, inflight, waiting, held and done.
// Callers own authorization; this module owns state writes and ask settlement, and returns refusals before mutation.
// No close may discard an open ask or outrun delivery of a staff answer; legacy replacements keep those obligations.
const STATES = new Set(['queued', 'inflight', 'waiting', 'held', 'done']);
const openAsks = card => (card.decisions || []).filter(decision => !decision.resolvedAt);

function crmCloseReason(card) {
  // A lane change is not evidence that staff received their answer, including after retries have stopped.
  const { state, failure } = card.crm || {};
  if (state === 'asked' || state === 'working')
    return (
      'Answer the staff question before closing: use board_reply (follow_up: true if already handled) or REPLY; ' +
      'use kind: declined if you will not answer.'
    );
  if (state === 'sending' || (state === 'failed' && failure?.retrying))
    return 'The staff answer has not reached the CRM. Wait for delivery before closing this card.';
  if (state === 'failed')
    return (
      'CRM answer delivery stopped. Send the answer again with board_reply(follow_up: true) or REPLY ' +
      'before closing.'
    );
  return null;
}

function validate(card) {
  if (card.status !== undefined && !STATES.has(card.status)) return 'Unknown card state.';
  if (!Array.isArray(card.decisions) || card.decisions.some(decision => !decision || typeof decision !== 'object'))
    return 'decisions must be a list of asks.';
  if (card.status === 'done' && crmCloseReason(card)) return crmCloseReason(card);
  if (card.status === 'done' && card.needsAction && !openAsks(card).length)
    return 'The captain must settle the legacy ask before this card can close.';
  if (card.status === 'done' && (openAsks(card).length || card.needsAction))
    return 'The card still has an open ask. Get it answered, or withdraw it, before closing.';
  return null;
}

function write(card, fields) {
  // Validate a candidate first so a refused move leaves the stored card untouched.
  const candidate = { ...card, ...fields };
  const reason = validate(candidate);
  if (reason) return { ok: false, reason };
  Object.assign(card, fields);
  return { ok: true, card };
}

function open(fields) {
  const card = { decisions: [], log: [], ...fields };
  const reason = validate(card);
  return reason ? { ok: false, reason } : { ok: true, card };
}

function move(card, state) {
  return write(card, state ? { status: state } : {});
}

function ask(card, decision, state) {
  return write(card, { decisions: [...(card.decisions || []), decision], status: state || 'waiting' });
}

function settle(card, decisions, resolution, { clearLegacy = false, state } = {}) {
  const selected = new Set(decisions.filter(decision => !decision.resolvedAt));
  const remaining = openAsks(card).filter(decision => !selected.has(decision));
  for (const decision of selected) Object.assign(decision, resolution);
  if ((clearLegacy || (selected.size && !remaining.length)) && card.needsAction) {
    card.needsAction = false;
    card.askSettledAt = resolution.resolvedAt;
  }
  if (state) move(card, state);
  // Settling the last ask resumes work; held and explicitly chosen lanes remain the caller's decision.
  else if (card.status === 'waiting' && !remaining.length && !card.needsAction) move(card, 'inflight');
  return selected.size;
}

function close(card, at) {
  const result = write(card, { status: 'done', closedAt: at });
  if (result.ok) result.completion = { event: 'task_finished', t: at };
  return result;
}

function reopen(card) {
  if (card.status === 'done') {
    card.status = 'inflight';
    delete card.closedAt;
  }
  return { ok: true, card };
}

function legacyWrite(existing, fields, replace) {
  const candidate = {
    decisions: [],
    log: [],
    ...(replace ? {} : existing),
    ...fields,
  };
  if (existing) {
    // Old full-card clients cannot erase newer CRM delivery state or silently drop an unresolved ask.
    if (existing.crm) candidate.crm = existing.crm;
    if (!Object.hasOwn(fields, 'decisions')) candidate.decisions = existing.decisions || [];
    if (!Object.hasOwn(fields, 'needsAction')) candidate.needsAction = existing.needsAction;
    if (Array.isArray(candidate.decisions))
      for (const decision of openAsks(existing))
        if (!candidate.decisions.some(next => next && next.id === decision.id))
          return { ok: false, reason: 'An open ask cannot be discarded. Settle or withdraw it first.' };
  }
  const result = open(candidate);
  if (result.ok && fields.status === 'done') return close(result.card, fields.updatedAt);
  return result;
}

module.exports = { STATES, openAsks, crmCloseReason, validate, open, move, ask, settle, close, reopen, legacyWrite };
