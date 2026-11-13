'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { dispatchFixture } = require('./dispatch-fixture');

function recoveryFixture(context, where = {}) {
  const f = dispatchFixture(context);
  const second = where.installationId ? f.register('session-new-home', 'operator', where.installationId) : f.second;
  const { installationId, ...locationChange } = where;
  const location = {
    machineId: 'machine-original',
    homeId: 'home-original',
    targetId: 'firstmate',
    targetInstallationId: 'install-test',
    routeHash: 'a'.repeat(64),
  };
  f.control({ action: 'locate', sessionId: f.first.sessionId, location });
  f.control({ action: 'locate', sessionId: second.sessionId, location: { ...location, ...locationChange } });
  f.ctx.cfg.boards.tools.recoveryEnabled = true;
  const approve = (extra = {}, who = f.captain) =>
    f.run(
      'recover',
      {
        expectedEpoch: 1,
        successorSessionId: second.sessionId,
        reason: 'Original session lost',
        oldDiskAvailable: false,
        pendingDigest: f.ctx.handoff.status('tools').pending.digest,
        ...extra,
      },
      who,
    );
  const expire = () => {
    f.ctx.ownership.record('tools').leaseUntil = Date.now() - 1;
  };
  const resolve = () =>
    f.send(
      'resolve-gap',
      {
        journalId: f.ctx.handoff.current('tools').recovery.gapId,
        independent: true,
        evidence: 'Reviewed durable records and independently reconciled inaccessible local work',
      },
      f.captain,
    );
  const read = (who = second) => f.run('read', {}, who);
  const accept = () => {
    const request = f.body('accept', { readId: read().readId, expectedEpoch: 1 });
    const result = f.ctx.handoff.control('tools', second, request);
    second.epoch = 2;
    return { request, result };
  };
  const pickup = () => {
    const receipt = read();
    return f.run('pickup', { readId: receipt.readId, revision: receipt.revision }, second);
  };
  const ticket = () => f.ctx.ownership.ticket(second, 'tools', 2, { to: 'firstmate' });
  return { ...f, second, read, accept, pickup, ticket, approve, expire, resolve };
}

test('recovery: owner approval, named successor, exact epoch and pickup preserve durable work', context => {
  const f = recoveryFixture(context);
  const shift = structuredClone(f.ctx.store.boards.tools.shift);
  f.expire();
  assert.equal(f.ctx.handoff.status('tools').presence, 'lost');
  assert.equal(f.ctx.handoff.status('tools').ownership.holderSessionId, f.first.sessionId);
  assert.throws(() => f.approve({}, f.second), /captain approval/);
  assert.throws(() => f.approve({ reason: '' }), /reason/);
  assert.throws(() => f.approve({ pendingDigest: 'unread' }), /review visible/);
  f.approve();
  const third = f.register('session-third');
  assert.throws(() => f.read(third), /named successor/);
  const answer = f.accept();
  assert.equal(answer.result.epoch, 2);
  assert.throws(() => f.ctx.ownership.acting(f.second, 'tools', 2), /not working/);
  f.ctx.change('comment', 'late-question', 'captain', 'tools');
  f.pickup();
  assert.deepEqual(f.ctx.store.boards.tools.shift, shift);
  assert.equal(f.ctx.handoff.current('tools').seal.degraded, true);
  assert.ok(f.ctx.handoff.current('tools').recovery.warnings.some(value => value.includes('Old disk unavailable')));
  assert.throws(() => f.ctx.ownership.renew(f.first, 'tools', 1, f.processId), /stale/);
  assert.throws(() => f.ctx.ownership.acting(f.first, 'tools', 1), /stale/);
  assert.equal(f.ctx.handoff.control('tools', f.second, answer.request).duplicate, true);
  assert.equal(f.ctx.ownership.record('tools').epoch, 2);
});

