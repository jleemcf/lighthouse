'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const ownershipHttp = require('./ownership-http-fixture');

const ingress = [
  ['POST', '/api/boards/beta/calls', { calls: [{ tool: 'board_status', args: {} }] }],
  ['POST', '/api/boards/beta/calls', { calls: [{ tool: 'board_relay', args: {} }] }],
  ['POST', '/api/boards/beta/calls', { calls: [{ tool: '_relay_result', args: {} }] }],
  ['POST', '/api/boards/beta/calls', { calls: [{ tool: 'board_batch', args: {} }] }],
  ['POST', '/api/boards/beta/calls', { calls: [{ tool: 'board_post', queued: true, args: {} }] }],
  ['POST', '/api/boards/beta/status', {}],
  ['POST', '/api/boards/beta/authorities', { ownerWords: 'Do it' }],
  ['POST', '/api/boards/beta/events', { rows: [] }],
  ['POST', '/api/boards/beta/chat', { rows: [] }],
  ['POST', '/api/boards/beta/shift', { state: 'off' }],
  ['POST', '/api/boards/beta/heartbeat', { session: 'session-first', processId: 'process-first' }],
  ['POST', '/api/boards/beta/activity', { text: 'Act' }],
  ['POST', '/api/boards/beta/transcript', { rows: [] }],
  ['POST', '/api/boards/beta/instruments', {}],
  ['POST', '/api/boards/beta/archive', {}],
  ['POST', '/api/comments', { board: 'beta', text: 'Act' }],
  ['POST', '/api/bundles', { board: 'beta', parts: [{ text: 'Act' }] }],
  ['POST', '/api/global', { text: 'Act' }],
  ['POST', '/api/attachments', {}],
  ['PUT', '/api/cards/beta-work', { title: 'Act' }],
  ['PATCH', '/api/cards/beta-work', { title: 'Act', board: 'alpha' }],
  ['DELETE', '/api/cards/beta-work', {}],
  ['POST', '/api/cards/beta-work/resolve', { resolution: 'Act' }],
  ['PATCH', '/api/comments/message-test', { handled: true }],
  ['POST', '/api/comments/message-test/decide', { decision: 'Act' }],
  ['POST', '/api/import', { cards: [] }],
  ['POST', '/api/boards/beta/steward', { kind: 'state' }],
  ['POST', '/api/advice/0123456789abcdef/put', {}],
  ...['result', 'heartbeat', 'review', 'diagram'].map(route => ['POST', '/api/steward/' + route, {}]),
];

test('ownership ingress: every write denies missing, stale, relieved, wrong-scope and legacy actors', async context => {
  const board = await ownershipHttp(context);
  await board.acquire('session-second', board.second, 1);
  for (const [name, credential, epoch] of [
    ['missing', null, 2],
    ['stale', board.second, 1],
    ['relieved', board.first, 2],
    ['wrong-scope', 'WATCH', 2],
    ['legacy', 'LEGACY', 2],
    ['collector', board.collector, 2],
  ])
    for (const [method, route, body] of ingress) {
      const headers =
        route !== '/api/attachments'
          ? [{}]
          : ['stale', 'relieved', 'collector'].includes(name)
            ? [{}, { 'X-Lighthouse-Board': 'alpha' }]
            : [{ 'X-Lighthouse-Board': 'beta' }];
      for (const extraHeaders of headers) {
        const before = (await board.request('GET', '/api/state', null, 'OWNER')).body;
        const result = await board.request(method, route, body, credential, epoch, extraHeaders);
        const label = name + ' ' + method + ' ' + route + ' ' + JSON.stringify(extraHeaders);
        assert.ok([401, 403, 409].includes(result.status), label + ': ' + result.raw);
        assert.deepEqual((await board.request('GET', '/api/state', null, 'OWNER')).body, before, label);
      }
    }
});

