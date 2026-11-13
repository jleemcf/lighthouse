'use strict';
const crypto = require('node:crypto');
const { handoffFixture } = require('./handoff-fixture');
function dispatchFixture(context, fault) {
  const f = handoffFixture(context, fault);
  const { ctx, first, captain, processId } = f;
  ctx.cfg.boards.tools.dispatchLedgerEnabled = true;
  ctx.dispatchLedger = require('../dispatch-ledger')(ctx);
  ctx.TC = { revalidateRelay: () => ({ ok: true }), reindex: () => {} };
  const send = (action, extra = {}, who = first) =>
    ctx.dispatchLedger.control('tools', who, { action, operationId: crypto.randomUUID(), ...extra });
  const journalId = crypto.randomUUID();
  send('inventory', { journalId, complete: true, calls: [], relays: [] });
  f.control(
    { action: 'attach', processId, protocol: 'session-epochs-v1', capabilities: ['dispatch-ledger-v1'], journalId },
    first,
  );
  send('activate', { confirmAllWriters: true, processIds: [processId] }, captain);
  function issue(text = 'Exact instruction', id = crypto.randomUUID()) {
    const ticket = {
      id: crypto.randomUUID(),
      board: 'tools',
      by: first.name,
      to: 'firstmate',
      text,
      hash: ctx.ownership.hash(text),
      t: ctx.now(),
      used: false,
      messageId: 'source-message',
    };
    let capability;
    ctx.transact(
      () => ctx.ownership.acting(first, 'tools', first.epoch),
      () => {
        capability = ctx.ownership.ticket(first, 'tools', first.epoch, ticket);
        ctx.store.tickets ||= {};
        ctx.store.tickets[ticket.id] = ticket;
        ctx.dispatchLedger.issue('tools', first, ticket, id);
      },
    );
    return { ...ticket, intentId: id, evidenceCapability: capability };
  }
  const consume = (ticket, extra = {}, who = first) =>
    send(
      'consume',
      { intentId: ticket.intentId, attemptId: ticket.attemptId, permissionId: ticket.permissionId, ...extra },
      who,
    );
  return { ...f, send, issue, consume, journalId };
}
module.exports = { dispatchFixture };
