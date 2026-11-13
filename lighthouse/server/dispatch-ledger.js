'use strict';
const crypto = require('node:crypto');
const { LOST_AFTER_MS } = require('./shift-presence');
const canonical = value =>
  Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === 'object'
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map(key => [key, canonical(value[key])]),
        )
      : value;
const digest = value =>
  crypto
    .createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex');
const callHash = call => digest({ tool: call.tool, args: call.args || {} });

module.exports = function ledger(ctx) {
  const ownership = ctx.ownership;
  const refuse = ownership.refuse;
  const requested = board =>
    ownership.enabled(board) &&
    (ctx.activation
      ? ctx.activation.active(board)
      : ctx.cfg.boards[board]?.dispatchLedgerEnabled === true || record(board)?.ready === true);
  const record = board => ctx.store.dispatchLedger?.boards[board];
  const enabled = board => requested(board) && record(board)?.ready === true;
  function data(board) {
    ctx.store.dispatchLedger ||= { version: 1, boards: {} };
    return (ctx.store.dispatchLedger.boards[board] ||= {
      ready: false,
      intents: {},
      attempts: {},
      calls: {},
      inventories: {},
      operations: {},
      history: [],
    });
  }
  function audit(board, who, action, id, detail = {}) {
    data(board).history.push({
      action,
      id,
      ...detail,
      sessionId: who.sessionId || null,
      epoch: who.epoch ?? null,
      by: who.name,
      at: Date.now(),
    });
  }
  function status(board) {
    const saved = record(board);
    if (!requested(board)) return { enabled: false };
    return {
      enabled: enabled(board),
      available: true,
      version: 1,
      ...(ctx.handoff?.recoveryEnabled(board) ? { recoveryEnabled: true } : {}),
      targetBinding: saved?.targetBinding || null,
      intents: Object.values(saved?.intents || {}),
      attempts: Object.values(saved?.attempts || {}),
      calls: Object.values(saved?.calls || {}),
      inventories: Object.values(saved?.inventories || {}),
      history: saved?.history || [],
    };
  }
  function holder(board, who) {
    ownership.acting(who, board, who.epoch);
  }
  function control(board, who, body) {
    if (!ownership.validId(body?.operationId)) refuse('stable operationId required', 400);
    const evidence = ['inventory', 'unknown'].includes(body.action);
    const authorize = () => {
      ctx.registry?.refresh();
      if (ctx.activation && body.action === 'activate') refuse('use the named board activation command', 409);
      if (!requested(board)) refuse('dispatch ledger is disabled; readiness and board switch required', 409);
      if (ownership.captain(who, board)) {
        if (!['activate', 'reconcile', 'resolve-gap'].includes(body.action)) refuse('operator session required');
      } else {
        ownership.validate(who, board);
        if (!evidence) holder(board, who);
      }
      if (ctx.cfg.boards[board].lifecycle === 'archived') refuse('archived board is read-only');
    };
    return ctx.transact(authorize, () => {
      const saved = data(board);
      const key = body.operationId;
      const hash = digest({ actor: who.sessionId || who.name, body });
      const prior = saved.operations[key];
      if (prior) {
        if (prior.hash !== hash) refuse('operationId reused with different input', 409);
        // A lost consume answer is possibly sent. Its positive route grant is NEVER replayed.
        return {
          ...structuredClone(prior.result),
          ...(body.action === 'inventory' ? { calls: body.calls.map(call => saved.calls[call.id]) } : {}),
          duplicate: true,
          ...(body.action === 'consume' ? { dispatch: false, possiblySent: true } : {}),
        };
      }
      let result;
      if (body.action === 'activate') result = activate(board, who, body);
      else if (body.action === 'inventory') result = calls.inventory(board, who, body);
      else {
        if (!enabled(board) && body.action !== 'resolve-gap') refuse('dispatch ledger readiness incomplete', 409);
        result = attempts.apply(board, who, body);
        if (!result) result = calls.apply(board, who, body);
        if (!result) refuse('unknown ledger action', 400);
      }
      attempts.releaseHolds(board);
      const answer = { ok: true, ...result };
      audit(board, who, body.action, body.intentId || body.callId || body.journalId || board);
      saved.operations[key] = {
        hash,
        result: structuredClone(body.action === 'inventory' ? { ok: true, journalId: body.journalId } : answer),
      };
      ctx.change('dispatch-ledger', board, who.name, board);
      return answer;
    });
  }
  function activate(board, who, body) {
    if (!ownership.captain(who, board)) refuse('board captain approval required');
    const saved = data(board);
    if (saved.ready) refuse('dispatch ledger already activated', 409);
    const owner = ownership.record(board);
    const processes = Object.entries(owner.processes).filter(([, p]) => Date.now() - p.seenAt < LOST_AFTER_MS);
    const ids = processes.map(([id]) => id).sort();
    if (
      !processes.length ||
      body.confirmAllWriters !== true ||
      owner.leaseUntil <= Date.now() ||
      JSON.stringify(ids) !== JSON.stringify([...(body.processIds || [])].sort()) ||
      processes.some(
        ([, p]) =>
          p.sessionId !== owner.holderSessionId ||
          !p.capabilities?.includes('dispatch-ledger-v1') ||
          !(saved.inventories[p.journalId]?.complete || saved.inventories[p.journalId]?.resolved),
      )
    )
      refuse('ledger readiness requires every writer reconnected with a complete journal inventory', 409);
    calls.settleCalls(board);
    saved.ready = true;
    for (const ticket of Object.values(ctx.store.tickets || {}))
      if (ticket.board === board && !ticket.used && !ticket.ledgerIntentId)
        calls.importRelay(board, who, {
          id: 'relay-result-' + ticket.id,
          ticket: ticket.id,
          state: 'unknown',
          originSessionId: ticket.sessionId,
          originEpoch: ticket.epoch,
        });
    ctx.store.dispatchLedger.registryRequired = ctx.registry?.persistent === true;
    saved.targetBinding = ctx.store.handoffs?.bindings[board] || {
      id: 'firstmate',
      installationId: owner.installationId,
      freshness: 'fresh',
    };
    require('./handoff-location').pin(ctx, board);
    ctx.store.schemaVersion = 4;
    return { enabled: true, targetBinding: saved.targetBinding };
  }
  function guardTarget(board, who, target, except) {
    const saved = data(board);
    const binding = saved.targetBinding;
    const recovery = ctx.handoff?.recoveryEnabled(board);
    const reachable = recovery
      ? ctx.handoff.targetAvailable(board, who, target)
      : binding?.installationId === who.sessionInstallationId && binding?.freshness === 'fresh';
    if (!reachable) refuse('original firstmate target is unavailable from this installation; dispatch paused', 409);
    if (Object.values(saved.inventories).some(value => !value.complete && !value.resolved))
      refuse('journal import gap; dispatch paused pending evidence and owner decision', 409);
    if (
      Object.values(saved.intents).some(
        value =>
          value.id !== except && ['consumed', 'unknown', 'conflict'].includes(value.state) && value.target === target,
      )
    )
      refuse('target has possibly running work; quiesce or reconcile before conflicting dispatch', 409);
  }
  const service = {
    ctx,
    ownership,
    refuse,
    requested,
    record,
    enabled,
    data,
    audit,
    status,
    control,
    activate,
    holder,
    guardTarget,
    digest,
    callHash,
  };
  const attempts = require('./dispatch-attempts')(service);
  const calls = require('./dispatch-calls')(service);
  return Object.assign(service, attempts, calls);
};
module.exports.callHash = callHash;
module.exports.digest = digest;
