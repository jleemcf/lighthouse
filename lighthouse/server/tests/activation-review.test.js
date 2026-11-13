'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const fixture = require('./ownership-http-fixture');
const { callHash } = require('../dispatch-ledger');
const route = '/api/boards/beta/activation';
const id = () => crypto.randomUUID();
const view = async host => (await host.request('GET', route, null, 'CAPTAIN')).body;
const disk = host => JSON.parse(fs.readFileSync(path.join(host.directory, 'store.json')));
async function mode(host, action) {
  const state = await view(host);
  const result = await host.request(
    'POST',
    route,
    {
      action,
      operationId: id(),
      expectedEpoch: state.epoch,
      readiness: state.readiness,
      processIds: state.processIds,
      confirmAllWriters: true,
      confirmQuiesced: true,
    },
    'CAPTAIN',
  );
  assert.equal(result.status, 200, result.raw);
}
async function retireLegacy(host) {
  const state = await view(host);
  for (const process of state.processes.filter(value => value.protocol === 'legacy')) {
    const request = { action: 'detach', processId: process.id, expectedEpoch: state.epoch };
    assert.equal((await host.control(request)).status, 409, 'stopped-process attestation required');
    request.confirmStopped = true;
    assert.equal((await host.control(request)).status, 200);
    const audit = disk(host).sessionOwnership.audit.at(-1);
    assert.equal(audit.processId, process.id);
    assert.equal(audit.confirmedStopped, true);
    assert.equal(audit.by, 'captain');
  }
  assert.equal((await view(host)).ready, true);
}
const legacyWrite = host =>
  host.request(
    'POST',
    '/api/boards/beta/calls',
    {
      calls: [
        { id: id(), tool: 'board_post', args: { card: 'beta-work', kind: 'status', text: 'Legacy accepted work' } },
      ],
    },
    'TOOLS',
  );

