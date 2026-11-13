'use strict';
const crypto = require('node:crypto');
const snapshots = require('./handoff-checkpoint');
const { LOST_AFTER_MS } = require('./shift-presence');

module.exports = function actions(service) {
  const { ctx, ownership, data, current, checkpoint } = service;
  const refuse = ownership.refuse;
  function holder(board, who) {
    ownership.holding(who, board, who.epoch);
    const lease = ownership.record(board).leaseUntil;
    ctx.beforeCommit(() => {
      if (lease <= Date.now()) refuse('holder lease expired before commit', 409);
    });
  }
  function controller(board, who, body) {
    const owner = ownership.record(board);
    if (body.expectedEpoch !== owner.epoch) refuse('epoch changed', 409);
    if (!ownership.captain(who, board)) holder(board, who);
  }
  function transfer(board, body) {
    const value = current(board);
    if (!value || value.id !== body.transferId) refuse('transfer changed', 409);
    return value;
  }
  function prepare(board, who, body) {
    controller(board, who, body);
    const owner = ownership.record(board);
    if (owner.phase !== 'working' || owner.leaseUntil <= Date.now()) refuse('live working holder required', 409);
    const successor = ownership.session(board, body.successorSessionId);
    if (!successor || successor.revoked || successor.sessionId === owner.holderSessionId)
      refuse('different registered successor required', 409);
    if (!ownership.validId(body.transferId) || data().transfers[body.transferId])
      refuse('new transferId required', 409);
    const prior = current(board);
    data().transfers[body.transferId] = {
      id: body.transferId,
      board,
      kind: 'handoff',
      status: 'draining',
      from: owner.holderSessionId,
      to: successor.sessionId,
      expectedEpoch: owner.epoch,
      createdAt: Date.now(),
      checkpointId: prior?.checkpointId || null,
      changes: [],
      heldTargets: prior?.heldTargets || [],
      inheritedBlockers: (prior?.heldTargets || []).map(target => 'retained-dispatch-hold:' + target),
    };
    data().boards[board] = body.transferId;
    owner.phase = 'draining';
    owner.successor = null;
    owner.handoffOperationId = body.transferId;
    return {};
  }
  function save(board, who, body) {
    holder(board, who);
    const owner = ownership.record(board);
    const resuming = ['compaction', 'reconnect'].includes(body.reason);
    let value;
    if (resuming) {
      if (owner.phase !== 'working' || !ownership.validId(body.transferId) || data().transfers[body.transferId])
        refuse('new continuation from a working holder required', 409);
      const prior = current(board);
      value = {
        id: body.transferId,
        board,
        kind: body.reason,
        status: 'draining',
        from: who.sessionId,
        to: who.sessionId,
        expectedEpoch: owner.epoch,
        createdAt: Date.now(),
        checkpointId: prior?.checkpointId || null,
        changes: [],
        heldTargets: prior?.heldTargets || [],
        inheritedBlockers: (prior?.heldTargets || []).map(target => 'retained-dispatch-hold:' + target),
      };
      data().transfers[value.id] = value;
      data().boards[board] = value.id;
    } else {
      value = transfer(board, body);
      if (value.status !== 'draining' || value.from !== who.sessionId) refuse('outgoing checkpoint only', 409);
    }
    const id = crypto.randomUUID();
    const saved = snapshots.checkpoint(ctx, board, who, body.checkpoint, id);
    saved.transferId = value.id;
    data().checkpoints[id] = saved;
    if (saved.targetBinding.freshness === 'fresh') {
      data().bindings ||= {};
      data().bindings[board] ||= structuredClone(saved.targetBinding);
    }
    ctx.store.boards[board].pickup = { ...ctx.store.boards[board].pickup, checkpointId: id };
    value.checkpointId = id;
    value.changes = [];
    if (resuming) {
      value.status = 'accepted';
      owner.phase = 'pickup';
      owner.handoffOperationId = value.id;
    }
    return { checkpoint: saved };
  }
  function seal(board, who, body) {
    holder(board, who);
    const value = transfer(board, body);
    const saved = checkpoint(board);
    if (
      value.status !== 'draining' ||
      value.from !== who.sessionId ||
      !saved ||
      saved.epoch !== who.epoch ||
      saved.transferId !== value.id
    )
      refuse('outgoing checkpoint required before seal', 409);
    const pending = snapshots.pending(ctx, board, saved);
    if (pending.blockers.length && body.degraded !== true)
      refuse('clean seal blocked: ' + pending.blockers.join(', '), 409);
    value.seal = { at: Date.now(), degraded: body.degraded === true, blockers: pending.blockers };
    value.heldTargets = [...new Set(value.heldTargets.concat(pending.heldTargets))];
    value.status = 'sealed';
    return {};
  }
  function read(board, who, body) {
    const value = transfer(board, body);
    if (!['sealed', 'accepted'].includes(value.status)) refuse('sealed checkpoint or pending pickup required', 409);
    ownership.validate(who, board);
    if (who.sessionId !== value.to || !checkpoint(board)) refuse('named successor only', 403);
    const readId = crypto.randomUUID();
    const revision = service.revision(board);
    data().reads[readId] = {
      board,
      transferId: value.id,
      sessionId: who.sessionId,
      checkpointId: value.checkpointId,
      revision,
      epoch: ownership.record(board).epoch,
      phase: value.status,
    };
    return { readId, revision };
  }
  function readView(board, readId) {
    const receipt = data().reads[readId];
    return {
      checkpoint: structuredClone(data().checkpoints[receipt.checkpointId]),
      changes: structuredClone(data().transfers[receipt.transferId].changes),
      live: live(board),
      dispatch: ctx.dispatchLedger?.status(board) || { enabled: false },
      steward: Object.values(ctx.store.stewardRequests || {})
        .filter(request => request.board === board)
        .map(request => ({
          id: request.id,
          board: request.board,
          kind: request.kind,
          state: request.state,
          t: request.t,
          attempts: request.attempts,
          runningSince: request.runningSince,
          answeredAt: request.answeredAt,
          adviceId: request.adviceId,
        })),
      recovery: structuredClone(data().transfers[receipt.transferId].recovery || null),
    };
  }
  function proof(board, who, body, phase) {
    const value = transfer(board, body);
    const read = data().reads[body.readId];
    if (
      !read ||
      read.board !== board ||
      read.transferId !== value.id ||
      read.sessionId !== who.sessionId ||
      read.checkpointId !== value.checkpointId ||
      read.epoch !== ownership.record(board).epoch ||
      read.phase !== phase
    )
      refuse('read this transfer checkpoint and current state first', 409);
    return read;
  }
  function live(board) {
    const scoped = key => Object.values(ctx.store[key] || {}).filter(item => item.board === board);
    return {
      board: structuredClone(ctx.store.boards[board]),
      cards: structuredClone(scoped('cards')),
      comments: structuredClone(scoped('comments')),
      authorities: structuredClone(scoped('authorities')),
      tickets: scoped('tickets').map(ticket => ({
        id: ticket.id,
        to: ticket.to,
        used: !!ticket.used,
        delivered: ticket.delivered ?? null,
      })),
    };
  }
  function finish(board, who, body) {
    const value = transfer(board, body);
    const owner = ownership.record(board);
    if (body.action === 'accept') {
      ownership.validate(who, board);
      proof(board, who, body, 'sealed');
      if (
        value.status !== 'sealed' ||
        value.to !== who.sessionId ||
        value.expectedEpoch !== owner.epoch ||
        body.expectedEpoch !== owner.epoch ||
        owner.holderSessionId !== value.from ||
        owner.phase !== 'draining'
      )
        refuse('transfer already committed, cancelled or changed', 409);
      if (value.kind === 'recovery') service.validateRecovery(board, value);
      else {
        const lease = owner.leaseUntil;
        if (lease <= Date.now()) refuse('lost holder needs separate captain-approved recovery', 409);
        ctx.beforeCommit(() => {
          if (lease <= Date.now()) refuse('holder lost before transfer committed', 409);
        });
      }
      if (owner.epoch >= Number.MAX_SAFE_INTEGER) refuse('ownership epoch exhausted', 409);
      const pending = snapshots.pending(ctx, board, checkpoint(board));
      if (!value.seal.degraded && pending.blockers.length) refuse('quiescence changed; cancel and reseal', 409);
      value.heldTargets = [...new Set(value.heldTargets.concat(pending.heldTargets))];
      owner.epoch++;
      owner.holderSessionId = who.sessionId;
      owner.installationId = who.sessionInstallationId;
      owner.phase = 'pickup';
      owner.leaseUntil = Date.now() + LOST_AFTER_MS;
      owner.processes = {};
      value.status = 'accepted';
      value.acceptedAt = Date.now();
      value.acceptOperationId = body.operationId;
      return { epoch: owner.epoch };
    }
    if (body.action === 'pickup') {
      holder(board, who);
      const read = proof(board, who, body, 'accepted');
      if (
        value.status !== 'accepted' ||
        owner.phase !== 'pickup' ||
        read.revision !== service.revision(board) ||
        body.revision !== read.revision
      )
        refuse('board changed; reread all current state and changes', 409);
      owner.phase = 'working';
      value.status = 'picked-up';
      value.pickupRevision = read.revision;
      value.pickedUpAt = Date.now();
      return {};
    }
    if (body.action === 'cancel') {
      controller(board, who, body);
      if (value.kind === 'recovery' && !ownership.captain(who, board))
        refuse('only the captain may cancel a recovery approval');
      if (!['draining', 'sealed'].includes(value.status) || owner.holderSessionId !== value.from)
        refuse('committed transfer cannot be cancelled; use a newer transfer', 409);
      const pending = snapshots.pending(ctx, board, checkpoint(board));
      if (body.pendingDigest !== pending.digest) refuse('recheck pending effects before cancelling', 409);
      if (value.kind === 'recovery') {
        const gap = ctx.dispatchLedger.record(board).inventories[value.recovery.gapId];
        gap.resolved = true;
        gap.resolution = { by: who.name, evidence: 'recovery cancelled before acceptance', at: Date.now() };
      }
      value.heldTargets = value.inheritedBlockers.map(blocker => blocker.slice('retained-dispatch-hold:'.length));
      value.status = 'cancelled';
      value.cancelledAt = Date.now();
      owner.phase = 'working';
      return {};
    }
    refuse('unknown handoff action', 400);
  }
  return {
    readView,
    apply(board, who, body) {
      if (body.action === 'recover') return service.approveRecovery(board, who, body);
      if (body.action === 'prepare') return prepare(board, who, body);
      if (body.action === 'checkpoint') return save(board, who, body);
      if (body.action === 'seal') return seal(board, who, body);
      if (body.action === 'read') return read(board, who, body);
      return finish(board, who, body);
    },
  };
};