test('recovery: planned approval cannot become recovery; emergency requires explicit owner revocation', context => {
  const f = recoveryFixture(context);
  assert.throws(() => f.approve(), /explicit revocation/);
  f.approve({ revoke: true, reason: 'Explicitly revoke the partitioned holder on acceptance' });
  const before = f.ctx.ownership.record('tools').epoch;
  f.accept();
  assert.equal(f.ctx.ownership.record('tools').epoch, before + 1);
  f.pickup();
  assert.throws(() => f.ctx.ownership.holding(f.first, 'tools', 1), /stale/);
  f.ctx.ownership.record('tools').leaseUntil = Date.now() - 1;
  assert.throws(() => f.run('accept', { expectedEpoch: 2 }, f.first), /read this transfer/);
  assert.throws(() => f.approve({ expectedEpoch: 1 }), /epoch changed/);
  assert.throws(() => f.ctx.ownership.renew(f.second, 'tools', 2, 'old-process'), /lease expired/);
});

test('recovery: missing old disk blocks affected dispatch until independent gap reconciliation', context => {
  const f = recoveryFixture(context);
  f.expire();
  f.approve();
  f.accept();
  f.pickup();
  assert.throws(() => f.ticket(), /gap|paused/);
  f.resolve();
  assert.deepEqual(f.ctx.handoff.current('tools').heldTargets, []);
  assert.doesNotThrow(() => f.ticket());
  assert.equal(f.ctx.handoff.current('tools').seal.degraded, true);
  assert.ok(f.ctx.handoff.checkpoint('tools').completeness.includes('queue'));
});

test('recovery: a live predecessor cannot cancel the captain revocation', context => {
  const f = recoveryFixture(context);
  f.approve({ revoke: true });
  const cancel = { expectedEpoch: 1, pendingDigest: f.ctx.handoff.status('tools').pending.digest };
  assert.throws(() => f.run('cancel', cancel, f.first), /captain.*cancel.*recovery/);
  assert.equal(f.ctx.handoff.current('tools').status, 'sealed');
  assert.equal(f.ctx.ownership.record('tools').phase, 'draining');
  assert.throws(() => f.ctx.ownership.acting(f.first, 'tools', 1), /not working/);
  f.accept();
  f.pickup();
  assert.throws(() => f.ctx.ownership.renew(f.first, 'tools', 1, f.processId), /stale/);
});

test('recovery: captain cancellation releases only its synthetic pre-acceptance gap', context => {
  const f = recoveryFixture(context);
  f.approve({ revoke: true });
  const value = f.ctx.handoff.current('tools');
  f.run('cancel', { expectedEpoch: 1, pendingDigest: f.ctx.handoff.status('tools').pending.digest }, f.captain);
  const gap = f.ctx.dispatchLedger.record('tools').inventories[value.recovery.gapId];
  assert.equal(gap.resolved, true);
  assert.equal(f.ctx.ownership.record('tools').holderSessionId, f.first.sessionId);
  assert.equal(f.ctx.ownership.record('tools').epoch, 1);
  assert.doesNotThrow(() => f.ctx.ownership.ticket(f.first, 'tools', 1, { to: 'firstmate' }));
});