test('LegacyRetirementAndReactivation retain work with explicit owner census repair', async context => {
  const host = await fixture(context, false);
  assert.equal((await legacyWrite(host)).body.results[0].ok, true);
  assert.equal((await view(host)).ready, false, 'legacy attachment blocks the barrier');
  assert.equal(
    (
      await host.control({
        action: 'detach',
        processId: host.processId,
        expectedEpoch: 1,
        confirmStopped: true,
      })
    ).status,
    409,
    'owner cannot silently remove the current holder',
  );
  await retireLegacy(host);
  await mode(host, 'activate');
  assert.equal(
    (
      await host.control({
        action: 'detach',
        processId: host.processId,
        expectedEpoch: 1,
        confirmStopped: true,
      })
    ).status,
    409,
    'owner retirement cannot bypass active fencing',
  );
  await mode(host, 'deactivate');
  assert.equal((await legacyWrite(host)).body.results[0].ok, true);
  const credential = await host.register('session-reactivation');
  await host.acquire('session-reactivation', credential, 2);
  const journalId = id();
  assert.equal(
    (
      await host.request(
        'POST',
        route,
        {
          action: 'inventory',
          operationId: id(),
          journalId,
          complete: true,
          calls: [],
          relays: [],
        },
        credential,
        3,
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await host.control(
        {
          action: 'attach',
          processId: id(),
          protocol: 'session-epochs-v1',
          journalId,
        },
        credential,
        3,
      )
    ).status,
    200,
  );
  await retireLegacy(host);
  const before = disk(host);
  await mode(host, 'activate');
  const after = disk(host);
  assert.deepEqual(after.comments, before.comments, 'reactivation retains accepted legacy work');
  assert.deepEqual(after.boards.beta.shift, before.boards.beta.shift);
  assert.equal(after.dispatchLedger.boards.beta.targetBinding.machineId, 'machine-original');
});

test('DeactivationPreservesSupersededCalls instead of replaying a terminal queue entry', async context => {
  const host = await fixture(context);
  const call = {
    id: id(),
    tool: 'board_post',
    args: { card: 'beta-work', kind: 'status', text: 'Must never run' },
    originSessionId: 'session-first',
    originEpoch: 1,
  };
  const journalId = id();
  const ledger = (action, body, credential = host.first, epoch = 1) =>
    host.request('POST', '/api/boards/beta/dispatch-ledger', { action, operationId: id(), ...body }, credential, epoch);
  assert.equal(
    (
      await ledger('inventory', {
        journalId,
        complete: true,
        calls: [{ ...call, hash: callHash(call) }],
        relays: [],
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await ledger('review-call', {
        callId: call.id,
        hash: callHash(call),
        disposition: 'superseded',
        reason: 'Owner reviewed obsolete work',
      })
    ).status,
    200,
  );
  await mode(host, 'deactivate');
  const before = disk(host).comments;
  const result = await host.request('POST', '/api/boards/beta/calls', { calls: [call] }, 'TOOLS');
  assert.equal(result.body.results[0].ok, false);
  assert.deepEqual(disk(host).comments, before, 'legacy queue drain cannot apply superseded work');
});

test('ResolvedJournalCanReconnect without weakening unresolved gap refusal', async context => {
  const host = await fixture(context);
  const journalId = id();
  const inventory = {
    action: 'inventory',
    operationId: id(),
    journalId,
    complete: false,
    gaps: ['fixture independent journal gap'],
    calls: [],
    relays: [],
  };
  assert.equal((await host.request('POST', route, inventory, host.first, 1)).status, 200);
  assert.deepEqual(
    disk(host).handoffActivation.operations['beta|' + inventory.operationId].result,
    { ok: true, journalId },
    'retry receipt never duplicates the full call inventory',
  );
  const attach = { action: 'attach', processId: id(), protocol: 'session-epochs-v1', journalId };
  assert.equal((await host.control(attach, host.first, 1)).status, 409);
  assert.equal(
    (
      await host.request(
        'POST',
        '/api/boards/beta/dispatch-ledger',
        {
          action: 'resolve-gap',
          operationId: id(),
          journalId,
          independent: true,
          evidence: 'Independent fixture records',
        },
        'CAPTAIN',
      )
    ).status,
    200,
  );
  inventory.operationId = id();
  assert.equal((await host.request('POST', route, inventory, host.first, 1)).status, 200);
  assert.equal((await host.control(attach, host.first, 1)).status, 200);
  assert.equal((await view(host)).ready, true, 'owner resolution survives republishing the same local gap');
});

test('SchemaFiveRequiresMatchingRegistry when the durable migration says it is required', context => {
  const host = require('./registry-fixture').fixture(context);
  const file = path.join(host.directory, 'schema-five.json');
  fs.writeFileSync(file, JSON.stringify({ schemaVersion: 5, dispatchLedger: { registryRequired: true } }));
  assert.throws(
    () => require('../registry').makeRegistry({ boards: {}, storeFile: file }, host.configPath),
    /requires its durable registry/,
  );
});

test('ActivationRequiresAPinnableOriginalTarget instead of immediately pausing dispatch', async context => {
  const host = await fixture(context, false);
  const credential = crypto.randomBytes(32).toString('base64url');
  assert.equal(
    (
      await host.control({
        action: 'register',
        sessionId: 'session-wrong-target',
        installationId: 'install-test',
        principal: 'beta',
        credential,
        location: {
          machineId: 'machine-other',
          homeId: 'home-other',
          targetId: 'wrong-target',
          targetInstallationId: 'install-test',
          routeHash: 'a'.repeat(64),
        },
      })
    ).status,
    200,
  );
  await host.acquire('session-wrong-target', credential, 1);
  const state = await view(host);
  assert.ok(state.blockers.includes('verified-original-target-location-required'));
  assert.equal(
    (
      await host.request(
        'POST',
        route,
        {
          action: 'activate',
          operationId: id(),
          expectedEpoch: 2,
          readiness: state.readiness,
          processIds: state.processIds,
          confirmAllWriters: true,
        },
        'CAPTAIN',
      )
    ).status,
    409,
  );
});
