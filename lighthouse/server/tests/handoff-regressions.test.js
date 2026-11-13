'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { handoffFixture, input } = require('./handoff-fixture');
const { client } = require('../../operator-kit/scripts/handoff.cjs');
const ownershipHttp = require('./ownership-http-fixture');

test('enabled-board dry-run compaction preserves the complete durable store', async context => {
  const f = await ownershipHttp(context, true, { handoffEnabled: true });
  const requests = [];
  const helper = client({
    session: { sessionId: 'session-first', epoch: 1 },
    board: 'beta',
    saveEpoch: () => assert.fail('dry run cannot change epoch'),
    inventory: () => ({ queue: input().queue, relays: input().relays }),
    request: async (method, route, body) => {
      requests.push({ method, body });
      return f.request(method, route, body, f.first, 1);
    },
  });
  const file = path.join(f.directory, 'store.json');
  const warmup = await f.request(
    'POST',
    '/api/boards/beta/calls',
    { calls: [{ id: 'dry-run-fixture-status', tool: 'board_status', args: { dry_run: true } }] },
    f.first,
    1,
  );
  assert.equal(warmup.status, 200, warmup.raw);
  const before = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const action of ['compacting', 'compacted']) {
    const args = { action, dry_run: true, note: 'Preview only' };
    let legacyCalls = 0;
    const legacy = async () => {
      legacyCalls++;
      const response = await f.request(
        'POST',
        '/api/boards/beta/calls',
        { calls: [{ id: crypto.randomUUID(), tool: 'board_shift', args }] },
        f.first,
        1,
      );
      assert.equal(response.status, 200, response.raw);
      return { text: JSON.stringify(response.body) };
    };
    const result = (await helper.intercept('board_shift', args, legacy)) || (await legacy());
    assert.equal(result.isError, undefined, result.text);
    assert.equal(legacyCalls, 1);
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), before);
  }
  assert.equal(
    requests.some(request => request.method === 'POST'),
    false,
  );
  const status = await f.request('GET', '/api/boards/beta/handoff', null, f.first, 1);
  assert.equal(status.body.ownership.phase, 'working');
  assert.equal(status.body.ownership.epoch, 1);
});

test('same-session pickup does not turn pending effects into inherited dispatch holds', context => {
  for (const reason of ['compaction', 'reconnect']) {
    const f = handoffFixture(context);
    const shift = structuredClone(f.ctx.store.boards.tools.shift);
    f.ctx.store.stewardRequests = { active: { id: 'active', board: 'tools', state: 'running' } };
    f.ctx.store.tickets = { pending: { id: 'pending', board: 'tools', used: false } };
    f.run('checkpoint', { reason, checkpoint: input() });
    assert.deepEqual(f.ctx.handoff.current('tools').heldTargets, []);
    f.ctx.store.stewardRequests.active.state = 'done';
    f.pickup(f.first);
    assert.equal(f.ctx.handoff.paused('tools', 'steward'), false);
    assert.doesNotThrow(() => f.ctx.handoff.dispatch('tools', f.first, 'firstmate'));
    assert.deepEqual(f.ctx.store.boards.tools.shift, shift);
    assert.equal(f.ctx.ownership.record('tools').epoch, 1);
  }
});

test('cancel restores inherited holds so resolved effects allow another clean transfer', context => {
  for (const effect of ['steward', 'ticket']) {
    const f = handoffFixture(context);
    if (effect === 'steward')
      f.ctx.store.stewardRequests = { active: { id: 'active', board: 'tools', state: 'running' } };
    else f.ctx.store.tickets = { pending: { id: 'pending', board: 'tools', used: false } };
    f.prepare();
    f.save();
    f.seal(true);
    const pendingDigest = f.ctx.handoff.status('tools').pending.digest;
    f.run('cancel', { expectedEpoch: 1, pendingDigest });
    if (effect === 'steward') f.ctx.store.stewardRequests.active.state = 'done';
    else f.ctx.store.tickets.pending.used = true;
    assert.deepEqual(f.ctx.handoff.current('tools').heldTargets, []);
    assert.equal(f.ctx.handoff.paused('tools', 'steward'), false);
    assert.doesNotThrow(() => f.ctx.handoff.dispatch('tools', f.first, 'firstmate'));
    const transferId = crypto.randomUUID();
    f.run('prepare', { transferId, expectedEpoch: 1, successorSessionId: f.second.sessionId });
    f.run('checkpoint', { transferId, checkpoint: input() });
    assert.doesNotThrow(() => f.run('seal', { transferId }));
    assert.equal(f.ctx.ownership.record('tools').epoch, 1);
  }
});

test('cancel before checkpoint resumes dispatch without inventing effect holds', context => {
  const f = handoffFixture(context);
  f.prepare();
  f.run('cancel', { expectedEpoch: 1, pendingDigest: f.ctx.handoff.status('tools').pending.digest }, f.captain);
  assert.deepEqual(f.ctx.handoff.current('tools').heldTargets, []);
  assert.equal(f.ctx.handoff.paused('tools', 'steward'), false);
  assert.doesNotThrow(() => f.ctx.handoff.dispatch('tools', f.first, 'firstmate'));
  const transferId = crypto.randomUUID();
  f.run('prepare', { transferId, expectedEpoch: 1, successorSessionId: f.second.sessionId });
  f.run('checkpoint', { transferId, checkpoint: input() });
  assert.doesNotThrow(() => f.run('seal', { transferId }));
});

