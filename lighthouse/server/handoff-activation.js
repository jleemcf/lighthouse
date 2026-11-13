'use strict';
const crypto = require('node:crypto');
const { LOST_AFTER_MS } = require('./shift-presence');
const version = 'handoff-activation-v1';

module.exports = function activation(ctx) {
  const ownership = ctx.ownership;
  const refuse = ownership.refuse;
  const data = () => (ctx.store.handoffActivation ||= { version: 1, boards: {}, operations: {}, audit: [] });
  const active = board => ctx.store.handoffActivation?.boards[board]?.enabled === true;
  function checkBoard(board) {
    if (ctx.cfg.boards[board]?.protocol !== 'tools') refuse('activation is tools-only; no conversion', 409);
    if (ctx.cfg.boards[board].lifecycle === 'archived') refuse('archived board is read-only');
  }
  function status(board) {
    checkBoard(board);
    const owner = ownership.record(board);
    const processes = Object.entries(owner.processes);
    const inventories = Object.values(ctx.dispatchLedger.record(board)?.inventories || {});
    const blockers = [];
    if (!owner.holderSessionId || owner.leaseUntil <= Date.now() || owner.phase !== 'working')
      blockers.push('live-working-holder-required');
    if (!processes.length) blockers.push('no-attached-tool-processes');
    const holder = ownership.session(board, owner.holderSessionId);
    const location = holder?.location;
    if (!location || location.targetId !== 'firstmate' || location.targetInstallationId !== holder.installationId)
      blockers.push('verified-original-target-location-required');
    for (const inventory of inventories)
      if (!inventory.complete && !inventory.resolved) blockers.push(inventory.id + ':journal-migration-required');
    for (const [id, process] of processes) {
      const inventory = ctx.dispatchLedger.record(board)?.inventories[process.journalId];
      if (Date.now() - process.seenAt >= LOST_AFTER_MS) blockers.push(id + ':reconnect-or-detach-stale-process');
      if (process.protocol !== 'session-epochs-v1' || process.sessionId !== owner.holderSessionId)
        blockers.push(id + ':legacy-or-foreign-session');
      if (process.kitVersion !== version || !process.capabilities?.includes('dispatch-ledger-v1'))
        blockers.push(id + ':kit-server-version-mismatch');
      if (!/^[a-f0-9]{64}$/.test(process.loadedMcp || '') || process.loadedMcp !== process.installedMcp)
        blockers.push(id + ':reconnect-or-incomplete-kit');
      if (
        process.journalVersion !== 1 ||
        !(inventory?.complete || inventory?.resolved) ||
        inventory.originSessionId !== owner.holderSessionId ||
        inventory.originEpoch !== owner.epoch
      )
        blockers.push(id + ':journal-migration-required');
    }
    if (
      Object.values(ctx.store.tickets || {}).some(
        ticket => ticket.board === board && !ticket.used && !ticket.evidenceHash,
      )
    )
      blockers.push('unsettled-legacy-relay');
    const state = {
      board,
      version,
      enabled: active(board),
      epoch: owner.epoch,
      holderSessionId: owner.holderSessionId,
      processIds: processes.map(([id]) => id).sort(),
      attachedProcessIds: Object.keys(owner.processes).sort(),
      processes: processes.map(([id, process]) => ({ id, ...process })),
      inventories: inventories.map(inventory => ({
        id: inventory.id,
        complete: inventory.complete,
        resolved: inventory.resolved,
        gaps: inventory.gaps,
        migration: inventory.migration || null,
      })),
      blockers,
      ready: blockers.length === 0,
    };
    const readiness = ctx.dispatchLedger.digest({
      ...state,
      processes: state.processes.map(process => ({ ...process, seenAt: 0 })),
    });
    return { ...state, readiness };
  }
  function requireReady(board, body) {
    const view = status(board);
    if (
      !view.ready ||
      body.confirmAllWriters !== true ||
      body.readiness !== view.readiness ||
      JSON.stringify([...(body.processIds || [])].sort()) !== JSON.stringify(view.processIds)
    )
      refuse('readiness barrier incomplete or changed; inspect the named board again', 409);
    return view;
  }
  function control(board, who, body) {
    const inventory = body?.action === 'inventory';
    const authorize = () => {
      ctx.registry?.refresh();
      checkBoard(board);
      if (inventory) ownership.holding(who, board, who.epoch);
      else if (!ownership.captain(who, board)) refuse('explicit board captain scope required');
    };
    if (!ownership.validId(body?.operationId)) refuse('stable operationId required', 400);
    const hash = ctx.dispatchLedger.digest({ actor: who.sessionId || who.name, body });
    return ctx.transact(authorize, () => {
      const key = board + '|' + body.operationId;
      const previous = data().operations[key];
      if (previous) {
        if (previous.hash !== hash) refuse('operationId reused with different input', 409);
        return { ...structuredClone(previous.result), duplicate: true };
      }
      if (inventory) {
        const result = { ok: true, ...ctx.dispatchLedger.inventory(board, who, body) };
        data().operations[key] = { hash, result: { ok: true, journalId: body.journalId } };
        return result;
      }
      const owner = ownership.record(board);
      if (body.expectedEpoch !== owner.epoch) refuse('activation epoch changed', 409);
      if (body.action === 'resolve-gap') {
        ctx.dispatchLedger.apply(board, who, body);
      } else if (body.action === 'activate') {
        if (active(board)) refuse('board already activated', 409);
        requireReady(board, body);
        ctx.beforeCommit(() => {
          if (owner.leaseUntil <= Date.now()) refuse('holder expired before activation committed', 409);
        });
        owner.enforced = true;
        data().boards[board] = { enabled: true, operationId: body.operationId, at: Date.now() };
        ctx.dispatchLedger.activate(board, who, body);
        const shift = ctx.store.boards[board].shift;
        if (shift?.state === 'on' && !shift.id) shift.id = crypto.randomUUID();
      } else if (body.action === 'deactivate') {
        if (!active(board)) refuse('board is not activated', 409);
        require('./handoff-deactivate')(ctx, board, body);
        data().boards[board] = { enabled: false, operationId: body.operationId, at: Date.now() };
      } else refuse('unknown activation action', 400);
      if (body.action !== 'resolve-gap') ctx.store.schemaVersion = 5;
      ctx.store.boards[board].ownership = ownership.publicRecord(board);
      const result = { ok: true, board, enabled: active(board), epoch: owner.epoch };
      data().audit.push({
        ...result,
        action: body.action,
        by: who.name,
        operationId: body.operationId,
        at: Date.now(),
      });
      data().operations[key] = { hash, result };
      ctx.change('activation', board, who.name, board);
      return result;
    });
  }
  return { active, status, control, requireReady, version };
};
