'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const { testPort, spawnServer } = require('../../tests/sandbox.cjs');
const { req, rawReq, wait } = require('./helpers');

module.exports = async function releaseFixture(test, initial = {}, betaProtocol = 'lines', settings = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-release-'));
  const port = await testPort();
  const config = path.join(directory, 'config.json');
  fs.writeFileSync(
    config,
    JSON.stringify({
      port,
      bind: '127.0.0.1',
      tokens: {
        ALPHA: { name: 'alpha', via: 'api' },
        BETA: { name: 'beta', via: 'api' },
        TOOLS: { name: 'beta', via: 'api', mode: 'tools' },
        OWNER: { name: 'owner', via: 'page' },
      },
      boards: {
        alpha: { access: { alpha: 'operator', owner: 'owner' } },
        beta: { protocol: betaProtocol, access: { beta: 'operator', owner: 'owner' } },
      },
      ...settings,
    }),
  );
  fs.writeFileSync(path.join(directory, 'store.json'), JSON.stringify(initial));
  const child = spawnServer(config, { stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', bytes => (output += bytes));
  child.stderr.on('data', bytes => (output += bytes));
  test.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit');
      child.kill();
      await exited;
    }
    fs.rmSync(directory, { recursive: true, force: true });
  });
  for (let attempt = 0; attempt < 100 && !output.includes('listening'); attempt++) await wait(50);
  assert.match(output, /listening/);
  return {
    stop: async () => {
      if (child.exitCode === null && child.signalCode === null) {
        const exited = once(child, 'exit');
        child.kill();
        await exited;
      }
    },
    directory,
    port,
    output: () => output,
    request: (method, route, body, token = 'ALPHA') => req(port, method, route, body, token),
    raw: (method, route, bytes, headers, token = 'ALPHA') => rawReq(port, method, route, bytes, headers, token),
    upload: async (token = 'ALPHA') => {
      const result = await rawReq(
        port,
        'POST',
        '/api/attachments',
        Buffer.from('Fixture attachment'),
        { 'Content-Type': 'text/plain' },
        token,
      );
      assert.equal(result.status, 201);
      return result.body.id;
    },
  };
};