for (const mode of ['recovery', 'planned'])
  test('recovery: an unlocated original target cannot pin to a different installation after ' + mode, context => {
    const f = dispatchFixture(context);
    const next = f.register('session-remote', 'operator', 'install-remote');
    f.ctx.cfg.boards.tools.recoveryEnabled = true;
    const location = {
      machineId: 'machine-remote',
      homeId: 'home-remote',
      targetId: 'firstmate',
      targetInstallationId: 'install-test',
      routeHash: 'b'.repeat(64),
    };
    f.control({ action: 'locate', sessionId: next.sessionId, location });
    if (mode === 'recovery') {
      f.ctx.ownership.record('tools').leaseUntil = Date.now() - 1;
      f.run(
        'recover',
        {
          expectedEpoch: 1,
          successorSessionId: next.sessionId,
          reason: 'Lost original disk and unrecorded original location',
          oldDiskAvailable: false,
          pendingDigest: f.ctx.handoff.status('tools').pending.digest,
        },
        f.captain,
      );
    } else {
      f.run('prepare', { expectedEpoch: 1, successorSessionId: next.sessionId });
      f.save({
        ...require('./handoff-fixture').input(),
        targetBinding: {
          id: 'firstmate',
          installationId: 'install-test',
          freshness: 'fresh',
        },
      });
      f.seal();
    }
    const read = f.run('read', {}, next);
    f.run('accept', { expectedEpoch: 1, readId: read.readId }, next);
    next.epoch = 2;
    const pickup = f.run('read', {}, next);
    f.run('pickup', { readId: pickup.readId, revision: pickup.revision }, next);
    f.control({ action: 'locate', sessionId: next.sessionId, location });
    const saved = require('../handoff-checkpoint').checkpoint(
      f.ctx,
      'tools',
      next,
      {
        ...require('./handoff-fixture').input(),
        targetBinding: {
          id: 'firstmate',
          installationId: 'install-test',
          freshness: 'fresh',
        },
      },
      crypto.randomUUID(),
    );
    assert.equal(saved.targetBinding.machineId, undefined);
    assert.equal(f.ctx.dispatchLedger.record('tools').targetBinding.machineId, undefined);
    assert.equal(f.ctx.handoff.status('tools').targetAvailability, 'unknown');
    assert.throws(() => f.ctx.handoff.dispatch('tools', next, 'firstmate'), /paused/);
    assert.doesNotThrow(() => f.ctx.ownership.acting(next, 'tools', 2));
    f.ctx.ownership.record('tools').leaseUntil = Date.now() - 1;
    f.ctx.handoff.control('tools', f.captain, {
      action: 'recover',
      operationId: crypto.randomUUID(),
      transferId: crypto.randomUUID(),
      expectedEpoch: 2,
      successorSessionId: f.first.sessionId,
      reason: 'Another loss does not relocate the original worker',
      oldDiskAvailable: false,
      pendingDigest: f.ctx.handoff.status('tools').pending.digest,
    });
    assert.equal(f.ctx.dispatchLedger.record('tools').targetBinding.machineId, undefined);
  });

for (const [name, where, reachable] of [
  ['same home new session', {}, true],
  ['different home same machine', { homeId: 'home-successor', installationId: 'install-successor' }, true],
  ['different machine', { machineId: 'machine-successor', installationId: 'install-successor' }, false],
  ['substituted firstmate', { targetId: 'target-substitute' }, false],
  ['substituted local adapter', { routeHash: 'b'.repeat(64) }, false],
])
  test('recovery: ' + name + ' preserves the original external target', context => {
    const f = recoveryFixture(context, where);
    const original = structuredClone(f.ctx.dispatchLedger.record('tools').targetBinding);
    f.expire();
    f.approve();
    f.accept();
    f.pickup();
    f.resolve();
    const binding = f.ctx.dispatchLedger.status('tools').targetBinding;
    assert.equal(binding.id, original.id);
    assert.equal(binding.installationId, original.installationId);
    assert.equal(binding.machineId, 'machine-original');
    assert.doesNotThrow(() => f.ctx.ownership.acting(f.second, 'tools', 2));
    if (reachable) {
      assert.doesNotThrow(() => f.ticket());
      assert.doesNotThrow(() => f.ctx.dispatchLedger.guardTarget('tools', f.second, 'firstmate'));
    } else {
      assert.throws(() => f.ticket(), /paused/);
      assert.throws(() => f.ctx.dispatchLedger.guardTarget('tools', f.second, 'firstmate'), /paused/);
    }
  });

