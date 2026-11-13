'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const fixture = require('./ownership-http-fixture');
const { writePrivate, protect } = require('../registry-files');
const cli = require('../activation-cli');
const client = require('../../operator-kit/scripts/activation-client.cjs');
const storage = require('../../operator-kit/scripts/dispatch-storage.cjs');
const id = () => crypto.randomUUID();
const route = '/api/boards/beta/activation';
const view = async host => (await host.request('GET', route, null, 'CAPTAIN')).body;
const disk = host => JSON.parse(fs.readFileSync(path.join(host.directory, 'store.json')));

test('OwnerRepairsPreactivationGap only with independent evidence and the current epoch', async context => {
  const host = await fixture(context, false);
  const before = await view(host);
  const journalId = before.processes[0].journalId;
  const inventory = { action: 'inventory', journalId, complete: false, gaps: ['fixture gap'], calls: [], relays: [] };
  const publish = complete => host.request('POST', route, { ...inventory, complete, operationId: id() }, host.first, 1);
  assert.equal((await publish(false)).status, 200);
  assert.equal((await publish(true)).body.inventory.complete, false, 'repair alone cannot erase recorded uncertainty');
  const resolution = {
    action: 'resolve-gap',
    operationId: id(),
    expectedEpoch: 1,
    journalId,
    independent: true,
    evidence: 'Independent fixture records account for every missing entry',
  };
  assert.equal((await host.request('POST', route, resolution, host.first, 1)).status, 403);
  assert.equal((await host.request('POST', route, { ...resolution, expectedEpoch: 0 }, 'CAPTAIN')).status, 409);
  assert.equal((await host.request('POST', route, { ...resolution, independent: false }, 'CAPTAIN')).status, 403);
  assert.equal((await view(host)).ready, false);
  const endpoint = 'http://127.0.0.1:' + host.port;
  const owner = path.join(host.directory, 'repair-owner.json');
  const input = path.join(host.directory, 'repair-plan.json');
  writePrivate(owner, { credential: 'CAPTAIN' });
  writePrivate(input, { endpoint, board: 'beta', resolution });
  const args = ['resolve-gap', '--endpoint', endpoint, '--board', 'beta', '--credential-file', owner, '--input', input];
  assert.equal((await cli.run([...args])).enabled, false);
  assert.equal((await cli.run([...args])).duplicate, true);
  assert.equal((await publish(true)).body.inventory.complete, true);
  const after = await view(host);
  assert.equal(after.ready, true);
  assert.equal(after.enabled, false, 'repair never activates');
  assert.equal(after.epoch, before.epoch);
  assert.equal(disk(host).handoffActivation.audit.at(-1).action, 'resolve-gap');
  assert.equal(disk(host).dispatchLedger.boards.beta.inventories[journalId].resolution.by, 'captain');
});