test('ownership ingress: valid scopes work; legacy broad tools token and collector cannot act', async context => {
  const board = await ownershipHttp(context);
  for (const headers of [
    { 'Content-Type': 'text/plain' },
    { 'Content-Type': 'text/plain', 'X-Lighthouse-Board': 'alpha' },
  ]) {
    const upload = await board.request('POST', '/api/attachments', 'Holder evidence', board.first, 1, headers);
    assert.equal(upload.status, 201, upload.raw);
  }
  const call = { calls: [{ id: 'current-status', tool: 'board_status', args: {} }] };
  assert.equal((await board.request('POST', '/api/boards/beta/calls', call, board.first, 1)).status, 200);
  for (const credential of ['TOOLS', 'LEGACY', 'COLLECTOR', board.collector])
    assert.equal((await board.request('POST', '/api/boards/beta/calls', call, credential, 1)).status, 403);
  for (const route of ['chat', 'events', 'transcript', 'instruments']) {
    const result = await board.request('POST', '/api/boards/beta/' + route, { rows: [] }, board.collector, 1);
    assert.equal(result.status, 200, route + ': ' + result.raw);
  }
  const heartbeat = { session: 'session-first', processId: board.processId };
  assert.equal((await board.request('POST', '/api/boards/beta/heartbeat', heartbeat, board.first, 1)).status, 200);
  assert.equal((await board.request('POST', '/api/comments', { board: 'beta', text: 'Captain' }, 'OWNER')).status, 201);
  const notice = { calls: [{ tool: 'board_notice', args: { board: 'beta', text: 'Watch notice' } }] };
  assert.equal((await board.request('POST', '/api/boards/alpha/calls', notice, 'WATCH')).status, 200);
});

