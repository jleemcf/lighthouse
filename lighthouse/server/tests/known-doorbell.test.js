'use strict';
require('../../tests/sandbox.cjs');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const makeStore = require('../store');
const makeDoorbells = require('../doorbells');
const { wait } = require('./helpers');

test('doorbell: NoSilentLostWake [scout flow: doorbell]', async context => {
  let requests = 0;
  const receiver = http.createServer((request, response) => {
    requests++;
    request.resume();
    response.writeHead(requests === 1 ? 503 : 204).end();
  });
  await new Promise(resolve => receiver.listen(0, '127.0.0.1', resolve));
  context.after(
    () =>
      new Promise(resolve => {
        receiver.closeAllConnections();
        receiver.close(resolve);
      }),
  );
  const url = `http://127.0.0.1:${receiver.address().port}/sample-wake`;
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-doorbell-rule-'));
  const ctx = { cfg: { cardDoorbells: [{ slug: 'inbox', url }] }, CONFIG_PATH: path.join(home, 'config.json') };
  Object.assign(ctx, makeStore(ctx));
  Object.assign(ctx, makeDoorbells(ctx, { intervalMs: 30, timeoutMs: 100, maxRetryMs: 120 }));
  context.after(() => {
    ctx.closeDoorbells();
    ctx.saveNow();
    fs.rmSync(home, { recursive: true, force: true });
  });
  const card = { id: 'demo-inbox', board: 'demo', log: [] };
  ctx.store.cards[card.id] = card;
  ctx.pushLog(card, { kind: 'FYI', text: 'one committed update' });
  for (let attempt = 0; attempt < 100 && requests === 0; attempt++) await wait(10);
  assert.ok(requests > 0, 'the scratch receiver saw the committed update and refused it');
  await wait(250);
  assert.ok(requests > 1, 'a refused wake needs retry or reconciliation, not silence after cooldown');
  assert.equal(ctx.store.doorbells[card.id].acknowledged, 1, 'the committed revision is acknowledged');
});
