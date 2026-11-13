'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { setTimeout: wait } = require('node:timers/promises');
const { fixture, write } = require('../../verification/activation-fixture.cjs');
const { flow } = require('../../verification/activation-flow.cjs');

test('activation rehearsal rereads pickup after an independent board revision', async context => {
  const host = await fixture(context);
  const protocol = flow(host);
  const first = await protocol.register('session-first');
  const second = await protocol.register('session-second');
  await protocol.acquire(first);
  await protocol.attach(first, 1);
  await protocol.activate();
  const original = host.ok;
  let reads = 0;
  host.ok = async (...args) => {
    const result = await original(...args);
    if (args[1] === 'handoff' && args[2].action === 'read' && ++reads === 2)
      await protocol.register('session-background');
    return result;
  };
  await protocol.planned(first, second, 1);
  assert.equal(reads, 3, 'one independent write forces a fresh pickup read');
  assert.equal((await protocol.status()).ownership.holderSessionId, second.sessionId);
});

test('SingleSend + LateEvidence + StewardContinuous + GenerationRetirement + RemotePause', async context => {
  const cleanup = [];
  context.after(async () => {
    for (const close of cleanup.reverse()) await close();
  });
  const host = await fixture({ after: close => cleanup.push(close) });
  const protocol = flow(host);
  const first = await protocol.register('session-original');
  const second = await protocol.register('session-successor');
  const remote = await protocol.register('session-remote', 'fixture-other-machine');
  const recovered = await protocol.register('session-recovered');
  await protocol.acquire(first);
  const local = await protocol.attach(first, 1);
  await protocol.activate();
  await host.stop();
  const stored = host.disk();
  stored.comments['message-harbor'] = {
    id: 'message-harbor',
    board: 'harbor',
    by: 'captain',
    text: 'Fixture owner instruction for firstmate',
    t: new Date().toISOString(),
  };
  stored.stewardRequests = {
    '0123456789abcdef': {
      id: '0123456789abcdef',
      board: 'harbor',
      kind: 'ask',
      text: 'Fixture consultation',
      state: 'pending',
      attempts: 0,
      priority: 0,
      t: new Date().toISOString(),
    },
  };
  write(path.join(host.home, 'store.json'), stored);
  await host.start();
  async function actor(mode, extra = {}) {
    const marker = path.join(host.root, mode + '-started.json');
    const release = path.join(host.root, mode + '-release');
    const file = path.join(host.root, mode + '-private.json');
    write(file, {
      mode,
      marker,
      release,
      home: local.home,
      board: 'harbor',
      session: { ...first, epoch: 1 },
      endpoint: host.endpoint,
      ...extra,
    });
    const child = spawn(process.execPath, [path.resolve(__dirname, '../../verification/activation-actor.cjs'), file], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let errors = '';
    child.stderr.on('data', bytes => {
      errors += bytes;
    });
    cleanup.push(async () => {
      if (child.exitCode === null && child.signalCode === null) {
        const stopped = once(child, 'exit');
        child.kill();
        await stopped;
      }
    });
    for (let count = 0; count < 200 && !fs.existsSync(marker); count++) {
      assert.equal(child.exitCode, null, errors);
      await wait(20);
    }
    assert.ok(fs.existsSync(marker), mode + ' actual process started: ' + errors);
    return { child, marker, release, errors: () => errors };
  }
  const steward = await actor('steward', { session: { credential: 'synthetic-steward' } });
  const stewardBefore = JSON.parse(fs.readFileSync(steward.marker));
  const helperMarker = path.join(host.root, 'helper-ticks.json');
  const idle = path.join(host.root, 'idle-private.json');
  write(idle, { mode: 'idle', marker: helperMarker });
  const supervised = await require('../../operator-kit/scripts/helper-runner.cjs').supervise({
    home: local.home,
    board: 'harbor',
    session: { ...first, epoch: 1 },
    kind: 'boardwatch',
    request: () => protocol.status(first, 1),
    command: process.execPath,
    args: [path.resolve(__dirname, '../../verification/activation-actor.cjs'), idle],
    stdio: 'ignore',
  });
  cleanup.push(() => supervised.close());
  const comments = await fetch(host.endpoint + '/api/comments?board=harbor', {
    headers: { Authorization: 'Bearer ' + first.credential, 'X-Lighthouse-Epoch': '1' },
  }).then(response => response.json());
  const source = comments.comments.find(item => item.id === 'message-harbor').sid;
  const issue = (epoch, again = false) =>
    host.ok(
      'harbor',
      'calls',
      {
        calls: [
          {
            id: host.id(),
            tool: 'board_relay',
            args: { source, to: 'firstmate', dispatchProtocol: 'dispatch-ledger-v1', again },
          },
        ],
      },
      (epoch === 1 ? first : epoch === 2 ? second : remote).credential,
      epoch,
    );
  await host.ok('harbor', 'calls', { calls: [{ id: host.id(), tool: 'board_status', args: {} }] }, first.credential, 1);
  const issued = await issue(1);
  const ticket = issued.ticket;
  assert.ok(ticket?.permissionId, 'a durable intent precedes transport: ' + JSON.stringify(issued));
  const route = await actor('route', { ticket, receiptId: host.id() });
  await protocol.planned(first, second, 1, true);
  assert.equal(
    host.disk().handoffs.bindings.harbor.machineId,
    'fixture-original',
    'checkpoint keeps the immutable machine pin for later reactivation',
  );
  const repeated = await host.request(
    'harbor',
    'dispatch-ledger',
    {
      action: 'consume',
      operationId: host.id(),
      intentId: ticket.intentId,
      attemptId: ticket.attemptId,
      permissionId: ticket.permissionId,
    },
    second.credential,
    2,
  );
  assert.equal(repeated.status, 200);
  assert.equal(repeated.body.dispatch, false, 'new home cannot reuse predecessor dispatch permission');
  assert.equal((await issue(2)).results[0].ok, false, 'handoff cannot resend started transport');
  for (
    let count = 0;
    count < 200 && supervised.child.signalCode === null && supervised.child.exitCode === null;
    count++
  )
    await wait(20);
  assert.ok(
    supervised.child.signalCode || supervised.child.exitCode === 0,
    'generation-owned actual helper exits after relief',
  );
  assert.equal(fs.existsSync(supervised.helper.file), false, 'old generation lease is removed');
  assert.equal(
    require('../../operator-kit/scripts/helper-generation.cjs').alive(supervised.helper.file, supervised.helper.id),
    false,
    'retired helper cannot regain authority',
  );
  const finished = once(route.child, 'exit');
  fs.writeFileSync(route.release, 'complete');
  await finished;
  assert.equal(route.child.exitCode, 0, route.errors());
  assert.equal(
    fs.readFileSync(path.join(local.home, 'sends.jsonl'), 'utf8').trim().split('\n').length,
    1,
    'one actual transport start across handoff',
  );
  const ledger = (await host.request('harbor', 'dispatch-ledger', null, second.credential, 2, 'GET')).body;
  assert.equal(ledger.attempts[0].state, 'delivered', 'old epoch evidence settles after relief');
  await protocol.planned(second, remote, 2, true);
  const target = (await protocol.status(remote, 3)).targetBinding;
  assert.equal(target.machineId, 'fixture-original', 'cross-machine pickup preserves the original route');
  const beforePause = host.disk().dispatchLedger.boards.harbor;
  const paused = (await issue(3, true)).results[0];
  assert.equal(paused.ok, false, 'cross-machine dispatch pauses, never migrates target');
  assert.match(paused.reason, /dispatch paused/, 'witness reaches the unavailable-original-route guard');
  assert.equal((await protocol.status(remote, 3)).targetAvailability, 'different-machine');
  const afterPause = host.disk().dispatchLedger.boards.harbor;
  assert.deepEqual(afterPause.intents, beforePause.intents, 'paused dispatch creates no intent');
  assert.deepEqual(afterPause.attempts, beforePause.attempts, 'paused dispatch creates no attempt');
  await protocol.recover(recovered, 3);
  assert.equal(
    (await protocol.status(recovered, 4)).ownership.phase,
    'working',
    'owner-approved recovery also leaves independent steward work running',
  );
  const stewardAfter = JSON.parse(fs.readFileSync(steward.marker));
  assert.equal(stewardAfter.pid, stewardBefore.pid, 'steward is never restarted by an operator handoff');
  assert.deepEqual(stewardAfter.job, stewardBefore.job, 'same independent steward attempt survives');
  assert.ok(stewardAfter.ticks > stewardBefore.ticks, 'steward actually ran during the handoff');
  const answered = once(steward.child, 'exit');
  fs.writeFileSync(steward.release, 'complete');
  await answered;
  assert.equal(steward.child.exitCode, 0, steward.errors());
  assert.equal(host.disk().stewardRequests['0123456789abcdef'].attempts, 1);
});
