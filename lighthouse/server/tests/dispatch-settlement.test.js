'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { dispatchFixture } = require('./dispatch-fixture');
const { callHash } = require('../dispatch-ledger');

function publish(f, gap = false) {
  const call = { id: crypto.randomUUID(), tool: 'board_post', args: { text: 'Still valid' } };
  call.hash = callHash(call);
  f.send('inventory', {
    journalId: f.journalId,
    complete: !gap,
    gaps: gap ? ['missing evidence'] : [],
    calls: gap ? [] : [call],
    relays: [],
  });
  return call;
}
function transfer(f) {
  f.prepare();
  f.save();
  f.seal(true);
  f.accept();
  f.pickup();
  assert.deepEqual(f.ctx.handoff.current('tools').heldTargets, ['firstmate', 'steward']);
}
function review(f, call, disposition) {
  return f.send(
    'review-call',
    { callId: call.id, hash: call.hash, disposition, reason: 'Checked against the current board' },
    f.second,
  );
}

test('terminal queued call review releases transfer holds only after all effects settle', context => {
  const f = dispatchFixture(context);
  const call = publish(f);
  const other = publish(f);
  transfer(f);
  review(f, call, 'superseded');
  assert.equal(f.ctx.handoff.current('tools').heldTargets.length, 2);
  review(f, other, 'rejected');
  assert.deepEqual(f.ctx.handoff.current('tools').heldTargets, []);
});

test('adoption holds until the reviewed call commits, then releases transfer holds', context => {
  const f = dispatchFixture(context);
  const call = publish(f);
  transfer(f);
  review(f, call, 'adopted');
  assert.equal(f.ctx.handoff.current('tools').heldTargets.length, 2);
  f.ctx.transact(
    () => f.ctx.ownership.acting(f.second, 'tools', 2),
    () => f.ctx.dispatchLedger.rememberCall('tools', f.second, call, { ok: true, summary: 'Applied' }),
  );
  assert.deepEqual(f.ctx.handoff.current('tools').heldTargets, []);
});

test('owner gap settlement releases holds without clearing other unresolved effects', context => {
  const f = dispatchFixture(context);
  const call = publish(f);
  publish(f, true);
  transfer(f);
  f.send(
    'resolve-gap',
    { journalId: f.journalId, independent: true, evidence: 'Owner checked the complete transferred evidence' },
    f.captain,
  );
  assert.equal(f.ctx.handoff.current('tools').heldTargets.length, 2);
  review(f, call, 'superseded');
  assert.deepEqual(f.ctx.handoff.current('tools').heldTargets, []);
});

test('a recovered legacy commit releases holds only on an active ledger', context => {
  const f = dispatchFixture(context);
  const call = publish(f);
  transfer(f);
  const entry = f.ctx.dispatchLedger.record('tools').calls[call.id];
  f.ctx.store.calls ||= {};
  f.ctx.store.calls['tools|' + entry.originPrincipal + '|' + call.id] = { ok: true, summary: 'Original commit' };
  f.ctx.transact(
    () => {},
    () => assert.ok(f.ctx.dispatchLedger.previousCall('tools', call)),
  );
  assert.deepEqual(f.ctx.handoff.current('tools').heldTargets, []);
  const saved = f.ctx.dispatchLedger.record('tools');
  saved.ready = false;
  const retained = f.ctx.handoff.current('tools');
  retained.heldTargets = ['firstmate', 'steward'];
  f.ctx.dispatchLedger.releaseHolds('tools');
  assert.deepEqual(retained.heldTargets, ['firstmate', 'steward']);
});

test('positive late evidence conflicting with owner non-delivery remains a conflict', context => {
  const f = dispatchFixture(context);
  const ticket = f.issue();
  f.consume(ticket);
  f.send(
    'reconcile',
    {
      intentId: ticket.intentId,
      attemptId: ticket.attemptId,
      outcome: 'not-delivered',
      independent: true,
      quiesced: true,
      evidence: 'Independent receiver and process records',
      reason: 'Owner reviewed non-delivery',
    },
    f.captain,
  );
  const result = f.ctx.transact(
    () => {},
    () =>
      f.ctx.dispatchLedger.receipt(
        'tools',
        f.first,
        f.ctx.store.tickets[ticket.id],
        { delivered: true },
        crypto.randomUUID(),
      ),
  );
  assert.equal(result.ok, false);
  assert.equal(f.ctx.dispatchLedger.record('tools').attempts[ticket.attemptId].state, 'conflict');
});

test('agreeing late evidence preserves every owner settlement without reopening the target', context => {
  for (const outcome of ['not-delivered', 'conflict-resolved', 'delivered']) {
    const f = dispatchFixture(context);
    const ticket = f.issue();
    f.consume(ticket);
    f.send(
      'reconcile',
      {
        intentId: ticket.intentId,
        attemptId: ticket.attemptId,
        outcome,
        independent: true,
        quiesced: true,
        evidence: 'Independent route and process records',
        reason: 'Owner reviewed the outcome',
      },
      f.captain,
    );
    const receipt = f.ctx.transact(
      () => {},
      () =>
        f.ctx.dispatchLedger.receipt(
          'tools',
          f.first,
          f.ctx.store.tickets[ticket.id],
          { delivered: outcome === 'delivered' },
          crypto.randomUUID(),
        ),
    );
    assert.equal(receipt.ok, true);
    const saved = f.ctx.dispatchLedger.record('tools');
    assert.equal(saved.attempts[ticket.attemptId].state, 'quiesced');
    assert.equal(saved.intents[ticket.intentId].state, 'quiesced');
    assert.ok(f.issue('A separate later instruction'));
  }
});