test('missing context blocks clean seal but holds only unresolved effects', context => {
  const f = handoffFixture(context);
  f.prepare();
  const checkpoint = input();
  checkpoint.cursors.freshness = 'missing';
  delete checkpoint.targetBinding;
  const saved = f.save(checkpoint).checkpoint;
  assert.equal(saved.targetBinding.installationId, f.first.sessionInstallationId);
  assert.equal(saved.targetBinding.freshness, 'fresh');
  assert.throws(() => f.seal(), /missing-or-stale:cursors/);
  f.seal(true);
  assert.deepEqual(f.ctx.handoff.current('tools').heldTargets, []);
  f.accept();
  f.pickup();
  assert.doesNotThrow(() => f.ctx.handoff.dispatch('tools', f.second, 'firstmate'));
  assert.throws(
    () =>
      f.ctx.handoff.dispatch(
        'tools',
        {
          ...f.second,
          sessionInstallationId: 'other-installation',
        },
        'firstmate',
      ),
    /dispatch paused/,
  );
});

test('pickup revision is board scoped and read retries do not persist live snapshots', context => {
  const f = handoffFixture(context);
  f.prepare();
  f.save();
  f.seal();
  f.accept();
  f.ctx.store.comments.large = { id: 'large', board: 'tools', text: 'x'.repeat(200000) };
  f.ctx.change('comment', 'large', 'captain', 'tools');
  const before = JSON.stringify(f.ctx.store).length;
  let request;
  let read;
  for (let index = 0; index < 5; index++) {
    request = f.body('read');
    read = f.ctx.handoff.control('tools', f.second, request);
    assert.equal(read.live.comments[0].text.length, 200000);
  }
  assert.ok(JSON.stringify(f.ctx.store).length - before < 10000);
  assert.equal(f.ctx.handoff.status('tools').transfer.changes, undefined);
  f.ctx.change('comment', 'unrelated', 'captain', 'lines');
  assert.doesNotThrow(() => f.run('pickup', { readId: read.readId, revision: read.revision }, f.second));
  f.ctx.store.comments.large.text = 'current';
  const retried = f.ctx.handoff.control('tools', f.second, request);
  assert.equal(retried.duplicate, true);
  assert.equal(retried.live.comments[0].text, 'current');
});

test('kit compaction preserves note, bounded context and pinned target', async context => {
  const f = handoffFixture(context);
  const shifts = structuredClone(f.ctx.store.boards.tools.shift);
  const calls = [];
  const helper = client({
    session: f.first,
    board: 'tools',
    saveEpoch: () => assert.fail('continuation cannot change epoch'),
    inventory: () => ({ queue: input().queue, relays: input().relays }),
    rules: 'Keep authoritative work on the board.',
    request: async (method, route, body) => {
      if (method === 'GET')
        return {
          status: 200,
          body: {
            ...f.ctx.handoff.status('tools'),
            checkpointRecord: f.ctx.handoff.checkpoint('tools'),
          },
        };
      calls.push(body);
      return { status: 200, body: f.ctx.handoff.control('tools', f.first, body) };
    },
  });
  for (const note of ['First context', 'New context wins']) {
    const result = await helper.intercept('board_shift', { action: 'compacting', note }, async () => {
      f.ctx.store.boards.tools.pickup = { note };
      return { text: 'legacy compacting acknowledged' };
    });
    assert.equal(result.isError, undefined);
    const saved = f.ctx.handoff.checkpoint('tools');
    assert.equal(saved.goal.value, note);
    assert.equal(saved.goal.freshness, 'fresh');
    assert.equal(saved.targetBinding.installationId, f.first.sessionInstallationId);
    assert.deepEqual(f.ctx.handoff.current('tools').heldTargets, []);
    assert.equal(await helper.paused(), true);
    const readResult = await helper.intercept('board_shift', { action: 'compacted' });
    assert.ok(readResult.text.includes(note));
    assert.ok(readResult.text.includes('RULES' + String.fromCharCode(10)));
    const read = f.run('read', { transferId: saved.transferId }, f.first);
    f.run('pickup', { transferId: saved.transferId, readId: read.readId, revision: read.revision }, f.first);
    assert.equal(await helper.paused(), false);
    assert.doesNotThrow(() => f.ctx.handoff.dispatch('tools', f.first, 'firstmate'));
    saved.authoritative.relayTickets = Array.from({ length: 900 }, (_, index) => ({ id: 'ticket-' + index }));
  }
  assert.ok(calls.every(call => !call.checkpoint || Buffer.byteLength(JSON.stringify(call.checkpoint)) < 48000));
  assert.ok(calls.every(call => !call.checkpoint?.authoritative));
  assert.equal(f.ctx.ownership.record('tools').epoch, 1);
  assert.deepEqual(f.ctx.store.boards.tools.shift, shifts);
});