test('ownership ingress: body arriving before transfer cannot commit after it', async context => {
  const board = await ownershipHttp(context);
  const body = JSON.stringify({ calls: [{ tool: 'board_status', args: {} }] });
  let request;
  const response = new Promise((resolve, reject) => {
    request = http.request(
      {
        host: '127.0.0.1',
        port: board.port,
        method: 'POST',
        path: '/api/boards/beta/calls',
        headers: {
          Authorization: 'Bearer ' + board.first,
          'X-Lighthouse-Epoch': '1',
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      result => {
        result.resume();
        result.on('end', () => resolve(result.statusCode));
      },
    );
    request.on('error', reject);
    request.write(body.slice(0, -1));
  });
  await board.acquire('session-second', board.second, 1);
  request.end(body.slice(-1));
  assert.equal(await response, 409);
});

test('ownership ingress: two HTTP acceptors race; one wins and lost acknowledgement retries', async context => {
  const board = await ownershipHttp(context, false);
  const nominationId = crypto.randomUUID();
  await board.control({
    action: 'nominate',
    sessionId: 'session-second',
    expectedEpoch: 1,
    nominationId,
    expiresAt: Date.now() + 60000,
  });
  const operations = [crypto.randomUUID(), crypto.randomUUID()].map(operationId => ({
    action: 'acquire',
    expectedEpoch: 1,
    nominationId,
    operationId,
  }));
  const results = await Promise.all(operations.map(body => board.control(body, board.second, 1)));
  assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
  const retry = await board.control(operations[results.findIndex(result => result.status === 200)], board.second, 1);
  assert.equal(retry.status, 200);
  assert.equal(retry.body.duplicate, true);
  assert.equal(retry.body.ownership.epoch, 2);
});

test('ownership ingress: enforcement-off preserves legacy tools, collectors and line boards', async context => {
  const board = await ownershipHttp(context, false);
  assert.equal(
    (await board.request('GET', '/api/whoami', null, 'TOOLS')).body.capabilities.sessionOwnership,
    'session-epochs-v1',
  );
  for (const credential of ['TOOLS', 'LEGACY']) {
    const result = await board.request(
      'POST',
      '/api/boards/beta/calls',
      {
        calls: [{ id: crypto.randomUUID(), tool: 'board_status', args: {} }],
      },
      credential,
    );
    assert.equal(result.status, 200, result.raw);
  }
  for (const route of ['chat', 'events', 'transcript', 'instruments'])
    assert.equal(
      (await board.request('POST', '/api/boards/beta/' + route, { rows: [] }, 'COLLECTOR')).status,
      200,
      route,
    );
  assert.equal((await board.request('POST', '/api/boards/alpha/activity', { text: 'Legacy' }, 'LEGACY')).status, 200);
});

test('ownership ingress: expired lease fails the common commit guard for every route', context => {
  const { ownershipFixture } = require('./ownership-fixture');
  const { ctx, register, acquire, activate } = ownershipFixture(context);
  const holder = register('session-first');
  acquire(holder);
  activate(holder);
  ctx.ownership.record('tools').leaseUntil = Date.now() - 1;
  for (const [, route, payload] of ingress) {
    const p = route.replace('/beta/', '/tools/');
    assert.throws(() => ctx.mutations.authorize({ p, payload, who: holder }, {}, ['tools']), /expired|ticket-bound/, p);
  }
});

test('ownership ingress: queue drain cannot adopt another session or epoch implicitly', async context => {
  const board = await ownershipHttp(context);
  for (const [originSessionId, originEpoch] of [
    ['session-second', 1],
    ['session-first', 0],
  ]) {
    const result = await board.request(
      'POST',
      '/api/boards/beta/calls',
      {
        calls: [
          {
            id: crypto.randomUUID(),
            tool: 'board_post',
            args: { text: 'Not adopted' },
            queued: true,
            originSessionId,
            originEpoch,
          },
        ],
      },
      board.first,
      1,
    );
    assert.equal(result.status, 409, result.raw);
  }
});

test('ownership ingress: a relieved holder settles only its authorized ticket evidence', async context => {
  const board = await ownershipHttp(context);
  const call = (tool, args, credential = board.first, epoch = 1) =>
    board.request(
      'POST',
      '/api/boards/beta/calls',
      {
        calls: [{ id: crypto.randomUUID(), tool, args }],
      },
      credential,
      epoch,
    );
  const prompt = await call('board_prompt', {
    card: 'work',
    to: 'firstmate',
    purpose: 'Fixture handoff',
    prompt: 'Do fixture work',
  });
  assert.equal(prompt.body.results[0].ok, true, prompt.raw);
  const comments = (await board.request('GET', '/api/comments?board=beta', null, 'OWNER')).body.comments;
  const source = comments.find(comment => comment.prompt);
  assert.equal(
    (await board.request('POST', '/api/comments/' + source.id + '/decide', { choice: 'send' }, 'OWNER')).status,
    200,
  );
  const authorized = await call('board_relay', {
    source: source.sid,
    to: 'firstmate',
    dispatchProtocol: 'dispatch-ledger-v1',
  });
  const ticket = authorized.body.ticket;
  assert.ok(ticket?.evidenceCapability, authorized.raw);
  assert.equal(
    (
      await board.request(
        'POST',
        '/api/boards/beta/dispatch-ledger',
        {
          action: 'consume',
          operationId: crypto.randomUUID(),
          intentId: ticket.intentId,
          attemptId: ticket.attemptId,
          permissionId: ticket.permissionId,
        },
        board.first,
        1,
      )
    ).body.dispatch,
    true,
  );
  await board.acquire('session-second', board.second, 1);
  const ownershipBefore = (await board.request('GET', '/api/boards/beta/ownership', null, 'OWNER')).body;
  const evidence = {
    ticket: ticket.id,
    delivered: true,
    detail: 'Synthetic evidence',
    evidenceCapability: ticket.evidenceCapability,
  };
  assert.equal((await call('_relay_result', evidence, board.second, 1)).status, 403);
  assert.equal((await call('_relay_result', { ...evidence, evidenceCapability: 'wrong' })).status, 403);
  const settled = await call('_relay_result', evidence);
  assert.equal(settled.status, 200, settled.raw);
  assert.equal(settled.body.results[0].ok, true, settled.raw);
  assert.equal((await call('board_post', { text: 'Forbidden after relief' })).status, 409);
  assert.deepEqual((await board.request('GET', '/api/boards/beta/ownership', null, 'OWNER')).body, ownershipBefore);
});
