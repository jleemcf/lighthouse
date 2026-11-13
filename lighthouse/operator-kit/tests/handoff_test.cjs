'use strict';
require('../../tests/sandbox.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { client, fromHome } = require('../scripts/handoff.cjs');
const relayFixture = require('../../verification/relay/adapter.cjs');

test('draining and pickup settle relay evidence while preserving ordinary queued work', async context => {
  for (const phase of ['draining', 'pickup']) {
    const home = relayFixture.fixture(context);
    const queued = JSON.stringify({ id: 'ordinary-pending', tool: 'board_status', args: {} });
    fs.writeFileSync(path.join(home, 'calls-outbox.jsonl'), queued + String.fromCharCode(10));
    const receipt = {
      id: 'relay-evidence',
      state: 'delivered-awaiting-record',
      args: { ticket: relayFixture.ticket.id, delivered: true },
    };
    fs.writeFileSync(path.join(home, 'relay-results.jsonl'), JSON.stringify(receipt) + String.fromCharCode(10));
    const helper = relayFixture.adapter(home, {
      session: { sessionId: 'session-test', epoch: 1 },
      handoffState: { enabled: true, ownership: { phase } },
    });
    await helper.drain();
    assert.deepEqual(
      helper.requests.map(call => call.tool),
      ['_relay_result'],
    );
    assert.equal(relayFixture.journal(home)[0].state, 'recorded');
    assert.equal(fs.readFileSync(path.join(home, 'calls-outbox.jsonl'), 'utf8').trim(), queued);
    assert.equal(fs.existsSync(path.join(home, 'calls-undelivered.jsonl')), false);
  }
});

test('real MCP drain preserves queued work during pickup, including a phase-change race', async context => {
  for (const race of [false, true]) {
    const home = relayFixture.fixture(context);
    const queue = path.join(home, 'calls-outbox.jsonl');
    const item = { id: 'queued-before-pickup', tool: 'board_status', args: {} };
    const bytes = JSON.stringify(item) + String.fromCharCode(10);
    fs.writeFileSync(queue, bytes);
    const state = { enabled: true, ownership: { phase: race ? 'working' : 'pickup' } };
    const helper = relayFixture.adapter(home, {
      session: { sessionId: 'session-test', epoch: 1 },
      handoffState: state,
      call: () => {
        state.ownership.phase = 'pickup';
        return { status: 409, body: { error: 'not working' } };
      },
    });
    await helper.drain();
    assert.equal(fs.readFileSync(queue, 'utf8'), bytes);
    assert.equal(fs.existsSync(path.join(home, 'calls-undelivered.jsonl')), false);
    assert.equal(helper.requests.length, race ? 1 : 0);
  }
});

function fixture(enabled = true) {
  const session = { sessionId: 'session-second', epoch: 1 };
  const calls = [];
  const state = {
    enabled,
    ownership: { holderSessionId: session.sessionId, epoch: 2, phase: 'pickup' },
    transfer: { id: 'transfer-test' },
  };
  const helper = client({
    session,
    board: 'tools',
    saveEpoch: epoch => {
      session.epoch = epoch;
    },
    inventory: () => ({
      queue: { freshness: 'fresh', observedAt: 1, value: [] },
      relays: { freshness: 'fresh', observedAt: 1, value: [] },
    }),
    request: async (method, route, input) => {
      calls.push({ method, route, input });
      return { status: 200, body: method === 'GET' ? state : { ok: true, epoch: 2 } };
    },
  });
  return { helper, calls, session, state };
}
test('handoff tools leave legacy compaction and tools unchanged while off', async () => {
  const f = fixture(false);
  assert.equal(await f.helper.supported(), false);
  assert.equal(await f.helper.intercept('board_shift', { action: 'compacting' }), null);
  assert.equal(await f.helper.intercept('board_status', {}), null);
  assert.equal(
    f.calls.every(call => call.method === 'GET'),
    true,
  );
});
test('handoff accept retries retain the exact operation even after adopting the newer epoch', async () => {
  const f = fixture();
  const input = {
    action: 'accept',
    operationId: 'accept-test',
    expectedEpoch: 1,
    transferId: 'transfer-test',
    readId: 'read-test',
  };
  await f.helper.call('board_transfer', input);
  assert.equal(f.session.epoch, 2);
  await f.helper.call('board_transfer', input);
  assert.deepEqual(f.calls[0].input, f.calls[1].input);
  assert.equal((await f.helper.call('board_transfer', { ...input, expectedEpoch: undefined })).isError, true);
});
test('handoff page-accepted session reconnect adopts only its own proven holder epoch', async () => {
  const f = fixture();
  f.state.ownership.holderSessionId = 'another-session';
  await f.helper.call('board_pickup', { action: 'status' });
  assert.equal(f.session.epoch, 1);
  f.state.ownership.holderSessionId = f.session.sessionId;
  await f.helper.call('board_pickup', { action: 'status' });
  assert.equal(f.session.epoch, 2);
});
test('compaction checkpoints and reads the shared pickup path but never acknowledges for the operator', async () => {
  const f = fixture();
  await f.helper.intercept('board_shift', { action: 'compacting', note: 'Durable work references only' });
  const saved = f.calls.find(call => call.input?.action === 'checkpoint').input;
  assert.equal(saved.reason, 'compaction');
  assert.equal(saved.checkpoint.version, 1);
  assert.equal(saved.checkpoint.goal.freshness, 'fresh');
  await f.helper.intercept('board_shift', { action: 'compacted' });
  assert.equal(
    f.calls.some(call => call.input?.action === 'read'),
    true,
  );
  assert.equal(
    f.calls.some(call => call.input?.action === 'pickup'),
    false,
  );
});
test('local checkpoint manifest contains strict references, not instructions or capabilities', async context => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'handoff-kit-'));
  context.after(() => fs.rmSync(home, { recursive: true, force: true }));
  fs.writeFileSync(
    path.join(home, 'calls-outbox.jsonl'),
    JSON.stringify({
      id: 'queued-one',
      args: {
        source: 'Private queued instructions',
        evidenceCapability: 'synthetic-private-value',
      },
    }) + '\n',
  );
  let saved;
  const helper = fromHome({
    session: { epoch: 1 },
    board: 'tools',
    home,
    request: async (method, route, input) => {
      saved = input;
      return { status: 200, body: { ok: true } };
    },
  });
  await helper.call('board_checkpoint', { operationId: 'manifest-test', checkpoint: { version: 1 } });
  assert.equal(saved.checkpoint.queue.value[0].id, 'queued-one');
  assert.doesNotMatch(JSON.stringify(saved), /Private queued|synthetic-private/);
  fs.writeFileSync(path.join(home, 'relay-results.jsonl'), 'invalid');
  await helper.call('board_checkpoint', { operationId: 'manifest-next', checkpoint: { version: 1 } });
  assert.equal(saved.checkpoint.relays.freshness, 'missing');
});