test('PagedMigration preserves every entry, blocks partial readiness and resumes after a lost ACK', async context => {
  const host = await fixture(context, false);
  const home = path.join(host.directory, 'migration-home');
  fs.mkdirSync(home);
  protect(home, true);
  writePrivate(path.join(home, 'KIT-MANIFEST.json'), {
    release: 'a'.repeat(40),
    files: {},
    mcpVersion: 'a'.repeat(64),
  });
  const calls = Array.from({ length: 1001 }, () => ({
    id: id(),
    tool: 'board_post',
    args: { text: 'Fixture history '.repeat(30) },
  }));
  writePrivate(path.join(home, 'calls-undelivered.jsonl'), {});
  fs.writeFileSync(path.join(home, 'calls-undelivered.jsonl'), calls.map(call => JSON.stringify(call)).join('\n'));
  const session = { activation: { home, kit: { loaded: 'a'.repeat(64) } } };
  const requests = [];
  let loseAck = true;
  const request = async (method, target, body) => {
    requests.push(structuredClone(body));
    assert.ok(body.calls.length + body.relays.length <= 1000);
    assert.ok(Buffer.byteLength(JSON.stringify(body)) < 140000);
    const result = await host.request(method, target, body, host.first, 1);
    assert.equal(result.status, 200, result.raw);
    if (loseAck) {
      loseAck = false;
      throw new Error('fixture lost committed ACK');
    }
    return result;
  };
  await assert.rejects(client.prepare(session, request, 'beta'), /lost committed ACK/);
  const first = requests[0];
  const committedCalls = structuredClone(disk(host).dispatchLedger.boards.beta.calls);
  assert.equal(Object.keys(committedCalls).length, first.calls.length, 'the lost ACK page is already durable');
  for (const call of first.calls) assert.equal(committedCalls[call.id].hash, call.hash);
  const processId = id();
  assert.equal(
    (
      await host.control(
        { action: 'attach', processId, protocol: 'session-epochs-v1', journalId: first.journalId },
        host.first,
        1,
      )
    ).status,
    200,
  );
  assert.equal((await view(host)).ready, false, 'a partial census cannot pass the barrier');
  assert.equal((await host.request('POST', route, first, host.first, 1)).body.duplicate, true);
  const invalid = { ...first, operationId: id(), migration: { ...first.migration, index: first.migration.parts - 1 } };
  assert.equal((await host.request('POST', route, invalid, host.first, 1)).status, 409);
  assert.equal(
    (
      await host.request(
        'POST',
        route,
        {
          action: 'resolve-gap',
          operationId: id(),
          expectedEpoch: 1,
          journalId: first.journalId,
          independent: true,
          evidence: 'Cannot skip unreceived pages',
        },
        'CAPTAIN',
      )
    ).status,
    409,
  );
  const result = await client.prepare(session, request, 'beta');
  assert.equal(result.journalVersion, 1);
  assert.ok(requests.length > 2);
  const saved = disk(host).dispatchLedger.boards.beta;
  assert.equal(saved.inventories[first.journalId].complete, true);
  assert.equal(saved.inventories[first.journalId].migration, undefined);
  assert.equal(Object.keys(saved.calls).length, calls.length);
  for (const call of calls) {
    assert.equal(saved.calls[call.id].hash, storage.callHash(call));
    assert.equal(saved.calls[call.id].disposition, 'rejected');
  }
  assert.equal((await view(host)).ready, true);
  assert.equal((await view(host)).enabled, false);
  assert.equal((await host.request('POST', route, invalid, host.first, 1)).status, 409);
  const census = await view(host);
  assert.equal(
    (
      await host.request(
        'POST',
        route,
        {
          action: 'activate',
          operationId: id(),
          expectedEpoch: 1,
          confirmAllWriters: true,
          processIds: census.processIds,
          readiness: census.readiness,
        },
        'CAPTAIN',
      )
    ).status,
    200,
  );
  Object.assign(session, { sessionId: 'session-first', epoch: 1, processId });
  const activeClient = require('../../operator-kit/scripts/dispatch-client.cjs').client({
    home,
    board: 'beta',
    session,
    request: async (method, target, body) => {
      if (body?.action === 'inventory') assert.ok(body.calls.length + body.relays.length <= 1000);
      return host.request(method, target, body, host.first, 1);
    },
  });
  assert.equal(await activeClient.drain([calls[0]]), true, 'large active journals must drain');
  const published = JSON.parse((await activeClient.tool({ action: 'inventory' })).text);
  assert.equal(published.calls.length, calls.length, 'active inventory returns every page result');
  assert.equal((await activeClient.inventory()).calls.length, calls.length, 'import uses the same paged client');
  for (const call of first.calls)
    assert.deepEqual(disk(host).dispatchLedger.boards.beta.calls[call.id].history, committedCalls[call.id].history);
});

test('ActiveReconnectRequiresEveryPage even when a journal was already complete', async context => {
  const host = await fixture(context);
  const state = await view(host);
  const journalId = state.processes[0].journalId;
  const migration = { id: id(), hash: 'b'.repeat(64), parts: 2, index: 0 };
  const page = {
    action: 'inventory',
    operationId: id(),
    journalId,
    complete: true,
    gaps: [],
    calls: [],
    relays: [],
    migration,
  };
  assert.equal((await host.request('POST', route, page, host.first, 1)).status, 200);
  const attach = { action: 'attach', processId: id(), protocol: 'session-epochs-v1', journalId };
  assert.equal((await host.control(attach, host.first, 1)).status, 409);
  for (const changed of [{ hash: 'c'.repeat(64) }, { parts: 3 }, { id: id() }]) {
    const invalid = { ...page, operationId: id(), migration: { ...migration, index: 1, ...changed } };
    assert.equal((await host.request('POST', route, invalid, host.first, 1)).status, 409);
  }
  const final = { ...page, operationId: id(), migration: { ...migration, index: 1 } };
  assert.equal((await host.request('POST', route, final, host.first, 1)).status, 200);
  assert.equal((await host.control(attach, host.first, 1)).status, 200);
  assert.equal((await view(host)).enabled, true);
});

test('MigrationPages bound bytes and entries without dropping call or relay evidence', () => {
  const snapshot = { journalId: id(), complete: true, gaps: [], calls: [], relays: [] };
  snapshot.calls = Array.from({ length: 5 }, () => ({ id: id(), text: 'x'.repeat(70000) }));
  snapshot.relays = Array.from({ length: 1001 }, () => ({ id: id(), state: 'unknown' }));
  const pages = client.pages(snapshot);
  assert.deepEqual(
    pages.flatMap(page => page.calls),
    snapshot.calls,
  );
  assert.deepEqual(
    pages.flatMap(page => page.relays),
    snapshot.relays,
  );
  assert.ok(pages.every(page => page.calls.length + page.relays.length <= 1000));
  assert.ok(pages.every(page => Buffer.byteLength(JSON.stringify(page)) < 140000));
  assert.throws(() => client.pages({ ...snapshot, calls: [{ text: 'x'.repeat(128001) }] }), /without discarding/);
});
