'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const { test } = require('node:test');
const { spawnServer, testPort } = require('../../tests/sandbox.cjs');
const { req, wait } = require('./helpers');

async function cardFixture(context) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-card-rule-'));
  const port = await testPort();
  const config = path.join(dir, 'config.json');
  fs.writeFileSync(
    config,
    JSON.stringify({
      port,
      bind: '127.0.0.1',
      storeFile: 'store.json',
      tokens: {
        OWNER: { name: 'captain', via: 'page' },
        TOOLS: { name: 'worker', via: 'api', mode: 'tools' },
        LEGACY: { name: 'worker', via: 'api' },
      },
      boards: { demo: { name: 'Sample board', protocol: 'tools', access: { captain: 'owner', worker: 'operator' } } },
    }),
  );
  const server = spawnServer(config);
  let output = '';
  server.stdout.on('data', data => (output += data));
  server.stderr.on('data', data => (output += data));
  context.after(async () => {
    if (server.exitCode === null && server.signalCode === null) {
      const exited = once(server, 'exit');
      server.kill();
      await exited;
    }
    fs.rmSync(dir, { recursive: true, force: true });
  });
  for (let attempt = 0; attempt < 100 && !output.includes('listening'); attempt++) await wait(25);
  assert.match(output, /listening/, 'the scratch board started');
  const request = (method, url, body, token = 'TOOLS') => req(port, method, url, body, token);
  const posted = await request(
    'POST',
    '/api/comments',
    {
      board: 'demo',
      text: 'Build a sample export.',
      kind: 'task-request',
    },
    'OWNER',
  );
  assert.equal(posted.status, 201);
  const call = async (tool, args) => {
    const response = await request('POST', '/api/boards/demo/calls', {
      calls: [{ id: crypto.randomUUID(), tool, args }],
    });
    assert.equal(response.status, 200);
    return response.body.results[0];
  };
  const opened = await call('board_open', { title: 'Sample export', slug: 'export', state: 'inflight' });
  assert.equal(opened.ok, true, JSON.stringify(opened));
  const ask = async () => {
    const result = await call('board_ask', {
      card: 'export',
      question: 'May I implement the remaining export?',
      recommendation: 'Implement it.',
      reversible: 'yes',
    });
    assert.equal(result.ok, true);
  };
  return { request, call, ask };
}

test('cards: ClosedCardsHaveNoOpenAsks [scout flow: cards]', async context => {
  const board = await cardFixture(context);
  await board.ask();
  const guarded = await board.call('board_close', { card: 'export', outcome: 'done' });
  assert.equal(guarded.ok, false, 'the normal close correctly refuses the unresolved ask');
  const denied = await board.request('PATCH', '/api/cards/demo-export', { status: 'done' });
  assert.equal(denied.status, 403, 'a tools token cannot use the legacy writer');
  const closed = await board.request('PATCH', '/api/cards/demo-export', { status: 'done' }, 'LEGACY');
  assert.ok([200, 400, 409].includes(closed.status), 'the authorized legacy writer reached the real route');
  const stored = await board.request('GET', '/api/cards/demo-export');
  assert.equal(stored.status, 200);
  assert.equal(stored.body.card.id, 'demo-export');
  assert.ok(
    stored.body.card.status !== 'done' || stored.body.card.decisions.every(ask => ask.resolvedAt),
    'a closed card has no open asks',
  );
});

test('cards: OnlyTaskCompletionTriggersAfterDone [scout flow: cards]', async context => {
  const board = await cardFixture(context);
  const posted = await board.call('board_post', {
    card: 'export',
    kind: 'status',
    text: 'Completed preflight; implementation still pending.',
  });
  assert.equal(posted.ok, true);
  await board.ask();
  const conduct = await board.request('GET', '/api/boards/demo/conduct');
  assert.equal(conduct.status, 200);
  assert.equal(typeof conduct.body.signals.afterDone, 'number');
  assert.equal(conduct.body.signals.afterDone, 0, 'finishing preflight is not task completion');
  assert.deepEqual(conduct.body.examples.afterDone, []);
  assert.equal(conduct.body.hints.afterDone.certainty, 'uncertain');
  assert.equal(conduct.body.hints.afterDone.count, 1);
});
