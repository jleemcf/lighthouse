'use strict';
const crypto = require('node:crypto');
const snapshots = require('./handoff-checkpoint');
const locations = require('./handoff-location');

module.exports = function recovery(service) {
  const { ctx, ownership, data, current, checkpoint } = service;
  const refuse = ownership.refuse;
  const enabled = board =>
    service.enabled(board) &&
    (ctx.activation ? ctx.activation.active(board) : ctx.cfg.boards[board].recoveryEnabled === true) &&
    ctx.dispatchLedger?.enabled(board) === true;
  function binding(board) {
    return ctx.dispatchLedger?.record(board)?.targetBinding || data().bindings?.[board] || null;
  }
  function targetAvailable(board, who, target) {
    if (!enabled(board)) return false;
    if (target === 'steward') return true;
    if (target !== 'firstmate') return false;
    return ['same-home', 'same-machine'].includes(locations.availability(service, board, who, binding(board)));
  }
  function approve(board, who, body) {
    if (!enabled(board)) refuse('recovery is disabled; handoff and dispatch readiness required', 409);
    if (!ownership.captain(who, board)) refuse('captain approval required for each loss');
    const owner = ownership.record(board);
    const successor = ownership.session(board, body.successorSessionId);
    if (!owner.holderSessionId || body.expectedEpoch !== owner.epoch) refuse('recovery epoch changed', 409);
    if (!successor || successor.revoked || successor.sessionId === owner.holderSessionId)
      refuse('different named registered successor required', 409);
    ownership.validate(
      {
        source: 'session',
        board,
        sessionScope: 'operator',
        name: successor.principal,
        sessionId: successor.sessionId,
        sessionInstallationId: successor.installationId,
      },
      board,
    );
    if (typeof body.reason !== 'string' || !body.reason.trim() || body.reason.length > 500)
      refuse('record a recovery reason', 400);
    if (typeof body.oldDiskAvailable !== 'boolean') refuse('review old disk availability explicitly', 400);
    if (owner.leaseUntil > Date.now() && body.revoke !== true)
      refuse('live holder requires explicit revocation on acceptance', 409);
    if (body.pendingDigest !== service.status(board).pending.digest)
      refuse('review visible unknown-delivery blockers before approving recovery', 409);
    if (!ownership.validId(body.transferId) || data().transfers[body.transferId])
      refuse('new recovery transferId required', 409);
    const original = binding(board);
    const holder = ownership.session(board, owner.holderSessionId);
    const origin = holder?.location;
    const matches =
      holder?.installationId === original?.installationId &&
      origin?.targetId === original?.id &&
      origin?.targetInstallationId === original?.installationId;
    const pinned = original && {
      ...original,
      ...(original.machineId || !matches
        ? {}
        : {
            machineId: origin.machineId,
            homeId: origin.homeId,
            routeHash: origin.routeHash,
          }),
    };
    if (pinned) {
      data().bindings[board] = structuredClone(pinned);
      ctx.dispatchLedger.record(board).targetBinding = structuredClone(pinned);
    }
    const prior = current(board);
    const saved = checkpoint(board);
    const gapId = 'recovery-' + body.transferId;
    const warnings = ['Unplanned recovery is degraded; local-only outcomes remain unknown.'];
    if (!pinned?.machineId) warnings.push('Original target location unrecorded: external dispatch remains paused.');
    if (!body.oldDiskAvailable) warnings.push('Old disk unavailable: only board-acknowledged work is recoverable.');
    const value = {
      id: body.transferId,
      board,
      kind: 'recovery',
      status: 'sealed',
      from: owner.holderSessionId,
      to: successor.sessionId,
      expectedEpoch: owner.epoch,
      createdAt: Date.now(),
      checkpointId: saved?.id || null,
      changes: [],
      heldTargets: [...new Set([...(prior?.heldTargets || []), 'firstmate', 'steward'])],
      inheritedBlockers: (prior?.heldTargets || []).map(target => 'retained-dispatch-hold:' + target),
      recovery: {
        approvedBy: who.name,
        approvedAt: Date.now(),
        reason: body.reason.trim(),
        epoch: owner.epoch,
        leaseUntil: owner.leaseUntil,
        expiresAt: Date.now() + 3600000,
        revoke: body.revoke === true,
        oldDiskAvailable: body.oldDiskAvailable,
        gapId,
        warnings,
      },
    };
    data().transfers[value.id] = value;
    data().boards[board] = value.id;
    ctx.dispatchLedger.data(board).inventories[gapId] = {
      id: gapId,
      installationId: owner.installationId,
      originSessionId: owner.holderSessionId,
      originEpoch: owner.epoch,
      complete: false,
      gaps: ['unacknowledged-local-state'],
      at: Date.now(),
    };
    if (!saved) value.checkpointId = missingCheckpoint(board, owner, pinned, value.id);
    const pending = snapshots.pending(ctx, board, checkpoint(board));
    value.seal = { at: Date.now(), degraded: true, blockers: pending.blockers };
    owner.phase = 'draining';
    owner.successor = null;
    owner.handoffOperationId = value.id;
    return {};
  }
  function missingCheckpoint(board, owner, pinned, transferId) {
    const missing = value => ({ freshness: 'missing', observedAt: Date.now(), value });
    const input = Object.fromEntries(['goal', 'nextStep'].map(field => [field, missing('')]));
    for (const field of ['decisions', 'constraints', 'commitments', 'queue', 'relays', 'helpers', 'cursors'])
      input[field] = missing([]);
    input.version = 1;
    input.targetBinding = pinned || { id: null, installationId: null, freshness: 'missing' };
    const id = crypto.randomUUID();
    const who = { sessionId: owner.holderSessionId, sessionInstallationId: owner.installationId, epoch: owner.epoch };
    data().checkpoints[id] = { ...snapshots.checkpoint(ctx, board, who, input, id), transferId };
    return id;
  }
  function validate(board, value) {
    if (!enabled(board)) refuse('recovery readiness changed', 409);
    const approval = value.recovery;
    const owner = ownership.record(board);
    const epoch = owner.epoch;
    const leaseUntil = owner.leaseUntil;
    const check = () => {
      if (
        !approval ||
        approval.epoch !== epoch ||
        approval.expiresAt <= Date.now() ||
        (!approval.revoke && (approval.leaseUntil > approval.approvedAt || leaseUntil > approval.approvedAt))
      )
        refuse('fresh captain approval required for this loss', 409);
    };
    check();
    ctx.beforeCommit(check);
  }
  return { recoveryEnabled: enabled, approveRecovery: approve, validateRecovery: validate, targetAvailable };
};
