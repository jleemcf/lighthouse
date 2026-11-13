'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const { dispatchFixture } = require('./dispatch-fixture');

test('dispatch permission is single use after lost answer, new operation, empty home and cold reload', context => {
  const f = dispatchFixture(context);
  const ticket = f.issue();
  const operationId = crypto.randomUUID();
  assert.equal(f.consume(ticket, { operationId }).dispatch, true);
  assert.equal(f.consume(ticket, { operationId }).dispatch, false);
  assert.equal(f.consume(ticket).dispatch, false);
  assert.throws(() => f.issue(), /possibly running/);
  const cold = { cfg: f.ctx.cfg, CONFIG_PATH: f.ctx.CONFIG_PATH };
  Object.assign(cold, require('../store')(cold), require('../web')(cold));
  cold.ownership = require('../ownership')(cold);
  cold.handoff = require('../handoff')(cold);
  cold.dispatchLedger = require('../dispatch-ledger')(cold);
  const result = cold.dispatchLedger.control('tools', f.first, {
    action: 'consume',
    operationId,
    intentId: ticket.intentId,
    attemptId: ticket.attemptId,
    permissionId: ticket.permissionId,
  });
  assert.equal(result.dispatch, false);
  assert.equal(cold.dispatchLedger.status('tools').intents[0].state, 'consumed');
  cold.saveNow();
});

test('issued work is explicitly adoptable; consumed and unknown work never receive another permission', context => {
  const f = dispatchFixture(context);
  const ticket = f.issue();
  const adopted = f.send('adopt-intent', {
    intentId: ticket.intentId,
    attemptId: ticket.attemptId,
    reason: 'Reviewed exact instruction',
  }).ticket;
  assert.notEqual(adopted.permissionId, ticket.permissionId);
  assert.equal(f.consume(ticket).dispatch, false);
  assert.equal(f.consume(adopted).dispatch, true);
  assert.throws(
    () => f.send('adopt-intent', { intentId: adopted.intentId, attemptId: adopted.attemptId, reason: 'Retry' }),
    /never resend/,
  );
  f.send('unknown', {
    intentId: adopted.intentId,
    attemptId: adopted.attemptId,
    evidenceCapability: adopted.evidenceCapability,
    originEpoch: 1,
  });
  assert.equal(f.consume(adopted).dispatch, false);
  assert.throws(() => f.issue('Other work for the same target'), /possibly running/);
  f.ctx.transact(
    () => f.ctx.ownership.acting(f.first, 'tools', 1),
    () => {
      f.ctx.store.boards.tools.unrelatedWork = 'continues';
    },
  );
  assert.equal(f.ctx.store.boards.tools.unrelatedWork, 'continues');
});

test('shared unresolved target plus instruction suppresses another logical id before dispatch', context => {
  const f = dispatchFixture(context);
  f.issue();
  assert.throws(() => f.issue(), /unresolved target and instruction/);
  assert.equal(Object.keys(f.ctx.dispatchLedger.record('tools').intents).length, 1);
});

test('late receipt capability survives relief, expiry and pruning; settlement grants no acting authority', context => {
  const f = dispatchFixture(context);
  const ticket = f.issue();
  f.consume(ticket);
  f.prepare();
  f.save();
  f.seal(true);
  f.accept();
  f.pickup();
  f.ctx.ownership.record('tools').leaseUntil = 1;
  f.ctx.store.tickets[ticket.id].t = '2000-01-01T00:00:00Z';
  f.ctx.transact(
    () => f.ctx.ownership.evidence(f.first, 'tools', 1, ticket.id, ticket.evidenceCapability),
    () => {
      const settled = f.ctx.dispatchLedger.receipt(
        'tools',
        f.first,
        f.ctx.store.tickets[ticket.id],
        { delivered: true, detail: 'late independent transport result' },
        'late-receipt',
      );
      assert.equal(settled.ok, true);
    },
  );
  assert.equal(f.ctx.dispatchLedger.record('tools').intents[ticket.intentId].state, 'delivered');
  assert.throws(() => f.ctx.ownership.acting(f.first, 'tools', 1), /stale|relieved/);
  assert.equal(f.ctx.ownership.record('tools').leaseUntil, 1);
  assert.equal(
    JSON.parse(fs.readFileSync(f.ctx.STORE)).dispatchLedger.boards.tools.attempts[ticket.attemptId].receipts.length,
    1,
  );
});