for (const recovery of [false, true])
  test(`handoff: successor reads only steward continuity metadata with recovery ${recovery}`, context => {
    const f = recoveryFixture(context);
    f.ctx.cfg.boards.tools.recoveryEnabled = recovery;
    const summaries = ['running', 'answered'].map(state => ({
      id: 'steward-' + state,
      board: 'tools',
      kind: 'ask',
      state,
      t: '2026-01-01T00:00:00Z',
      attempts: 1,
      runningSince: '2026-01-01T00:00:01Z',
      answeredAt: state === 'answered' ? '2026-01-01T00:00:02Z' : null,
      adviceId: state === 'answered' ? 'private-advice-id' : null,
    }));
    f.ctx.store.stewardRequests = Object.fromEntries(
      summaries.map(summary => [
        summary.id,
        {
          ...summary,
          cardId: 'private-consultation-card',
          askId: 'private-consultation-ask',
          text: 'captain-private-question',
          job: { text: 'captain-private-prior-advice' },
          lastError: 'captain-private-error',
          skippedWhy: 'captain-private-reason',
          futureField: { text: 'captain-private-future-data' },
        },
      ]),
    );
    f.ctx.store.stewardRequests.other = { id: 'other-board', board: 'lines', state: 'running' };
    const before = structuredClone(f.ctx.store.stewardRequests);
    if (recovery) {
      f.expire();
      f.approve();
    } else {
      f.prepare();
      f.save();
      f.seal(true);
    }
    const read = f.read();
    assert.deepEqual(read.steward, summaries);
    assert.equal(JSON.stringify(read).includes('captain-private-'), false);
    assert.equal(JSON.stringify(read).includes('private-consultation-'), false);
    assert.deepEqual(f.ctx.store.stewardRequests, before);
    read.steward[0].state = 'changed-copy';
    assert.equal(f.ctx.store.stewardRequests[summaries[0].id].state, 'running');
  });

test('recovery: helpers and steward evidence stay visible; S20 completion releases the conservative hold', context => {
  const f = recoveryFixture(context);
  const job = { id: 'steward-job', board: 'tools', state: 'running', attempts: 1, kind: 'review' };
  f.ctx.store.stewardRequests = { [job.id]: job };
  f.ctx.store.stewards = {};
  f.expire();
  f.approve();
  const read = f.read();
  assert.equal(read.steward[0].state, 'running');
  f.accept();
  f.pickup();
  assert.equal(job.state, 'running');
  f.resolve();
  assert.ok(f.ctx.handoff.current('tools').heldTargets.includes('steward'));
  const result = require('../steward-result')({
    ctx: f.ctx,
    cfg: f.ctx.cfg,
    S: () => f.ctx.store,
    now: () => new Date().toISOString(),
    clip: (text, length) => String(text || '').slice(0, length),
    decisionOf: () => null,
  }).result;
  const answer = result(
    { board: 'tools', name: 'independent-steward' },
    {
      request: job.id,
      silent: true,
      oneLine: 'Complete',
      text: '',
      claims: [],
    },
  );
  assert.equal(answer.status, 200);
  assert.equal(job.state, 'answered');
  assert.deepEqual(f.ctx.handoff.current('tools').heldTargets, []);
  assert.equal(f.ctx.store.stewards.tools.lastAnswer, job.answeredAt);
  f.ctx.handoff.current('tools').heldTargets = ['firstmate', 'steward'];
  assert.equal(result({ board: 'tools', name: 'independent-steward' }, { request: job.id }).status, 200);
  assert.deepEqual(f.ctx.handoff.current('tools').heldTargets, []);
});

test('recovery: off, lines, and unchanged locations retain the old authority boundary', context => {
  const f = recoveryFixture(context);
  const before = structuredClone(f.ctx.store);
  f.ctx.cfg.boards.tools.recoveryEnabled = false;
  assert.equal(f.ctx.handoff.status('tools').recoveryAvailable, false);
  assert.throws(() => f.approve({ revoke: true }), /recovery is disabled/);
  assert.deepEqual(f.ctx.store, before);
  assert.throws(
    () =>
      f.control({
        action: 'locate',
        sessionId: f.first.sessionId,
        location: {
          machineId: 'other-machine',
          homeId: 'home-original',
          targetId: 'firstmate',
          targetInstallationId: 'install-test',
          routeHash: 'a'.repeat(64),
        },
      }),
    /immutable/,
  );
  f.ctx.cfg.boards.lines.handoffEnabled = f.ctx.cfg.boards.lines.recoveryEnabled = true;
  assert.equal(f.ctx.handoff.recoveryEnabled('lines'), false);
});

