'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { handoffFixture, input } = require('./handoff-fixture');

test('handoff: prepare, checkpoint, seal, successor read, CAS accept, pickup preserve the shift', context => {
  const f = handoffFixture(context);
  const { ctx, first, second } = f;
  const shift = structuredClone(ctx.store.boards.tools.shift);
  f.prepare();
  assert.equal(ctx.ownership.record('tools').holderSessionId, first.sessionId);
  assert.equal(ctx.ownership.record('tools').phase, 'draining');
  assert.throws(() => ctx.ownership.acting(first, 'tools', 1), /not working/);
  assert.throws(() => ctx.ownership.ticket(first, 'tools', 1, { to: 'firstmate' }), /not working/);
  assert.throws(() => f.seal(), /checkpoint/);
  const checkpoint = f.save().checkpoint;
  assert.equal(checkpoint.version, 1);
  f.seal();
  assert.throws(() => f.run('accept', { expectedEpoch: 1 }, second), /read this transfer/);
  const accepted = f.accept();
  assert.equal(accepted.result.epoch, 2);
  assert.equal(ctx.handoff.control('tools', second, accepted.request).duplicate, true);
  assert.equal(ctx.ownership.record('tools').epoch, 2);
  assert.equal(ctx.ownership.record('tools').holderSessionId, second.sessionId);
  assert.throws(() => ctx.ownership.acting(first, 'tools', 1), /stale/);
  assert.throws(() => ctx.ownership.acting(second, 'tools', 2), /not working/);
  f.pickup();
  assert.doesNotThrow(() => ctx.ownership.acting(second, 'tools', 2));
  assert.deepEqual(ctx.store.boards.tools.shift, shift);
  assert.equal(ctx.handoff.current('tools').status, 'picked-up');
});

test('handoff: cancel rechecks pending effects, keeps epoch, and cannot undo a committed transfer', context => {
  const f = handoffFixture(context);
  f.prepare();
  assert.throws(() => f.run('cancel', { expectedEpoch: 1 }), /recheck/);
  f.save();
  const pendingDigest = f.ctx.handoff.status('tools').pending.digest;
  f.run('cancel', { expectedEpoch: 1, pendingDigest }, f.captain);
  assert.equal(f.ctx.ownership.record('tools').epoch, 1);
  assert.equal(f.ctx.ownership.record('tools').phase, 'working');
  assert.throws(() => f.save(), /outgoing/);
  const next = crypto.randomUUID();
  const run = (action, extra = {}, who = f.first) =>
    f.ctx.handoff.control('tools', who, f.body(action, { transferId: next, ...extra }));
  run('prepare', { expectedEpoch: 1, successorSessionId: f.second.sessionId });
  run('checkpoint', { checkpoint: input() });
  run('seal', { degraded: false });
  const read = run('read', {}, f.second);
  run('accept', { readId: read.readId, expectedEpoch: 1 }, f.second);
  assert.throws(() => run('cancel', { expectedEpoch: 2 }, f.captain), /cannot be cancelled/);
  assert.equal(f.ctx.ownership.record('tools').epoch, 2);
});

test('handoff: an ask after checkpoint and after pickup read cannot be missed', context => {
  const f = handoffFixture(context);
  f.prepare();
  f.save();
  f.seal();
  f.ctx.store.comments['late-ask'] = { id: 'late-ask', board: 'tools', text: 'New instruction', handled: false };
  f.ctx.change('comment', 'late-ask', 'captain', 'tools');
  f.accept();
  const read = f.read();
  assert.ok(read.live.comments.some(item => item.id === 'late-ask'));
  assert.ok(read.changes.some(change => change.id === 'late-ask'));
  f.ctx.change('comment', 'later-ask', 'captain', 'tools');
  assert.throws(() => f.run('pickup', { readId: read.readId, revision: read.revision }, f.second), /board changed/);
  f.pickup();
});

test('handoff: degraded seal stays explicit and holds dispatch targets, including after pickup', context => {
  const f = handoffFixture(context);
  f.ctx.store.tickets = { unresolved: { id: 'unresolved', board: 'tools', to: 'firstmate', used: false } };
  f.prepare();
  const value = input();
  value.helpers.freshness = 'missing';
  value.queue.value = [{ id: 'unacknowledged-call', state: 'unacknowledged' }];
  f.save(value);
  assert.throws(() => f.seal(), /clean seal blocked/);
  f.seal(true);
  const seal = f.ctx.handoff.current('tools').seal;
  assert.equal(seal.degraded, true);
  assert.ok(seal.blockers.includes('ticket:unresolved'));
  assert.ok(seal.blockers.includes('missing-or-stale:helpers'));
  f.accept();
  f.pickup();
  assert.throws(() => f.ctx.ownership.ticket(f.second, 'tools', 2, { to: 'firstmate' }), /dispatch paused/);
  assert.equal(f.ctx.handoff.current('tools').seal.degraded, true);
});

test('handoff: compaction and reconnection use identical checkpoint pickup without epoch changes', context => {
  const f = handoffFixture(context);
  const shift = structuredClone(f.ctx.store.boards.tools.shift);
  for (const reason of ['compaction', 'reconnect']) {
    f.run('checkpoint', { reason, transferId: crypto.randomUUID(), checkpoint: input() });
    assert.equal(f.ctx.ownership.record('tools').phase, 'pickup');
    const transferId = f.ctx.handoff.current('tools').id;
    const read = f.run('read', { transferId }, f.first);
    f.run('pickup', { transferId, readId: read.readId, revision: read.revision }, f.first);
    assert.equal(f.ctx.ownership.record('tools').epoch, 1);
    assert.deepEqual(f.ctx.store.boards.tools.shift, shift);
  }
});
