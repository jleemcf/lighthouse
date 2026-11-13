'use strict';
const { testPort, spawnServer } = require('../../tests/sandbox.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const makeDoorbells = require('../doorbells');
const { req, wait } = require('./helpers');

async function until(check) {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (check()) return;
    await wait(10);
  }
  assert.ok(check(), 'expected local delivery within two seconds');
}

async function receiver(t, status = 204) {
  const calls = [];
  const server = http.createServer((request, response) => {
    let body = '';
    request.on('data', data => (body += data));
    request.on('end', () => {
      const call = { body: JSON.parse(body), method: request.method, path: request.url, closed: false };
      calls.push(call);
      response.on('close', () => (call.closed = true));
      if (status) response.writeHead(status, { Location: '/not-followed' }).end();
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  return { server, calls, url: `http://127.0.0.1:${server.address().port}/private-receiver-token` };
}

function doorbell(t, url, timing = { intervalMs: 100, timeoutMs: 500 }) {
  const ctx = {
    cfg: { cardDoorbells: [{ slug: 'team-mailbox', url }] },
    store: { cardRevisions: {} },
    slugOf: (board, id) => id.slice(board.length + 1),
    change: () => {},
    saveNow: () => {},
  };
  const bells = makeDoorbells(ctx, timing);
  t.after(bells.closeDoorbells);
  return {
    ringCard(card) {
      const revision = (ctx.store.cardRevisions[card.id] || 0) + 1;
      ctx.store.cardRevisions[card.id] = revision;
      bells.ringCard(card, revision);
    },
  };
}

test('doorbells coalesce bursts per card, with a trailing ring for the final line', async t => {
  const target = await receiver(t);
  const { ringCard } = doorbell(t, target.url);
  const card = { id: 'a-team-mailbox', board: 'a', text: 'private text', author: 'private author' };
  ringCard(card);
  ringCard({ id: 'a-team-mailbox-followup', board: 'a' });
  ringCard({ id: 'b-team-mailbox', board: 'b' });
  await until(() => target.calls.length === 2);
  for (let count = 0; count < 5; count++) ringCard(card);
  await until(() => target.calls.length === 3);
  ringCard(card);
  await until(() => target.calls.length === 4);
  await wait(150);
  assert.equal(target.calls.length, 4, 'no extra rings after the final trailing delivery');
  assert.equal(target.calls.filter(call => call.body.board === 'a').length, 3);
  assert.equal(target.calls.filter(call => call.body.board === 'b').length, 1);
  for (const call of target.calls) {
    assert.equal(call.method, 'POST');
    assert.deepEqual(Object.keys(call.body).sort(), ['board', 'card', 'revision']);
    assert.ok(Number.isSafeInteger(call.body.revision));
    assert.equal(call.body.card, call.body.board + '-team-mailbox');
  }
});

test('doorbells are disabled by default', async t => {
  const target = await receiver(t);
  const { ringCard } = makeDoorbells({ cfg: {}, store: {}, slugOf: () => 'team-mailbox' });
  ringCard({ id: 'a-team-mailbox', board: 'a' });
  await wait(50);
  assert.equal(target.calls.length, 0);
});

test('only committed card objects ring, not copies used for tool rehearsals', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lhringstore-'));
  const rings = [];
  const ctx = { cfg: {}, CONFIG_PATH: path.join(dir, 'config.json'), ringCard: card => rings.push(card.id) };
  Object.assign(ctx, require('../store')(ctx));
  const card = { id: 'a-team-mailbox', board: 'a', log: [] };
  ctx.store.cards[card.id] = card;
  ctx.pushLog(structuredClone(card), { kind: 'FYI', text: 'rehearsal' });
  assert.deepEqual(rings, []);
  ctx.pushLog(card, { kind: 'FYI', text: 'committed' });
  assert.deepEqual(rings, [card.id]);
});

test('doorbell receiver failures and timeouts do not throw or expose the URL', async t => {
  const logs = [];
  t.mock.method(console, 'log', (...args) => logs.push(args.join(' ')));
  const down = await receiver(t);
  await new Promise(resolve => down.server.close(resolve));
  const card = { id: 'a-team-mailbox', board: 'a' };
  assert.doesNotThrow(() => doorbell(t, down.url).ringCard(card));
  await until(() => logs.length === 1);
  const slow = await receiver(t, 0);
  assert.doesNotThrow(() => doorbell(t, slow.url, { intervalMs: 100, timeoutMs: 50 }).ringCard(card));
  await until(() => logs.length === 2 && slow.calls[0]?.closed);
  const rejected = await receiver(t, 503);
  doorbell(t, rejected.url).ringCard(card);
  await until(() => logs.length === 3);
  const redirect = await receiver(t, 302);
  doorbell(t, redirect.url).ringCard(card);
  await until(() => logs.length === 4);
  await wait(150);
  assert.ok(
    redirect.calls.every(call => call.path === '/private-receiver-token'),
    'redirects are not followed',
  );
  assert.deepEqual(logs, Array(4).fill('card doorbell: delivery failed'));
  for (const target of [down, slow, rejected, redirect])
    assert.ok(logs.every(line => !line.includes(target.url) && !line.includes('private-receiver-token')));
});

test('invalid doorbell destinations are ignored without leaking configuration', t => {
  const logs = [];
  t.mock.method(console, 'log', text => logs.push(text));
  const { ringCard } = doorbell(t, 'http://127.0.0.1:bad/private-receiver-token');
  assert.doesNotThrow(() => ringCard({ id: 'a-team-mailbox', board: 'a' }));
  assert.deepEqual(logs, ['card doorbell: invalid configuration']);
});

test('card writes succeed while a receiver is slow; configuration stays private', async t => {
  const target = await receiver(t, 0);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lhdoorbells-'));
  const port = await testPort();
  const slugs = ['team-mailbox', 'replybox', 'bundlebox'];
  const cfg = {
    port,
    bind: '127.0.0.1',
    storeFile: 'store.json',
    cardDoorbells: slugs.map(slug => ({ slug, url: target.url })),
    tokens: { OWNER: { name: 'reader', via: 'page' }, OPS: { name: 'writer', via: 'api' } },
    boards: { t: { access: { reader: 'owner', writer: 'operator' } } },
  };
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(cfg));
  fs.writeFileSync(path.join(dir, 'store.json'), JSON.stringify({ cards: {}, comments: {} }));
  const env = { ...process.env };
  delete env.TYPESAFE_API_KEY;
  const child = spawnServer(path.join(dir, 'config.json'), {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => child.kill());
  let output = '';
  child.stdout.on('data', data => (output += data));
  child.stderr.on('data', data => (output += data));
  await until(() => output.includes('listening'));
  const posted = await req(
    port,
    'POST',
    '/api/boards/t/events',
    {
      rows: [
        { label: 'TASK_CREATED', task: 'team-mailbox', title: 'Team mailbox', text: 'private-body-marker' },
        { label: 'TASK_CREATED', task: 'team-mailbox-followup', title: 'Followup', text: 'private-body-marker' },
      ],
    },
    'OPS',
  );
  assert.equal(posted.status, 200);
  assert.ok(posted.body.results.every(result => result.ok));
  await until(() => target.calls.length === 1);
  assert.equal(target.calls[0].closed, false, 'the write completed without waiting for the receiver');
  for (const slug of ['replybox', 'bundlebox']) {
    const created = await req(port, 'PUT', `/api/cards/t-${slug}`, { board: 't', title: slug }, 'OWNER');
    assert.equal(created.status, 200);
  }
  const comment = await req(
    port,
    'POST',
    '/api/comments',
    { cardId: 't-replybox', text: 'private-body-marker' },
    'OWNER',
  );
  assert.equal(comment.status, 201);
  const bundle = await req(
    port,
    'POST',
    '/api/bundles',
    { board: 't', parts: [{ cardId: 't-bundlebox', text: 'private-body-marker' }] },
    'OWNER',
  );
  assert.equal(bundle.status, 201);
  await until(() => target.calls.length === 3);
  assert.deepEqual(target.calls.map(call => call.body.card).sort(), slugs.map(slug => 't-' + slug).sort());
  for (const call of target.calls) {
    assert.deepEqual(Object.keys(call.body).sort(), ['board', 'card', 'revision']);
    assert.equal(call.body.board, 't');
    assert.ok(call.body.revision > 0);
  }
  for (const route of ['/api/state', '/api/cards/t-team-mailbox', '/api/changes?since=0', '/']) {
    const response = await req(port, 'GET', route, null, 'OWNER');
    assert.equal(response.status, 200);
    assert.ok(!response.raw.includes(target.url) && !response.raw.includes('private-receiver-token'));
  }
  await wait(300);
  const saved = fs.readFileSync(path.join(dir, 'store.json'), 'utf8');
  assert.ok(!saved.includes(target.url) && !saved.includes('private-receiver-token'));
  assert.ok(!output.includes(target.url) && !output.includes('private-receiver-token'));
});
