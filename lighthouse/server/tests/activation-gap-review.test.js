'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const fixture = require('./ownership-http-fixture');
const storage = require('../../operator-kit/scripts/dispatch-storage.cjs');
const id = () => crypto.randomUUID();
const route = '/api/boards/beta/activation';
const ledger = '/api/boards/beta/dispatch-ledger';
const disk = host => JSON.parse(fs.readFileSync(path.join(host.directory, 'store.json')));
const view = async host => (await host.request('GET', route, null, 'CAPTAIN')).body;
const send = (host, body, actor = host.first, target = route) =>
  host.request('POST', target, { operationId: id(), ...body }, actor, 1);
const resolve = journalId => ({
  action: 'resolve-gap',
  journalId,
  expectedEpoch: 1,
  independent: true,
  evidence: 'Independent fixture records account for this exact gap',
});
const command = (state, action) => ({
  action,
  expectedEpoch: state.epoch,
  readiness: state.readiness,
  processIds: state.processIds,
  confirmAllWriters: true,
  confirmQuiesced: true,
});

for (const restart of [false, true]) {
  test('NewMigrationGapsRequireNewOwnerApproval after restart=' + restart, async context => {
    const host = await fixture(context, false);
    const journalId = (await view(host)).processes[0].journalId;
    const snapshot = { action: 'inventory', journalId, complete: false, gaps: ['old-gap'], calls: [], relays: [] };
    assert.equal((await send(host, snapshot)).status, 200);
    assert.equal((await send(host, resolve(journalId), 'CAPTAIN')).status, 200);
    let migration = { id: id(), hash: 'b'.repeat(64), parts: 2, index: 0 };
    const page = () => ({ ...snapshot, gaps: ['old-gap', 'new-gap'], migration });
    assert.equal((await send(host, page())).status, 200);
    if (restart) {
      migration = { ...migration, id: id() };
      assert.equal((await send(host, page())).status, 200);
    }
    migration = { ...migration, index: 1 };
    assert.equal((await send(host, page())).status, 200);
    const saved = disk(host).dispatchLedger.boards.beta.inventories[journalId];
    assert.equal(saved.complete, false);
    assert.equal(saved.resolved, false, 'old approval cannot cover a newly observed gap');
    assert.equal((await view(host)).ready, false);
    assert.equal((await send(host, resolve(journalId), 'CAPTAIN')).status, 200);
    assert.equal((await view(host)).ready, true);
    migration = { ...migration, id: id(), index: 0 };
    assert.equal((await send(host, page())).status, 200);
    migration = { ...migration, index: 1 };
    assert.equal((await send(host, page())).status, 200);
    assert.equal((await view(host)).ready, true, 'approval still covers only its exact known gap set');
  });
}

for (const active of [false, true]) {
  test('OwnerCanAbandonMissingPagesWithoutLosingImportedWork active=' + active, async context => {
    const host = await fixture(context, active);
    const journalId = id();
    const migration = { id: id(), hash: 'c'.repeat(64), parts: 2, index: 0 };
    const call = { id: id(), tool: 'board_post', args: { text: 'fixture imported obligation' } };
    call.hash = storage.callHash(call);
    call.disposition = 'rejected';
    const page = { action: 'inventory', journalId, complete: true, gaps: [], calls: [call], relays: [], migration };
    assert.equal((await send(host, page, active ? host.second : host.first, active ? ledger : route)).status, 200);
    const before = structuredClone(disk(host).dispatchLedger.boards.beta.calls[call.id]);
    const census = await view(host);
    assert.equal(census.ready, false, 'unattached journals must also block readiness');
    assert.equal(census.inventories.find(entry => entry.id === journalId).migration.id, migration.id);
    assert.equal((await send(host, command(census, active ? 'deactivate' : 'activate'), 'CAPTAIN')).status, 409);
    const approval = { ...resolve(journalId), abandonMigrationId: migration.id, operationId: id() };
    const target = active ? ledger : route;
    for (const changed of [{ expectedEpoch: 0 }, { abandonMigrationId: id() }, { independent: false }])
      assert.notEqual((await send(host, { ...approval, ...changed }, 'CAPTAIN', target)).status, 200);
    assert.equal((await send(host, approval, host.first, target)).status, 403);
    assert.equal((await send(host, approval, 'CAPTAIN', target)).status, 200);
    assert.equal((await send(host, approval, 'CAPTAIN', target)).body.duplicate, true);
    const saved = disk(host).dispatchLedger.boards.beta;
    assert.deepEqual(saved.calls[call.id], before, 'abandonment retains all imported obligations and dispositions');
    assert.equal(saved.inventories[journalId].complete, false);
    assert.equal(saved.inventories[journalId].resolved, true);
    assert.equal(saved.inventories[journalId].migration, undefined);
    assert.equal(saved.inventories[journalId].abandonedMigration.id, migration.id);
    assert.ok(saved.inventories[journalId].gaps.includes('migration-pages-missing:' + migration.id));
    assert.equal(saved.history.filter(entry => entry.action === 'migration-abandoned').length, 1);
    const final = { ...page, migration: { ...migration, index: 1 } };
    assert.equal((await send(host, final, active ? host.second : host.first, active ? ledger : route)).status, 409);
    assert.equal((await view(host)).ready, true);
    if (!active) assert.equal((await send(host, command(await view(host), 'activate'), 'CAPTAIN')).status, 200);
    assert.equal((await send(host, command(await view(host), 'deactivate'), 'CAPTAIN')).status, 200);
    assert.deepEqual(disk(host).dispatchLedger.boards.beta.calls[call.id], before);
  });
}