test('recovery: approval expiry is checked at commit and failed acquisition cannot advance authority', context => {
  const f = recoveryFixture(context);
  f.expire();
  f.approve();
  const before = structuredClone(f.ctx.ownership.record('tools'));
  const original = f.ctx.beforeCommit;
  f.ctx.beforeCommit = guard =>
    original(() => {
      f.ctx.handoff.current('tools').recovery.expiresAt = 0;
      guard();
    });
  assert.throws(() => f.accept(), /fresh captain approval/);
  f.ctx.beforeCommit = original;
  assert.deepEqual(f.ctx.ownership.record('tools'), before);
  assert.equal(f.ctx.handoff.current('tools').status, 'sealed');
  assert.doesNotThrow(() => f.accept());
});

test('recovery: predecessor ticket-bound late evidence remains admissible but cannot authorize new work', context => {
  const f = recoveryFixture(context);
  f.ctx.cfg.boards.tools.recoveryEnabled = false;
  const ticket = f.issue();
  f.ctx.cfg.boards.tools.recoveryEnabled = true;
  f.expire();
  f.approve();
  f.accept();
  f.pickup();
  assert.doesNotThrow(() => f.ctx.ownership.evidence(f.first, 'tools', 1, ticket.id, ticket.evidenceCapability));
  assert.throws(() => f.ctx.ownership.ticket(f.first, 'tools', 1, { to: 'firstmate' }), /stale/);
  assert.throws(
    () =>
      f.ctx.transact(
        () => f.ctx.ownership.acting(f.first, 'tools', 1),
        () => assert.fail('stale queued write'),
      ),
    /stale/,
  );
});

for (const action of ['recover', 'accept'])
  for (const stage of ['written', 'flushed', 'renamed', 'committed'])
    test('recovery crash/retry at ' + action + '/' + stage + ' preserves approval and atomic authority', context => {
      const fs = require('node:fs');
      const path = require('node:path');
      const f = recoveryFixture(context);
      f.expire();
      let who = f.captain;
      let request = f.body('recover', {
        expectedEpoch: 1,
        successorSessionId: f.second.sessionId,
        reason: 'Lost holder',
        oldDiskAvailable: false,
        pendingDigest: f.ctx.handoff.status('tools').pending.digest,
      });
      if (action === 'accept') {
        f.ctx.handoff.control('tools', who, request);
        request = f.body('accept', { expectedEpoch: 1, readId: f.read().readId });
        who = f.second;
      }
      const shift = structuredClone(f.ctx.store.boards.tools.shift);
      f.ctx.saveNow();
      const child = require('node:child_process').spawnSync(
        process.execPath,
        [path.join(__dirname, 'handoff-crash-worker.cjs')],
        {
          input: JSON.stringify({ home: f.home, cfg: f.ctx.cfg, who, body: request, stage }),
          encoding: 'utf8',
          env: { ...process.env, TYPESAFE_API_KEY: '' },
        },
      );
      assert.notEqual(child.status, 0, child.stderr);
      assert.equal(child.stderr, '');
      const persisted = JSON.parse(fs.readFileSync(path.join(f.home, 'store.json'), 'utf8'));
      require('../durable-store').restore(f.ctx.store, persisted);
      const answer = f.ctx.handoff.control('tools', who, request);
      assert.equal(!!answer.duplicate, ['renamed', 'committed'].includes(stage));
      assert.equal(f.ctx.handoff.control('tools', who, request).duplicate, true);
      assert.equal(f.ctx.ownership.record('tools').epoch, action === 'accept' ? 2 : 1);
      assert.deepEqual(f.ctx.store.boards.tools.shift, shift);
      assert.equal(f.ctx.ownership.data().audit.filter(item => item.operationId === request.operationId).length, 1);
    });
