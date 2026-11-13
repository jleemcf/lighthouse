'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { httpFixture } = require('./registry-http-fixture.cjs');
const { grantFor } = require('./registry-fixture');

async function noticeFixture(context) {
  const ctx = await httpFixture(context, cfg => {
    cfg.tokens.fixtureWatch = { name: 'watcher', via: 'api' };
    return cfg;
  });
  ctx.registry.transact(state => {
    state.metadata.boards.alpha.protocol = 'lines';
    state.metadata.boards.alpha.members.watcher = 'operator';
    state.metadata.boards.hidden.members.watcher = 'watch';
  });
  return ctx;
}

async function enroll(ctx, role) {
  const input = grantFor(ctx, { scope: { principal: 'watcher', role, protocol: 'lines' } });
  assert.equal((await ctx.request('POST', '/api/enrollment/consume', input, null)).status, 200);
  return input.credential;
}

function notice(ctx, route, source, target, credential = 'fixtureWatch', extra = {}) {
  const id = crypto.randomUUID();
  const text = 'Synthetic notice ' + id;
  const body =
    route === 'calls'
      ? { calls: [{ id, tool: 'board_notice', args: { board: target, text }, ...extra }] }
      : { rows: [{ label: 'NOTICE', task: target + '/general', text }] };
  return ctx.request('POST', '/api/boards/' + source + '/' + route, body, credential);
}

function refused(response) {
  if (response.status === 403) return;
  assert.equal(response.status, 200);
  assert.equal(response.body.results[0].ok, false);
}

async function messages(ctx, board) {
  const credential = board === 'alpha' ? 'fixtureLegacy' : 'fixtureSecond';
  const response = await ctx.request('GET', '/api/comments?board=' + board + '&general=true', undefined, credential);
  assert.equal(response.status, 200);
  return response.body.comments;
}

async function archive(ctx, board) {
  const preview = await ctx.request('POST', '/api/registry/preview', { id: board });
  assert.equal(preview.status, 200);
  const result = await ctx.request('POST', '/api/registry/archive', {
    id: board,
    confirmation: preview.body.confirmation,
  });
  assert.equal(result.status, 200);
}

test('installation notices stay on the granted board through tools and legacy lines', async context => {
  const ctx = await noticeFixture(context);
  for (const role of ['operator', 'watch']) {
    const credential = await enroll(ctx, role);
    for (const route of ['calls', 'events']) refused(await notice(ctx, route, 'alpha', 'hidden', credential));
  }
  assert.deepEqual(await messages(ctx, 'hidden'), []);
  assert.deepEqual(await messages(ctx, 'alpha'), []);
});

test('installation notices require an explicit watch grant despite principal membership', async context => {
  const ctx = await noticeFixture(context);
  ctx.registry.transact(state => {
    state.metadata.boards.alpha.members.watcher = 'watch';
  });
  for (const role of ['viewer', 'commenter', 'operator']) {
    const credential = await enroll(ctx, role);
    refused(await notice(ctx, 'calls', 'alpha', 'alpha', credential));
  }
  assert.deepEqual(await messages(ctx, 'alpha'), []);
  const watch = await enroll(ctx, 'watch');
  const result = await notice(ctx, 'calls', 'alpha', 'alpha', watch);
  assert.equal(result.status, 200);
  assert.equal(result.body.results[0].ok, true);
  assert.equal((await messages(ctx, 'alpha')).filter(message => message.kind === 'notice').length, 1);
});

test('archived notice sources refuse calls before receipts, queued failures or shift writes', async context => {
  const ctx = await noticeFixture(context);
  ctx.registry.transact(state => {
    state.metadata.boards.alpha.members.watcher = 'watch';
  });
  await archive(ctx, 'alpha');
  const before = await ctx.request('GET', '/api/state', undefined, 'fixtureLegacy');
  for (const target of ['alpha', 'hidden']) {
    const response = await notice(ctx, 'calls', 'alpha', target, 'fixtureWatch', { queued: true });
    assert.equal(response.status, 403);
  }
  refused(await notice(ctx, 'events', 'alpha', 'hidden'));
  const after = await ctx.request('GET', '/api/state', undefined, 'fixtureLegacy');
  assert.deepEqual(after.body.boards.alpha, before.body.boards.alpha);
  assert.deepEqual(await messages(ctx, 'alpha'), []);
  assert.deepEqual(await messages(ctx, 'hidden'), []);
  assert.equal((await ctx.request('GET', '/api/boards/alpha/status', undefined, 'fixtureLegacy')).status, 200);
});

