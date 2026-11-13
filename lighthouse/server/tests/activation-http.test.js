'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const fixture = require('./ownership-http-fixture');
const cli = require('../activation-cli');
const route = '/api/boards/beta/activation';
const id = () => crypto.randomUUID();
const inspect = async fixture => (await fixture.request('GET', route, null, 'CAPTAIN')).body;
const activate = async (fixture, view = null, extra = {}, credential = 'CAPTAIN') => {
  view ||= await inspect(fixture);
  return fixture.request(
    'POST',
    route,
    {
      action: 'activate',
      operationId: id(),
      expectedEpoch: view.epoch,
      processIds: view.processIds,
      readiness: view.readiness,
      confirmAllWriters: true,
      ...extra,
    },
    credential,
    1,
  );
};

test('ActivationBarrierRejectsEveryMixedProcessVersionAndJournalAndStaleInspection', async context => {
  const f = await fixture(context, false);
  assert.equal((await inspect(f)).ready, true);
  for (const change of [
    { protocol: 'legacy' },
    { kitVersion: 'older-kit' },
    { loadedMcp: 'b'.repeat(64) },
    { installedMcp: null },
    { journalVersion: 0 },
    { journalId: 'unknown-journal' },
    { capabilities: [] },
  ]) {
    const attached = await f.control(
      {
        action: 'attach',
        processId: f.processId,
        protocol: 'session-epochs-v1',
        ...change,
      },
      f.first,
      1,
    );
    assert.equal(attached.status, 200, attached.raw);
    assert.equal((await inspect(f)).ready, false, JSON.stringify(change));
    assert.equal((await activate(f)).status, 409, JSON.stringify(change));
  }
  await f.control({ action: 'attach', processId: f.processId, protocol: 'session-epochs-v1' }, f.first, 1);
  const before = await inspect(f);
  const another = id();
  await f.control({ action: 'attach', processId: another, protocol: 'session-epochs-v1' }, f.first, 1);
  assert.equal((await activate(f, before)).status, 409, 'new writer invalidates the readiness receipt');
  assert.equal((await activate(f, null, { confirmAllWriters: false })).status, 409);
  assert.equal((await activate(f, null, { processIds: [f.processId] })).status, 409);
  assert.equal((await activate(f, null, {}, f.first)).status, 403, 'operator cannot activate');
  assert.equal((await activate(f)).status, 200);
  for (const change of [
    { protocol: 'legacy' },
    { kitVersion: 'older-kit' },
    { loadedMcp: 'b'.repeat(64) },
    { installedMcp: null },
    { journalVersion: 0 },
    { journalId: 'unknown-journal' },
    { capabilities: [] },
  ])
    assert.equal(
      (
        await f.control(
          {
            action: 'attach',
            processId: id(),
            protocol: 'session-epochs-v1',
            ...change,
          },
          f.first,
          1,
        )
      ).status,
      409,
      'incompatible process refused after activation: ' + JSON.stringify(change),
    );
});

test('NamedActivationIsOwnerOnlyToolsOnlyAndDormantFlagsCannotEnableHandoff', async context => {
  const f = await fixture(context, false, {
    handoffEnabled: true,
    dispatchLedgerEnabled: true,
    recoveryEnabled: true,
  });
  assert.deepEqual((await f.request('GET', '/api/boards/beta/handoff', null, f.first, 1)).body, { enabled: false });
  assert.equal((await f.request('GET', '/api/boards/alpha/activation', null, 'CAPTAIN')).status, 403);
  assert.equal((await f.request('GET', '/api/boards/alpha/activation', null, 'OWNER')).status, 409);
  const board = JSON.parse(fs.readFileSync(path.join(f.directory, 'store.json'))).boards.alpha;
  assert.equal(
    (
      await f.control({
        action: 'activate',
        expectedEpoch: 1,
        confirmAllWriters: true,
        processIds: [f.processId],
        readiness: (await inspect(f)).readiness,
      })
    ).status,
    409,
    'ownership-only activation cannot leave an enforcing but nonactivated board',
  );
  assert.equal(
    (
      await f.request(
        'POST',
        route,
        {
          action: 'activate',
          operationId: id(),
        },
        'CAPTAIN',
        undefined,
        { Origin: 'http://127.0.0.1:' + f.port },
      )
    ).status,
    403,
  );
  assert.equal((await activate(f)).status, 200);
  const store = JSON.parse(fs.readFileSync(path.join(f.directory, 'store.json')));
  assert.deepEqual(store.boards.alpha, board, 'another board is byte-equivalent in the persisted snapshot');
  assert.equal(store.handoffActivation.boards.alpha, undefined);
  assert.equal(store.schemaVersion, 5);
});

