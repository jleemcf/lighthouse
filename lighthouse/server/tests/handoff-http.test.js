'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fixture = require('./ownership-http-fixture');
const { input } = require('./handoff-fixture');

test('handoff reads refuse collector and steward credentials before exposing context', async context => {
  const f = await fixture(context, true, { handoffEnabled: true });
  for (const credential of [f.collector, 'COLLECTOR', 'STEWARD'])
    assert.equal((await f.request('GET', '/api/boards/beta/handoff', null, credential, 1)).status, 403);
});

test('handoff HTTP owner controls, CSRF, private successor and racing acceptors', async context => {
  const f = await fixture(context, true, { handoffEnabled: true });
  const route = '/api/boards/beta/handoff';
  const transferId = crypto.randomUUID();
  const body = (action, extra = {}) => ({ operationId: crypto.randomUUID(), transferId, action, ...extra });
  const prepare = body('prepare', { expectedEpoch: 1, successorSessionId: 'session-second', board: 'beta' });
  const page = (value, token = 'CAPTAIN', headers = {}) =>
    f.request('POST', '/api/registry/handoff', value, token, undefined, headers);
  const origin = 'http://127.0.0.1:' + f.port;
  assert.equal((await page(prepare, 'CAPTAIN', { Origin: origin })).status, 403);
  const csrf = (await f.request('GET', '/api/registry/csrf', null, 'CAPTAIN')).body.csrf;
  assert.equal((await page(prepare, 'PAGE')).status, 403);
  assert.equal(
    (await page(prepare, 'CAPTAIN', { Origin: 'https://untrusted.example', 'X-Lighthouse-CSRF': csrf })).status,
    403,
  );
  const started = await page(prepare, 'CAPTAIN', { Origin: origin, 'X-Lighthouse-CSRF': csrf });
  assert.equal(started.status, 200, started.raw);
  assert.equal((await page(prepare)).body.duplicate, true);
  const checkpoint = input();
  checkpoint.targetBinding.id = 'firstmate';
  assert.equal((await f.request('POST', route, body('checkpoint', { checkpoint }), f.first, 1)).status, 200);
  assert.equal((await f.request('POST', route, body('seal'), f.first, 1)).status, 200);
  const readBody = body('read');
  assert.equal((await page({ ...readBody, board: 'beta' })).status, 403);
  const read = await page({ ...readBody, board: 'beta', sessionCredential: f.second });
  assert.equal(read.status, 200, read.raw);
  const accept = body('accept', { expectedEpoch: 1, readId: read.body.readId });
  const attempts = [accept, { ...accept, operationId: crypto.randomUUID() }];
  const results = await Promise.all(attempts.map(value => f.request('POST', route, value, f.second, 1)));
  assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
  const won = attempts[results.findIndex(result => result.status === 200)];
  assert.equal((await f.request('POST', route, won, f.second, 2)).body.duplicate, true);
  const pickup = await f.request('POST', route, body('read'), f.second, 2);
  assert.equal(pickup.status, 200, pickup.raw);
  assert.equal(
    (
      await f.request(
        'POST',
        '/api/boards/beta/calls',
        {
          calls: [{ id: 'new-work', tool: 'board_card', args: {} }],
        },
        f.second,
        2,
      )
    ).status,
    409,
  );
  assert.equal(
    (
      await f.request(
        'POST',
        route,
        body('pickup', {
          readId: pickup.body.readId,
          revision: pickup.body.revision,
        }),
        f.second,
        2,
      )
    ).status,
    200,
  );
  assert.equal((await f.request('GET', route, null, f.second, 2)).body.ownership.epoch, 2);
});

test('handoff HTTP inactive board preserves legacy tools and hides UI controls', async context => {
  const f = await fixture(context, false);
  assert.deepEqual((await f.request('GET', '/api/boards/beta/handoff', null, f.first, 1)).body, { enabled: false });
  assert.equal(
    (
      await f.request(
        'POST',
        '/api/boards/beta/handoff',
        {
          action: 'prepare',
          operationId: crypto.randomUUID(),
        },
        f.first,
        1,
      )
    ).status,
    409,
  );
  const state = await f.request('GET', '/api/state', null, 'OWNER');
  assert.equal(state.body.boards.beta.handoff, undefined);
  const nominate = await f.control({
    action: 'nominate',
    sessionId: 'session-second',
    expectedEpoch: 1,
    nominationId: crypto.randomUUID(),
    expiresAt: Date.now() + 60000,
  });
  assert.equal(nominate.status, 200, nominate.raw);
});