test('archived notice targets refuse tools and legacy lines from active sources', async context => {
  const ctx = await noticeFixture(context);
  await archive(ctx, 'hidden');
  for (const route of ['calls', 'events']) refused(await notice(ctx, route, 'alpha', 'hidden'));
  assert.deepEqual(await messages(ctx, 'hidden'), []);
  assert.deepEqual(await messages(ctx, 'alpha'), []);
});

test('active legacy watchers retain cross-board tool and line notices', async context => {
  const ctx = await noticeFixture(context);
  for (const route of ['calls', 'events']) {
    const result = await notice(ctx, route, 'alpha', 'hidden');
    assert.equal(result.status, 200);
    assert.equal(result.body.results[0].ok, true);
  }
  assert.equal((await messages(ctx, 'hidden')).filter(message => message.kind === 'notice').length, 2);
  assert.equal((await messages(ctx, 'alpha')).filter(message => message.kind === 'notice-sent').length, 2);
});

test('archived boards settle preserved relay evidence and replay receipts without shift writes', async context => {
  const ctx = await httpFixture(context, (cfg, seeded) => {
    cfg.tokens.fixtureRelay = { name: 'captain', via: 'api' };
    for (const id of ['delivered', 'refused', 'foreign', 'other'])
      seeded.store.tickets[id] = {
        id,
        board: id === 'foreign' ? 'hidden' : 'alpha',
        by: id === 'other' ? 'reader' : 'captain',
        t: new Date().toISOString(),
        to: 'operator',
        text: 'Synthetic pending delivery',
        hash: 'a'.repeat(64),
        used: false,
      };
    return cfg;
  });
  const preview = await ctx.request('POST', '/api/registry/preview', { id: 'alpha' });
  assert.equal(preview.status, 200);
  const archived = await ctx.request('POST', '/api/registry/archive', {
    id: 'alpha',
    confirmation: preview.body.confirmation,
    disposition: { action: 'preserve', reason: 'Retain existing delivery evidence' },
  });
  assert.equal(archived.status, 200);
  const before = await ctx.request('GET', '/api/state', undefined, 'fixtureLegacy');
  const post = call => ctx.request('POST', '/api/boards/alpha/calls', { calls: [call] }, 'fixtureRelay');
  for (const ticket of ['missing', 'foreign', 'other'])
    assert.equal((await post({ tool: '_relay_result', args: { ticket, delivered: true } })).status, 403);
  const delivery = {
    id: 'relay-result-delivered',
    tool: '_relay_result',
    args: { ticket: 'delivered', delivered: true },
  };
  assert.equal((await post({ ...delivery, queued: true })).status, 403);
  assert.equal((await post({ ...delivery, args: { ...delivery.args, dry_run: true } })).status, 403);
  assert.equal((await post({ tool: 'board_batch', args: { calls: [delivery] } })).status, 403);
  assert.equal((await post({ tool: 'board_notice', args: { board: 'hidden', text: 'Synthetic notice' } })).status, 403);
  for (const ticket of ['delivered', 'refused']) {
    const call = {
      id: 'relay-result-' + ticket,
      tool: '_relay_result',
      args: { ticket, delivered: ticket === 'delivered' },
    };
    const result = await post(call);
    assert.equal(result.status, 200);
    assert.equal(result.body.results[0].ok, true);
    const receipt = { id: call.id, ticket, delivered: call.args.delivered };
    assert.deepEqual(result.body.results[0].relay_receipt, receipt);
    const replay = await post(call);
    assert.equal(replay.status, 200);
    assert.equal(replay.body.results[0].duplicate, true);
    assert.deepEqual(replay.body.results[0].relay_receipt, receipt);
  }
  const after = await ctx.request('GET', '/api/state', undefined, 'fixtureLegacy');
  assert.deepEqual(after.body.boards.alpha, before.body.boards.alpha);
  assert.equal((await messages(ctx, 'alpha')).filter(message => message.label === 'RELAYED').length, 1);
  assert.deepEqual(await messages(ctx, 'hidden'), []);
});