test('OwnerCommandVerifiesScopedActivationAndLosslessFencedDeactivation', async context => {
  const f = await fixture(context, false);
  const owner = path.join(f.directory, 'owner.json');
  const plan = path.join(f.directory, 'activation-plan.json');
  const rollback = path.join(f.directory, 'deactivation-plan.json');
  require('../registry-files').writePrivate(owner, { credential: 'CAPTAIN' });
  const args = ['--endpoint', 'http://127.0.0.1:' + f.port, '--board', 'beta', '--credential-file', owner];
  const before = JSON.parse(fs.readFileSync(path.join(f.directory, 'store.json')));
  await cli.run(['inspect', ...args, '--output', plan]);
  await assert.rejects(cli.run(['activate', ...args, '--input', plan]), /attestation/);
  const active = await cli.run(['activate', ...args, '--input', plan, '--confirm-all-writers']);
  assert.equal(active.enabled, true);
  assert.equal((await cli.run(['activate', ...args, '--input', plan, '--confirm-all-writers'])).duplicate, true);
  await cli.run(['verify', ...args, '--expect', 'active']);
  await cli.run(['inspect', ...args, '--output', rollback]);
  const off = await cli.run(['deactivate', ...args, '--input', rollback, '--confirm-quiesced']);
  assert.equal(off.enabled, false);
  assert.equal(off.epoch, 2);
  assert.equal((await cli.run(['deactivate', ...args, '--input', rollback, '--confirm-quiesced'])).duplicate, true);
  await cli.run(['verify', ...args, '--expect', 'inactive']);
  const after = JSON.parse(fs.readFileSync(path.join(f.directory, 'store.json')));
  for (const field of ['cards', 'comments', 'tickets']) assert.deepEqual(after[field], before[field], field);
  assert.deepEqual(after.boards.beta.shift, before.boards.beta.shift, 'no shift end or re-setup');
  assert.equal(after.schemaVersion, 5, 'never downgrade or restore an old store over accepted work');
  assert.equal(after.sessionOwnership.sessions['beta|session-first'].revoked, true);
  assert.equal((await f.request('GET', '/api/state', null, f.first, 1)).status, 401);
  const legacy = await f.request(
    'POST',
    '/api/boards/beta/calls',
    {
      calls: [
        {
          id: id(),
          tool: 'board_post',
          args: { card: 'beta-work', kind: 'status', text: 'Continue in compatibility mode' },
        },
      ],
    },
    'TOOLS',
  );
  assert.equal(legacy.body.results[0].ok, true, legacy.raw);
  const support = path.join(f.directory, 'older-release');
  fs.mkdirSync(support);
  fs.writeFileSync(
    path.join(support, 'release.json'),
    JSON.stringify({
      format: 1,
      storeSchema: { min: 1, max: 4, write: 1, writes: [1, 2, 3, 4] },
    }),
  );
  assert.throws(
    () => require('../release-check').compatible(support, path.join(f.directory, 'store.json')),
    /incompatible/,
  );
});

test('DeactivationRefusesPendingCallsWithoutDiscardingThem', async context => {
  const f = await fixture(context, true, { handoffEnabled: true });
  const call = { id: id(), tool: 'board_post', args: { card: 'beta-work', text: 'Local-only work' } };
  await f.request(
    'POST',
    '/api/boards/beta/dispatch-ledger',
    {
      action: 'inventory',
      operationId: id(),
      journalId: id(),
      complete: true,
      relays: [],
      calls: [{ ...call, hash: require('../dispatch-ledger').callHash(call) }],
    },
    f.first,
    1,
  );
  const view = await inspect(f);
  const result = await f.request(
    'POST',
    route,
    {
      action: 'deactivate',
      operationId: id(),
      expectedEpoch: 1,
      processIds: view.attachedProcessIds,
      confirmQuiesced: true,
    },
    'CAPTAIN',
  );
  assert.equal(result.status, 409);
  assert.equal((await inspect(f)).enabled, true);
  const ledger = (await f.request('GET', '/api/boards/beta/dispatch-ledger', null, f.first, 1)).body;
  assert.equal(ledger.calls.find(item => item.id === call.id).disposition, 'unacknowledged');
});
