'use strict';
const snapshots = require('./handoff-checkpoint');

module.exports = function handoff(ctx) {
  const ownership = ctx.ownership;
  const data = () =>
    ctx.store.handoffs ||
    (ctx.store.handoffs = {
      version: 1,
      boards: {},
      transfers: {},
      checkpoints: {},
      operations: {},
      reads: {},
      bindings: {},
    });
  const enabled = board =>
    ownership.enabled(board) &&
    (ctx.activation ? ctx.activation.active(board) : ctx.cfg.boards[board].handoffEnabled === true);
  const current = board => {
    const id = ctx.store.handoffs?.boards[board];
    return id ? ctx.store.handoffs.transfers[id] : null;
  };
  const checkpoint = board => ctx.store.handoffs?.checkpoints[current(board)?.checkpointId] || null;
  const revision = board => current(board)?.changes.at(-1)?.seq ?? checkpoint(board)?.boardRevision ?? 0;
  function status(board) {
    if (!enabled(board)) return { enabled: false };
    const owner = ownership.publicRecord(board);
    const transfer = current(board);
    const saved = checkpoint(board);
    return {
      enabled: true,
      ownership: owner,
      presence: owner.holderSessionId && owner.leaseUntil <= Date.now() ? 'lost' : 'live',
      recoveryAvailable: service.recoveryEnabled(board),
      ...(service.recoveryEnabled(board)
        ? {
            targetAvailability: require('./handoff-location').availability(
              service,
              board,
              { sessionId: owner.holderSessionId },
              ctx.dispatchLedger.record(board)?.targetBinding,
            ),
          }
        : {}),
      since: ctx.store.boards[board].shift?.since || null,
      transfer: transfer ? structuredClone({ ...transfer, changes: undefined }) : null,
      checkpoint: saved
        ? {
            id: saved.id,
            createdAt: saved.createdAt,
            boardRevision: saved.boardRevision,
            completeness: saved.completeness,
          }
        : null,
      targetBinding:
        (service.recoveryEnabled(board) && ctx.dispatchLedger.record(board)?.targetBinding) ||
        ctx.store.handoffs?.bindings?.[board] ||
        saved?.targetBinding ||
        null,
      pending: snapshots.pending(ctx, board, saved),
    };
  }
  function recordChange(change) {
    const transfer = current(change.board);
    if (transfer?.checkpointId && !['picked-up', 'cancelled'].includes(transfer.status))
      transfer.changes.push(structuredClone(change));
  }
  function dispatch(board, who, target) {
    if (!enabled(board)) return;
    if (service.recoveryEnabled(board) && !service.targetAvailable(board, who, target))
      ownership.refuse('original target binding is unavailable; dispatch paused', 409);
    const transfer = current(board);
    const saved = checkpoint(board);
    const held = transfer?.heldTargets || [];
    if (
      held.includes(target) ||
      (saved &&
        (saved.targetBinding.freshness !== 'fresh' ||
          saved.targetBinding.installationId !== who.sessionInstallationId) &&
        !service.targetAvailable(board, who, target))
    )
      ownership.refuse('original target unavailable or held by handoff blockers; dispatch paused', 409);
  }
  function paused(board, target) {
    return (
      enabled(board) && (ownership.record(board).phase !== 'working' || current(board)?.heldTargets.includes(target))
    );
  }
  function authorize(board, who) {
    ctx.registry?.refresh();
    if (!enabled(board)) ownership.refuse('handoff is disabled; ownership readiness and board switch required', 409);
    if (ctx.cfg.boards[board].lifecycle === 'archived') ownership.refuse('archived board is read-only');
    if (!ownership.captain(who, board)) ownership.validate(who, board);
  }
  function control(board, who, body) {
    const operationId = body?.operationId;
    if (!ownership.validId(operationId)) ownership.refuse('operationId required', 400);
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
    const digest = ownership.hash(
      JSON.stringify(canonical({ actor: who?.sessionId || who?.name, session: !!who?.sessionId, body })),
    );
    return ctx.transact(
      () => authorize(board, who),
      () => {
        const key = board + '|' + operationId;
        const previous = data().operations[key];
        if (previous) {
          if (previous.digest !== digest) ownership.refuse('operationId reused with different input', 409);
          return {
            ...structuredClone(previous.result),
            duplicate: true,
            ...(body.action === 'read' ? actions.readView(board, previous.result.readId) : {}),
          };
        }
        const result = actions.apply(board, who, body);
        ctx.store.boards[board].ownership = ownership.publicRecord(board);
        if (body.action !== 'read') ctx.change('handoff', body.transferId || board, who.name, board);
        const answer = { ok: true, ...result, ...(body.action === 'read' ? {} : { status: status(board) }) };
        data().operations[key] = { digest, result: structuredClone(answer) };
        ownership.data().audit.push({
          board,
          operationId,
          action: 'handoff-' + body.action,
          epoch: ownership.record(board).epoch,
          by: who.name,
          sessionId: who.sessionId || null,
          at: Date.now(),
        });
        return { ...answer, ...(body.action === 'read' ? actions.readView(board, result.readId) : {}) };
      },
    );
  }
  function page(who, input) {
    const { board, sessionCredential, ...body } = input;
    if (!ownership.captain(who, board)) ownership.refuse('board owner page required');
    if (!['prepare', 'recover', 'cancel', 'read', 'accept'].includes(body.action))
      ownership.refuse('page control refused');
    if (['read', 'accept'].includes(body.action)) {
      const successor = ownership.authenticate(sessionCredential);
      if (!successor) ownership.refuse('private successor session credential required');
      successor.epoch = body.expectedEpoch;
      return control(board, successor, body);
    }
    return control(board, who, body);
  }
  const service = {
    ctx,
    ownership,
    data,
    current,
    checkpoint,
    revision,
    enabled,
    status,
    recordChange,
    dispatch,
    paused,
    control,
    page,
  };
  const actions = require('./handoff-actions')(service);
  Object.assign(service, require('./handoff-recovery')(service));
  return service;
};
