'use strict';
const crypto = require('node:crypto');

const fields = ['goal', 'nextStep', 'decisions', 'constraints', 'commitments', 'queue', 'relays', 'helpers', 'cursors'];
const statuses = ['fresh', 'stale', 'missing'];
function checkpoint(ctx, board, who, input, id) {
  const refuse = ctx.ownership.refuse;
  if (!input || input.version !== 1) refuse('checkpoint version 1 required', 400);
  const text = JSON.stringify(input);
  if (Buffer.byteLength(text) > 48000) refuse('checkpoint too large', 400);
  if (
    /Bearer\s|sk-(?:proj-)?[A-Za-z0-9_-]{12}|"(?:credential|token|password|secret|evidenceCapability)"\s*:/i.test(text)
  )
    refuse('checkpoints contain references, never credentials or secrets', 400);
  const context = {};
  for (const field of fields) {
    const value = input[field];
    if (!value || !statuses.includes(value.freshness) || !Object.hasOwn(value, 'value'))
      refuse('explicit freshness and value required: ' + field, 400);
    if (!Number.isSafeInteger(value.observedAt) || value.observedAt < 0 || value.observedAt > Date.now())
      refuse('valid observation time required: ' + field, 400);
    context[field] = structuredClone(value);
    if (value.freshness === 'fresh' && Date.now() - value.observedAt > 6 * 3600000) context[field].freshness = 'stale';
  }
  for (const field of ['goal', 'nextStep'])
    if (typeof context[field].value !== 'string') refuse(field + ' must be text', 400);
  for (const field of ['decisions', 'constraints', 'commitments', 'queue', 'relays', 'helpers', 'cursors'])
    if (!Array.isArray(context[field].value)) refuse(field + ' must be a reference list', 400);
  const referenceKeys = new Set([
    'id',
    'state',
    'hash',
    'originSessionId',
    'originEpoch',
    'ticket',
    'target',
    'position',
    'revision',
    'attemptId',
    'kind',
  ]);
  for (const field of ['queue', 'relays', 'helpers', 'cursors'])
    for (const item of context[field].value)
      if (
        !item ||
        typeof item.id !== 'string' ||
        !item.id ||
        item.id.length > 200 ||
        Object.entries(item).some(
          ([key, value]) =>
            !referenceKeys.has(key) || (value !== null && !['string', 'number', 'boolean'].includes(typeof value)),
        )
      )
        refuse(field + ' contains an invalid durable reference', 400);
  const original = ctx.handoff.data().bindings?.[board];
  const supplied = input.targetBinding;
  const binding = original || {
    id: supplied?.id || 'firstmate',
    installationId: who.sessionInstallationId,
    freshness: 'fresh',
  };
  const location = ctx.ownership.session(board, who.sessionId)?.location;
  if (
    ctx.handoff.recoveryEnabled(board) &&
    !binding.machineId &&
    who.sessionInstallationId === binding.installationId &&
    location?.targetId === binding.id &&
    location.targetInstallationId === binding.installationId
  ) {
    binding.machineId = location.machineId;
    binding.homeId = location.homeId;
    binding.routeHash = location.routeHash;
  }
  if (
    !binding ||
    (binding.freshness !== 'missing' && !ctx.ownership.validId(binding.id)) ||
    (binding.freshness !== 'missing' && !ctx.ownership.validId(binding.installationId)) ||
    !statuses.includes(binding.freshness)
  )
    refuse('original target binding and freshness required', 400);
  const cards = Object.values(ctx.store.cards).filter(card => card.board === board);
  const comments = Object.values(ctx.store.comments).filter(comment => comment.board === board);
  if (
    supplied?.freshness !== 'missing' &&
    supplied &&
    (supplied.id !== binding.id || supplied.installationId !== binding.installationId)
  )
    refuse('target migration is a separate owner decision', 409);
  return {
    version: 1,
    id,
    board,
    sessionId: who.sessionId,
    epoch: who.epoch,
    createdAt: Date.now(),
    boardRevision: ctx.store.seq,
    ...context,
    targetBinding: { ...binding },
    authoritative: {
      freshness: 'fresh',
      observedAt: Date.now(),
      owedIds: comments
        .filter(
          comment =>
            !comment.handled &&
            ['owner', 'staff', 'advice', 'coordinator'].includes(require('./comment-author')(ctx.cfg, comment)),
        )
        .map(comment => comment.id),
      cardIds: cards.filter(card => card.status !== 'done').map(card => card.id),
      openAskIds: cards
        .filter(card => card.status !== 'done')
        .flatMap(card =>
          (card.decisions || []).filter(ask => !ask.resolvedAt).map(ask => ({ cardId: card.id, id: ask.id })),
        ),
      authorityIds: Object.values(ctx.store.authorities || {})
        .filter(authority => authority.board === board)
        .map(authority => authority.id),
      relayTickets: Object.values(ctx.store.tickets || {})
        .filter(ticket => ticket.board === board)
        .map(ticket => ({ id: ticket.id, to: ticket.to, used: !!ticket.used, delivered: ticket.delivered ?? null })),
      stewardJobs: Object.values(ctx.store.stewardRequests || {})
        .filter(job => job.board === board && ['pending', 'running'].includes(job.state))
        .map(job => ({ id: job.id, state: job.state, attempt: job.attempts })),
    },
    completeness: fields
      .filter(field => context[field].freshness !== 'fresh')
      .concat(binding.freshness === 'fresh' ? [] : ['targetBinding']),
  };
}

