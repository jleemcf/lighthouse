'use strict';
module.exports = function deactivate(ctx, board, body) {
  const owner = ctx.ownership.record(board);
  const refuse = ctx.ownership.refuse;
  const ledger = ctx.dispatchLedger.record(board);
  const transfer = ctx.handoff.current(board);
  const pending = ctx.handoff.status(board).pending;
  if (
    body.confirmQuiesced !== true ||
    JSON.stringify([...(body.processIds || [])].sort()) !== JSON.stringify(Object.keys(owner.processes).sort()) ||
    (transfer && !['picked-up', 'cancelled'].includes(transfer.status)) ||
    pending.effectBlockers.some(value => !value.startsWith('steward-running:')) ||
    Object.values(ledger.inventories).some(value => !value.complete && !value.resolved) ||
    Object.values(ledger.intents).some(value => !['delivered', 'quiesced', 'superseded'].includes(value.state)) ||
    Object.values(ledger.calls).some(value => !['acknowledged', 'rejected', 'superseded'].includes(value.disposition))
  )
    refuse('stop every named tool; reconcile transfers, effects, inventories and queues before deactivation', 409);
  if (owner.epoch >= Number.MAX_SAFE_INTEGER) refuse('ownership epoch exhausted', 409);
  for (const entry of Object.values(ctx.ownership.data().sessions)) if (entry.board === board) entry.revoked = true;
  Object.assign(owner, {
    enforced: false,
    epoch: owner.epoch + 1,
    holderSessionId: null,
    installationId: null,
    leaseUntil: 0,
    phase: 'unowned',
    successor: null,
    processes: {},
  });
  ledger.ready = false;
};