test('non-delivery and conflicting evidence hold target until independent owner reconciliation', context => {
  const f = dispatchFixture(context);
  const ticket = f.issue();
  f.consume(ticket);
  const receipt = delivered =>
    f.ctx.transact(
      () => {},
      () =>
        f.ctx.dispatchLedger.receipt(
          'tools',
          f.first,
          f.ctx.store.tickets[ticket.id],
          { delivered },
          crypto.randomUUID(),
        ),
    );
  assert.equal(receipt(false).ok, true);
  assert.equal(f.ctx.dispatchLedger.record('tools').intents[ticket.intentId].state, 'unknown');
  assert.equal(receipt(true).ok, false);
  assert.equal(f.ctx.dispatchLedger.record('tools').intents[ticket.intentId].state, 'conflict');
  const body = {
    intentId: ticket.intentId,
    attemptId: ticket.attemptId,
    outcome: 'conflict-resolved',
    quiesced: true,
    reason: 'checked recipient history',
    evidence: 'receipt-reference',
  };
  assert.throws(() => f.send('reconcile', body, f.captain), /independent/);
  assert.throws(() => f.send('reconcile', { ...body, independent: true }), /captain/);
  f.send('reconcile', { ...body, independent: true }, f.captain);
  assert.equal(f.consume(ticket).dispatch, false);
  assert.doesNotThrow(() => f.issue('Explicit new work'));
});

test('different-home adoption preserves the original target and pauses dispatch on another installation', context => {
  const f = dispatchFixture(context);
  const ticket = f.issue();
  const third = f.register('session-another', 'operator', 'installation-another');
  f.run('prepare', { expectedEpoch: 1, successorSessionId: third.sessionId });
  f.save();
  f.seal(true);
  const { readId } = f.read(third);
  f.run('accept', { readId, expectedEpoch: 1 }, third);
  third.epoch = 2;
  f.pickup(third);
  const adopted = f.send(
    'adopt-intent',
    { intentId: ticket.intentId, attemptId: ticket.attemptId, reason: 'Reviewed without moving the recipient' },
    third,
  ).ticket;
  assert.throws(() => f.consume(adopted, {}, third), /original firstmate target/);
  assert.equal(f.ctx.dispatchLedger.record('tools').targetBinding.installationId, 'install-test');
  assert.doesNotThrow(() =>
    f.ctx.transact(
      () => f.ctx.ownership.acting(third, 'tools', 2),
      () => {
        f.ctx.store.boards.tools.unrelated = 'continue';
      },
    ),
  );
});

test('activation refuses an old attached writer and gaps cannot be cleared by empty inventories', context => {
  const { handoffFixture } = require('./handoff-fixture');
  const f = handoffFixture(context);
  f.ctx.cfg.boards.tools.dispatchLedgerEnabled = true;
  f.ctx.dispatchLedger = require('../dispatch-ledger')(f.ctx);
  const run = (action, body = {}, who = f.captain) =>
    f.ctx.dispatchLedger.control('tools', who, { action, operationId: crypto.randomUUID(), ...body });
  assert.throws(() => run('activate', { confirmAllWriters: true, processIds: [f.processId] }), /readiness/);
  const journalId = crypto.randomUUID();
  run('inventory', { journalId, complete: false, gaps: ['unavailable disk'], calls: [], relays: [] }, f.first);
  f.control(
    {
      action: 'attach',
      processId: f.processId,
      protocol: 'session-epochs-v1',
      capabilities: ['dispatch-ledger-v1'],
      journalId,
    },
    f.first,
  );
  run('inventory', { journalId, complete: true, calls: [], relays: [] }, f.first);
  assert.throws(() => run('activate', { confirmAllWriters: true, processIds: [f.processId] }), /readiness/);
  run('resolve-gap', { journalId, independent: true, evidence: 'owner reviewed independent records' });
  assert.equal(run('activate', { confirmAllWriters: true, processIds: [f.processId] }).enabled, true);
  f.ctx.cfg.boards.tools.dispatchLedgerEnabled = false;
  assert.equal(f.ctx.dispatchLedger.enabled('tools'), true, 'activation cannot be undone by removing a setting');
});
