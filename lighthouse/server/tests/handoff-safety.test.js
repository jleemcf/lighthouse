'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { handoffFixture, input } = require('./handoff-fixture');

test('handoff readiness and board switch are both required, and lines stay unchanged', context => {
  const f = handoffFixture(context);
  const before = structuredClone(f.ctx.store.boards.tools.shift);
  for (const barrier of ['switch', 'enforcement', 'lines']) {
    f.ctx.cfg.boards.tools.handoffEnabled = barrier !== 'switch';
    f.ctx.ownership.record('tools').enforced = barrier !== 'enforcement';
    f.ctx.cfg.boards.tools.protocol = barrier === 'lines' ? 'lines' : 'tools';
    assert.deepEqual(f.ctx.handoff.status('tools'), { enabled: false });
    assert.throws(() => f.prepare(), /disabled/);
    assert.equal(f.ctx.store.handoffs, undefined);
    assert.deepEqual(f.ctx.store.boards.tools.shift, before);
  }
});

test('handoff refuses other sessions, collector scope, stale holder and B1 bypass controls', context => {
  const f = handoffFixture(context);
  const other = f.register('session-other');
  assert.throws(() => f.run('prepare', { expectedEpoch: 1, successorSessionId: f.second.sessionId }, other), /epoch/);
  f.prepare();
  assert.throws(() => f.control({ action: 'nominate', expectedEpoch: 1 }), /handoff/);
  assert.throws(() => f.save({ ...input(), version: 2 }), /version/);
  const bad = input();
  bad.goal.value = 'Bearer forbidden';
  assert.throws(() => f.save(bad), /secrets/);
  f.save();
  f.seal();
  assert.throws(() => f.read(other), /named successor/);
  const collector = f.register('session-second', 'collector');
  assert.throws(() => f.read(collector), /credential/);
  const proof = f.read();
  const first = f.body('accept', { expectedEpoch: 1, readId: proof.readId });
  const losing = { ...first, operationId: crypto.randomUUID() };
  f.ctx.handoff.control('tools', f.second, first);
  assert.throws(() => f.ctx.handoff.control('tools', f.second, losing), /read this transfer/);
  f.second.epoch = 2;
  assert.equal(f.ctx.handoff.control('tools', f.second, first).duplicate, true);
  assert.throws(() => f.ctx.ownership.acting(f.first, 'tools', 1), /stale/);
});

test('handoff retains late changes beyond the normal feed, and never replaces live owed and asks', context => {
  const f = handoffFixture(context);
  f.prepare();
  f.save();
  f.seal();
  const late = { id: 'late-card', board: 'tools', status: 'waiting', decisions: [{ id: 'ask-one' }] };
  f.ctx.store.cards[late.id] = late;
  f.ctx.change('card', late.id, 'captain', 'tools');
  f.ctx.transact(
    () => {},
    () => {
      for (let index = 0; index < 5002; index++) f.ctx.change('test', String(index), 'captain', 'tools');
    },
  );
  assert.equal(
    f.ctx.store.changes.some(change => change.id === late.id),
    false,
  );
  const read = f.read();
  assert.ok(read.changes.some(change => change.id === late.id));
  assert.ok(read.live.cards.find(card => card.id === late.id).decisions.some(ask => ask.id === 'ask-one'));
  assert.equal(read.checkpoint.authoritative.openAskIds.length, 0);
});

test('handoff rechecks quiescence, refuses lost holders, and keeps the shift on', context => {
  const f = handoffFixture(context);
  f.prepare();
  f.save();
  f.seal();
  f.ctx.store.stewardRequests = { active: { id: 'active', board: 'tools', state: 'running' } };
  assert.throws(() => f.accept(), /quiescence/);
  f.ctx.store.stewardRequests.active.state = 'done';
  const owner = f.ctx.ownership.record('tools');
  owner.leaseUntil = Date.now() - 13 * 3600000;
  f.ctx.store.boards.tools.ownership = f.ctx.ownership.publicRecord('tools');
  assert.throws(() => f.accept(), /captain-approved recovery/);
  require('../shift').sweep(f.ctx);
  assert.equal(f.ctx.store.boards.tools.shift.state, 'on');
  assert.equal(owner.epoch, 1);
});

test('handoff degraded dispatch holds and original target survive another transfer', context => {
  const f = handoffFixture(context);
  f.prepare();
  const missing = input();
  missing.queue.freshness = 'missing';
  f.save(missing);
  f.seal(true);
  f.accept();
  f.pickup();
  const next = crypto.randomUUID();
  const run = (action, extra = {}) => f.run(action, { transferId: next, ...extra }, f.second);
  run('prepare', { expectedEpoch: 2, successorSessionId: f.first.sessionId });
  const migrated = input();
  migrated.targetBinding.installationId = 'different-install';
  assert.throws(() => run('checkpoint', { checkpoint: migrated }), /target migration/);
  run('checkpoint', { checkpoint: input() });
  assert.throws(() => run('seal'), /retained-dispatch-hold/);
  run('cancel', { expectedEpoch: 2, pendingDigest: f.ctx.handoff.status('tools').pending.digest });
  assert.deepEqual(f.ctx.handoff.current('tools').heldTargets, ['firstmate', 'steward']);
  assert.equal(f.ctx.handoff.paused('tools', 'steward'), true);
  assert.throws(() => f.ctx.handoff.dispatch('tools', f.second, 'firstmate'), /dispatch paused/);
  const continuation = crypto.randomUUID();
  f.run('checkpoint', { transferId: continuation, reason: 'compaction', checkpoint: input() }, f.second);
  assert.deepEqual(f.ctx.handoff.current('tools').heldTargets, ['firstmate', 'steward']);
});
