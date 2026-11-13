'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const fixture = require('./ownership-http-fixture');
const id = () => crypto.randomUUID();
const route = '/api/boards/beta/activation';
const loss = 'calls-outbox.jsonl:missing-or-unreadable';
const view = async host => (await host.request('GET', route, null, 'CAPTAIN')).body;
const send = (host, body, actor = host.first) => host.request('POST', route, { operationId: id(), ...body }, actor, 1);

for (const approved of [false, true]) {
  for (const paged of [false, true]) {
    test('InterruptedMigrationLossRemainsUnresolved approved=' + approved + ' paged=' + paged, async context => {
      const host = await fixture(context, false);
      const journalId = (await view(host)).processes[0].journalId;
      const oldGaps = approved ? ['old-gap'] : [];
      const snapshot = { action: 'inventory', journalId, complete: !approved, gaps: oldGaps, calls: [], relays: [] };
      const approval = {
        action: 'resolve-gap',
        journalId,
        expectedEpoch: 1,
        independent: true,
        evidence: 'Independent fixture review of the recorded loss',
      };
      assert.equal((await send(host, snapshot)).status, 200);
      if (approved) assert.equal((await send(host, approval, 'CAPTAIN')).status, 200);
      assert.equal((await view(host)).ready, true);
      const interrupted = { id: id(), hash: 'b'.repeat(64), parts: 2, index: 0 };
      const missing = {
        ...snapshot,
        complete: false,
        gaps: [...oldGaps, loss],
        ...(paged ? { migration: interrupted } : {}),
      };
      assert.equal((await send(host, missing)).status, 200);
      assert.equal((await view(host)).ready, false);
      const restarted = { id: id(), hash: 'c'.repeat(64), parts: 2, index: 0 };
      const clean = { ...snapshot, ...(paged ? { migration: restarted } : {}) };
      assert.equal((await send(host, clean)).status, 200);
      if (paged) {
        assert.equal((await send(host, { ...clean, migration: { ...restarted, index: 1 } })).status, 200);
      }
      const store = JSON.parse(fs.readFileSync(path.join(host.directory, 'store.json')));
      const saved = store.dispatchLedger.boards.beta.inventories[journalId];
      assert.ok(saved.gaps.includes(loss), 'the interrupted snapshot recorded the loss');
      assert.equal(saved.complete, false, 'a recreated outbox cannot erase a recorded loss');
      assert.equal(saved.resolved, false, 'a prior approval cannot cover the interrupted snapshot loss');
      if (approved) assert.deepEqual(saved.resolution.gaps, oldGaps);
      assert.equal((await view(host)).ready, false);
      assert.equal((await send(host, approval, 'CAPTAIN')).status, 200);
      assert.equal((await view(host)).ready, true, 'a fresh owner decision accounts for the loss');
    });
  }
}
