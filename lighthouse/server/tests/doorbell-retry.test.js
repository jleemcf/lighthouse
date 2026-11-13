'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const makeStore = require('../store');
const makeDoorbells = require('../doorbells');
const { wait } = require('./helpers');

async function until(check) {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (check()) return;
    await wait(10);
  }
  assert.ok(check(), 'expected doorbell reconciliation within two seconds');
}

async function setup(context, respond, timing = {}) {
  const calls = [];
  const server = http.createServer((request, response) => {
    let body = '';
    request.on('data', chunk => (body += chunk));
    request.on('end', () => {
      calls.push(JSON.parse(body));
      respond(request, response, calls);
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-wake-retry-'));
  const cfg = { cardDoorbells: [{ slug: 'inbox', url: `http://127.0.0.1:${server.address().port}/secret` }] };
  let ctx;
  function restart() {
    ctx?.closeDoorbells?.();
    ctx = { cfg, CONFIG_PATH: path.join(dir, 'config.json') };
    Object.assign(ctx, makeStore(ctx));
    Object.assign(ctx, makeDoorbells(ctx, { intervalMs: 20, timeoutMs: 40, maxRetryMs: 80, ...timing }));
    return ctx;
  }
  restart();
  const card = { id: 't-inbox', board: 't', log: [] };
  ctx.store.cards[card.id] = card;
  context.after(() => {
    ctx.closeDoorbells?.();
    ctx.saveNow();
    server.closeAllConnections();
    server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return { ctx, card, calls, dir, restart };
}

test('NoSilentLostWake: a sole 503 retains a retry until the receiver acknowledges', async context => {
  const { ctx, card, calls } = await setup(context, (request, response, received) => {
    response.writeHead(received.length === 1 ? 503 : 204).end();
  });
  ctx.pushLog(card, { kind: 'FYI', text: 'one committed update' });
  ctx.saveNow();
  await wait(240);
  assert.ok(calls.length >= 2, 'a failed sole wake must retry without a later card write');
  assert.equal(calls.length, 2, 'an acknowledged revision stops retrying');
  assert.equal(ctx.store.doorbells[card.id].acknowledged, 1);
});

test('a timed-out wake retries the same committed revision', async context => {
  const { ctx, card, calls } = await setup(context, (request, response, received) => {
    if (received.length > 1) response.writeHead(204).end();
  });
  ctx.pushLog(card, { kind: 'FYI', text: 'one update' });
  await until(() => ctx.store.doorbells[card.id].acknowledged === 1);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0], calls[1]);
});

test('response loss is retried with a stable identity so receiver work can de-duplicate', async context => {
  const effects = new Set();
  const { ctx, card, calls } = await setup(context, (request, response, received) => {
    const wake = received.at(-1);
    effects.add(`${wake.board}/${wake.card}/${wake.revision}`);
    if (received.length === 1) request.socket.destroy();
    else response.writeHead(204).end();
  });
  ctx.pushLog(card, { kind: 'FYI', text: 'one update' });
  await until(() => ctx.store.doorbells[card.id].acknowledged === 1);
  assert.equal(calls.length, 2);
  assert.equal(effects.size, 1, 'the receiver applies each delivery identity only once');
  assert.deepEqual(calls[0], calls[1]);
});

test('failure backoff is bounded and its backlog is visible without exposing the receiver', async context => {
  const { ctx, card, calls, dir } = await setup(context, (request, response) => response.writeHead(503).end());
  ctx.pushLog(card, { kind: 'FYI', text: 'one update' });
  await until(() => ctx.store.doorbells[card.id].failures >= 4);
  const record = ctx.store.doorbells[card.id];
  assert.equal(record.nextAttemptAt - record.lastFailureAt, 80);
  assert.ok(calls.length >= 4);
  const visible = ctx.doorbellStatus({ t: {} });
  assert.equal(visible[card.id].status, 'retrying');
  assert.equal(visible[card.id].revision, 1);
  assert.deepEqual(ctx.doorbellStatus({ other: {} }), {});
  const persisted = fs.readFileSync(path.join(dir, 'store.json'), 'utf8');
  assert.ok(!persisted.includes('/secret'));
  assert.ok(!JSON.stringify(visible).includes('/secret'));
  assert.equal(JSON.parse(persisted).doorbells[card.id].revision, 1);
});

for (const interrupted of ['failed', 'inflight']) {
  test(`startup reconciles a persisted ${interrupted} wake without a later write`, async context => {
    let accepting = false;
    const fixture = await setup(context, (request, response) => {
      if (accepting) response.writeHead(204).end();
      else if (interrupted === 'failed') response.writeHead(503).end();
    });
    const { ctx, card, calls } = fixture;
    ctx.pushLog(card, { kind: 'FYI', text: 'one committed update' });
    await until(() => calls.length === 1);
    if (interrupted === 'failed') await until(() => ctx.store.doorbells[card.id].failures === 1);
    accepting = true;
    const resumed = fixture.restart();
    await until(() => resumed.store.doorbells[card.id].acknowledged === 1);
    assert.deepEqual(calls[0], calls[1]);
    assert.equal(resumed.store.cardRevisions[card.id], 1);
    assert.equal(resumed.store.cards[card.id].log.length, 1);
  });
}

test('CoalescingNeverInventsUpdates: an old acknowledgment cannot erase the latest revision', async context => {
  let firstResponse;
  let trailingResponse;
  const { ctx, card, calls } = await setup(
    context,
    (request, response, received) => {
      if (received.length === 1) firstResponse = response;
      else trailingResponse = response;
    },
    { timeoutMs: 1000 },
  );
  ctx.pushLog(card, { kind: 'FYI', text: 'first update' });
  await until(() => calls.length === 1);
  for (let update = 0; update < 5; update++) ctx.pushLog(card, { kind: 'FYI', text: 'later update' });
  ctx.saveNow();
  await wait(60);
  assert.equal(calls.length, 1, 'there is only one in-flight request per card');
  assert.equal(ctx.store.doorbells[card.id].revision, 6);
  firstResponse.writeHead(204).end();
  await until(() => trailingResponse);
  assert.equal(ctx.store.doorbells[card.id].acknowledged, 1, 'acknowledgment applies only to the revision sent');
  trailingResponse.writeHead(204).end();
  await until(() => ctx.store.doorbells[card.id].acknowledged === 6);
  assert.deepEqual(
    calls.map(wake => wake.revision),
    [1, 6],
  );
  ctx.ringCard(card, 999);
  ctx.ringCard(card, 6);
  await wait(100);
  assert.equal(calls.length, 2, 'neither retries nor repeated registration invent a revision');
  assert.equal(ctx.store.cardRevisions[card.id], 6);
});

test('the card and pending wake are saved together before the receiver is called', async context => {
  let committed;
  const fixture = await setup(context, (request, response) => {
    committed = JSON.parse(fs.readFileSync(path.join(fixture.dir, 'store.json'), 'utf8'));
    response.writeHead(204).end();
  });
  fixture.ctx.pushLog(fixture.card, { kind: 'FYI', text: 'committed body' });
  await until(() => fixture.ctx.store.doorbells[fixture.card.id].acknowledged === 1);
  assert.equal(committed.cards[fixture.card.id].log[0].text, 'committed body');
  assert.equal(committed.cardRevisions[fixture.card.id], 1);
  assert.equal(committed.doorbells[fixture.card.id].revision, 1);
  assert.equal(committed.doorbells[fixture.card.id].acknowledged, 0);
});

test('removing a receiver leaves its unanswered wake visible and durable', async context => {
  const fixture = await setup(context, (request, response) => response.writeHead(503).end());
  fixture.ctx.pushLog(fixture.card, { kind: 'FYI', text: 'one update' });
  await until(() => fixture.ctx.store.doorbells[fixture.card.id].failures === 1);
  fixture.ctx.cfg.cardDoorbells = [];
  const resumed = fixture.restart();
  assert.equal(resumed.doorbellStatus({ t: {} })[fixture.card.id].status, 'unconfigured');
  await wait(100);
  assert.equal(fixture.calls.length, 1);
  assert.equal(resumed.store.doorbells[fixture.card.id].acknowledged, 0);
});
