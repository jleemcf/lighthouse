'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { httpFixture } = require('./registry-http-fixture.cjs');
const { grantFor } = require('./registry-fixture');
const { makeRegistryRoutes } = require('../registry-routes');

test('host administration never grants hidden-board reads or operator authorship', async context => {
  const ctx = await httpFixture(context);
  const state = await ctx.request('GET', '/api/state');
  assert.deepEqual(state.body.boards, {});
  const who = await ctx.request('GET', '/api/whoami');
  assert.deepEqual(who.body.roles, {});
  assert.equal((await ctx.request('POST', '/api/comments', { board: 'alpha', text: 'blocked' })).status, 403);
  assert.equal((await ctx.request('POST', '/api/registry/rename', { id: 'alpha', name: 'Managed' })).status, 200);
});

test('migrated startup reports configuration drift without secrets or adopting authority', async context => {
  const ctx = await httpFixture(context, cfg => {
    cfg.boards.alpha.access = { 'unadopted-principal': 'owner' };
    cfg.boards.alpha.integration = { token: 'unadopted-secret' };
    return cfg;
  });
  assert.match(ctx.logs(), /registry configuration differs/);
  assert.match(ctx.logs(), /members/);
  assert.match(ctx.logs(), /credentialSettings/);
  ctx.privateOutput(['unadopted-principal', 'unadopted-secret']);
  const state = await ctx.request('GET', '/api/state', undefined, 'fixtureLegacy');
  assert.deepEqual(Object.keys(state.body.boards), ['alpha']);
});

test('hidden boards and other owners devices stay private; a board owner cannot import globally', async context => {
  const ctx = await httpFixture(context);
  const state = await ctx.request('GET', '/api/state', undefined, 'fixtureLegacy');
  assert.deepEqual(Object.keys(state.body.boards), ['alpha']);
  const who = await ctx.request('GET', '/api/whoami', undefined, 'fixtureLegacy');
  assert.deepEqual(Object.keys(who.body.roles), ['alpha']);
  assert.equal((await ctx.request('POST', '/api/import', { cards: {} }, 'fixtureLegacy')).status, 403);
  assert.equal((await ctx.request('POST', '/api/registry/create', { board: {} }, 'fixtureLegacy')).status, 403);
  assert.equal(
    (await ctx.request('POST', '/api/registry/rename', { id: 'hidden', name: 'Wrong' }, 'fixtureLegacy')).status,
    403,
  );
  assert.equal((await ctx.request('POST', '/api/registry/bootstrap', {}, null)).status, 403);
  const subscribe = await ctx.request(
    'POST',
    '/api/push/subscribe',
    {
      device: 'Second device',
      subscription: { endpoint: 'https://push.example.test/second', keys: { auth: 'test', p256dh: 'test' } },
    },
    'fixtureSecond',
  );
  assert.equal(subscribe.status, 200);
  const devices = await ctx.request('GET', '/api/push', undefined, 'fixtureLegacy');
  assert.deepEqual(devices.body.devices, []);
  assert.deepEqual(devices.body.boards, ['alpha']);
  assert.equal(
    (await ctx.request('POST', '/api/push/unsubscribe', { id: subscribe.body.mine }, 'fixtureLegacy')).status,
    404,
  );
});

test('administrative forms require CSRF and same origin; archive keeps reads but refuses writes', async context => {
  const ctx = await httpFixture(context);
  const cookie = { Cookie: 'lhtoken=fixtureLegacy' };
  const input = { id: 'alpha', name: 'Renamed' };
  assert.equal((await ctx.request('POST', '/api/registry/rename', input, null, cookie)).status, 403);
  const csrf = await ctx.request('GET', '/api/registry/csrf', undefined, null, cookie);
  assert.equal(
    (
      await ctx.request('POST', '/api/registry/rename', input, null, {
        ...cookie,
        'X-Lighthouse-CSRF': csrf.body.csrf,
        Origin: ctx.endpoint,
      })
    ).status,
    200,
  );
  assert.equal(
    (await ctx.request('POST', '/api/registry/rename', input, undefined, { Origin: 'https://other.example.test' }))
      .status,
    403,
  );
  const preview = await ctx.request('POST', '/api/registry/preview', { id: 'alpha' });
  assert.equal(
    (await ctx.request('POST', '/api/registry/archive', { id: 'alpha', confirmation: preview.body.confirmation }))
      .status,
    200,
  );
  const state = await ctx.request('GET', '/api/state', undefined, 'fixtureLegacy');
  assert.equal(state.body.boards.alpha.lifecycle, 'archived');
  assert.equal(
    (await ctx.request('POST', '/api/comments', { board: 'alpha', text: 'blocked' }, 'fixtureLegacy')).status,
    403,
  );
});

test('HTTP enrollment replies after commit and retries only with the original proof', async context => {
  const ctx = await httpFixture(context);
  const input = grantFor(ctx);
  assert.equal((await ctx.request('POST', '/api/enrollment/consume?token=forbidden', input, null)).status, 400);
  assert.equal(
    (await ctx.request('POST', '/api/enrollment/consume', input, null, { Origin: ctx.endpoint })).status,
    403,
  );
  const first = await ctx.request('POST', '/api/enrollment/consume', input, null);
  assert.equal(first.status, 200);
  assert.ok(!JSON.stringify(first.body).includes(input.credential));
  const again = await ctx.request('POST', '/api/enrollment/consume', input, null);
  assert.equal(again.body.repeated, true);
  assert.equal(
    (await ctx.request('POST', '/api/enrollment/consume', { operationId: input.operationId }, null)).status,
    400,
  );
  const state = await ctx.request('GET', '/api/state', undefined, input.credential);
  assert.deepEqual(Object.keys(state.body.boards), ['alpha']);
  ctx.privateOutput([input.credential, input.grant, input.proof, ctx.adminFile.credential]);
});

test('registry rate limits requests and refuses off-loopback cleartext', async context => {
  const ctx = await httpFixture(context);
  for (let count = 0; count < 120; count++) assert.equal((await ctx.request('GET', '/api/registry/csrf')).status, 200);
  assert.equal((await ctx.request('GET', '/api/registry/csrf')).status, 429);
  let response;
  const routes = makeRegistryRoutes({
    NEXT: Symbol(),
    send: (res, status, body) => {
      response = { status, body };
    },
  });
  await routes.registryRoutes(
    {
      method: 'POST',
      url: '/api/enrollment/consume',
      headers: { host: 'example.test' },
      socket: { remoteAddress: '192.0.2.1' },
    },
    {},
    { p: '/api/enrollment/consume' },
  );
  assert.equal(response.status, 403);
  assert.match(response.body.error, /TLS off loopback/);
});