function pending(ctx, board, checkpoint) {
  const effects = [...(ctx.handoff?.current(board)?.inheritedBlockers || [])];
  const ledger = ctx.dispatchLedger?.enabled(board) ? ctx.dispatchLedger.record(board) : null;
  const recovery = ctx.handoff?.current(board)?.recovery;
  const recoveryGapResolved = recovery && ledger?.inventories[recovery.gapId]?.resolved === true;
  const relaySettled = id => {
    if (!ledger) return false;
    const ticketId = id.replace(/^relay-result-/, '');
    const intentId = ctx.store.tickets?.[ticketId]?.ledgerIntentId || 'import-' + ctx.ownership.hash(id).slice(0, 40);
    return ['issued', 'delivered', 'quiesced', 'superseded'].includes(ledger.intents[intentId]?.state);
  };
  const blockers = [];
  for (const field of checkpoint?.completeness || ['checkpoint']) blockers.push('missing-or-stale:' + field);
  if (checkpoint && Date.now() - checkpoint.createdAt > 6 * 3600000) blockers.push('checkpoint-too-old');
  for (const item of checkpoint?.queue.value || [])
    if (!['acknowledged', 'rejected', 'superseded'].includes(ledger?.calls[item.id]?.disposition || item.state))
      effects.push('queue:' + item.id);
  for (const item of checkpoint?.relays.value || [])
    if (!['recorded', 'reconciled', 'undispatched'].includes(item.state) && !relaySettled(item.id))
      effects.push('relay:' + item.id);
  for (const field of ['queue', 'relays'])
    if (checkpoint && checkpoint[field].freshness !== 'fresh' && !recoveryGapResolved)
      effects.push('unknown-effects:' + field);
  for (const ticket of Object.values(ctx.store.tickets || {}))
    if (ticket.board === board && !ticket.used && !relaySettled('relay-result-' + ticket.id))
      effects.push('ticket:' + ticket.id);
  if (ctx.dispatchLedger?.enabled(board)) {
    const ledger = ctx.dispatchLedger.record(board);
    for (const intent of Object.values(ledger.intents))
      if (!['issued', 'delivered', 'quiesced', 'superseded'].includes(intent.state))
        effects.push('intent:' + intent.id);
    for (const inventory of Object.values(ledger.inventories))
      if (!inventory.complete && !inventory.resolved) effects.push('import-gap:' + inventory.id);
    for (const call of Object.values(ledger.calls))
      if (!['acknowledged', 'rejected', 'superseded'].includes(call.disposition)) effects.push('call:' + call.id);
  }
  for (const job of Object.values(ctx.store.stewardRequests || {}))
    if (job.board === board && job.state === 'running') effects.push('steward-running:' + job.id);
  blockers.push(...effects);
  return {
    blockers,
    digest: crypto.createHash('sha256').update(JSON.stringify(blockers)).digest('hex'),
    effectBlockers: effects,
    heldTargets: effects.length ? ['firstmate', 'steward'] : [],
  };
}

module.exports = { checkpoint, pending };
