'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fixture = require('./ownership-http-fixture');

test('recovery HTTP requires captain, reviewed blockers and CSRF; racing accepts commit one epoch', async context => {
  const f = await fixture(context, true, { dispatchLedgerEnabled: true, handoffEnabled: true, recoveryEnabled: true });
  const route = '/api/boards/beta/handoff';
  const ledger = (action, body = {}, credential = f.first) =>
    f.request(
      'POST',
      '/api/boards/beta/dispatch-ledger',
      { operationId: crypto.randomUUID(), action, ...body },
      credential,
      1,
    );
  const journalId = crypto.randomUUID();
  assert.equal((await ledger('inventory', { journalId, complete: true, calls: [], relays: [] })).status, 200);
  assert.equal(
    (
      await f.control(
        {
          action: 'attach',
          processId: f.processId,
          protocol: 'session-epochs-v1',
          capabilities: ['dispatch-ledger-v1'],
          journalId,
        },
        f.first,
        1,
      )
    ).status,
    200,
  );
  assert.equal(
    (await ledger('activate', { confirmAllWriters: true, processIds: [f.processId] }, 'CAPTAIN')).status,
    409,
  );
  const status = (await f.request('GET', route, null, f.first, 1)).body;
  const transferId = crypto.randomUUID();
  const body = (action, extra = {}) => ({ action, transferId, operationId: crypto.randomUUID(), ...extra });
  const approval = body('recover', {
    board: 'beta',
    expectedEpoch: 1,
    successorSessionId: 'session-second',
    reason: 'Partitioned holder; explicitly revoke authority at acceptance',
    revoke: true,
    oldDiskAvailable: false,
    pendingDigest: status.pending.digest,
  });
  assert.equal((await f.request('POST', route, approval, f.second, 1)).status, 403);
  const origin = 'http://127.0.0.1:' + f.port;
  const page = (value, headers = {}, credential = 'CAPTAIN') =>
    f.request('POST', '/api/registry/handoff', value, credential, undefined, headers);
  assert.equal((await page(approval, { Origin: origin })).status, 403);
  const csrf = (await f.request('GET', '/api/registry/csrf', null, 'CAPTAIN')).body.csrf;
  const headers = { Origin: origin, 'X-Lighthouse-CSRF': csrf };
  assert.equal((await page(approval, headers, 'PAGE')).status, 403);
  assert.equal((await page(approval, headers)).status, 200);
  assert.equal((await page(approval, headers)).body.duplicate, true);
  const read = await f.request('POST', route, body('read'), f.second, 1);
  assert.equal(read.status, 200, read.raw);
  assert.ok(read.body.recovery.warnings.some(warning => warning.includes('Old disk unavailable')));
  assert.ok(read.body.dispatch.inventories.some(inventory => !inventory.complete));
  const accept = body('accept', { expectedEpoch: 1, readId: read.body.readId });
  const attempts = [accept, { ...accept, operationId: crypto.randomUUID() }];
  const answers = await Promise.all(attempts.map(value => f.request('POST', route, value, f.second, 1)));
  assert.deepEqual(answers.map(answer => answer.status).sort(), [200, 409]);
  const old = await f.request(
    'POST',
    '/api/boards/beta/calls',
    {
      calls: [
        {
          id: crypto.randomUUID(),
          tool: 'board_post',
          args: { card: 'beta-work', text: 'stale queued mutation' },
          queued: true,
          originSessionId: 'session-first',
          originEpoch: 1,
        },
      ],
    },
    f.first,
    1,
  );
  assert.equal(old.status, 409);
  const pickup = await f.request('POST', route, body('read'), f.second, 2);
  assert.equal(
    (
      await f.request(
        'POST',
        route,
        body('pickup', { readId: pickup.body.readId, revision: pickup.body.revision }),
        f.second,
        2,
      )
    ).status,
    200,
  );
  assert.equal((await f.request('GET', route, null, f.second, 2)).body.ownership.epoch, 2);
});
