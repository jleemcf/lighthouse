'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { once } = require('node:events');
const { spawnServer, testPort } = require('../../tests/sandbox.cjs');
const { req, wait } = require('./helpers');

async function cardFixture(context, initialStore, extraConfig = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'card-lifecycle-'));
  const port = await testPort();
  const config = {
    port,
    bind: '127.0.0.1',
    storeFile: 'store.json',
    tokens: {
      CAPTAIN: { name: 'owner', via: 'page' },
      OPS: { name: 'operator', via: 'api', mode: 'tools' },
      LEGACY: { name: 'operator', via: 'api' },
    },
    boards: {
      t: { name: 'Test', protocol: 'tools', access: { owner: 'owner', operator: 'operator' } },
      lines: { name: 'Lines', access: { owner: 'owner', operator: 'operator' } },
    },
  };
  Object.assign(config, extraConfig);
  fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify(config));
  if (initialStore) fs.writeFileSync(path.join(home, 'store.json'), JSON.stringify(initialStore));
  const env = { ...process.env };
  delete env.TYPESAFE_API_KEY;
  const server = spawnServer(path.join(home, 'config.json'), {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  server.stdout.on('data', data => (output += data));
  server.stderr.on('data', data => (output += data));
  context.after(async () => {
    if (server.exitCode === null) {
      const exited = once(server, 'exit');
      server.kill('SIGTERM');
      await exited;
    }
    assert.equal(path.dirname(path.resolve(home)), path.resolve(os.tmpdir()));
    fs.rmSync(home, { recursive: true, force: true });
  });
  for (let attempt = 0; attempt < 150 && !output.includes('listening on'); attempt++) await wait(20);
  assert.match(output, /listening on/);
  const request = (method, route, body, token = 'OPS') => req(port, method, route, body, token);
  const call = async (tool, args) => {
    const response = await request('POST', '/api/boards/t/calls', {
      calls: [{ id: crypto.randomUUID(), tool, args }],
    });
    assert.equal(response.status, 200);
    return response.body.results[0];
  };
  const open = async slug => {
    await request('POST', '/api/comments', { board: 't', text: 'Build ' + slug, kind: 'task-request' }, 'CAPTAIN');
    assert.equal((await call('board_open', { title: 'Build ' + slug, slug, state: 'inflight' })).ok, true);
  };
  const ask = async slug => {
    const result = await call('board_ask', {
      card: slug,
      question: 'May I implement the remaining export?',
      recommendation: 'Implement it.',
      reversible: 'yes',
    });
    assert.equal(result.ok, true);
    const response = await request('GET', '/api/cards/t-' + slug);
    return response.body.card.decisions.find(decision => !decision.resolvedAt);
  };
  return { request, call, open, ask, port };
}

module.exports = { cardFixture };
