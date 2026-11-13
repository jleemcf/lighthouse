'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { once } = require('node:events');
const { spawnServer, testPort } = require('../../tests/sandbox.cjs');
const { fixture } = require('./registry-fixture');

async function httpFixture(context, configure = cfg => cfg) {
  const ctx = fixture(context, { cleanup: false });
  ctx.cfg.port = await testPort();
  ctx.cfg.bind = '127.0.0.1';
  ctx.cfg.tokens.fixtureSecond = { name: 'second', via: 'page' };
  fs.writeFileSync(ctx.configPath, JSON.stringify(configure(JSON.parse(JSON.stringify(ctx.cfg)), ctx)));
  fs.writeFileSync(path.join(ctx.directory, 'store.json'), JSON.stringify({ ...ctx.store, schemaVersion: 2 }));
  const env = { ...process.env };
  delete env.TYPESAFE_API_KEY;
  const server = spawnServer(ctx.configPath, { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  const started = new Promise((resolve, reject) => {
    server.stdout.on('data', bytes => {
      output += bytes;
      if (output.includes('listening on')) resolve();
    });
    server.stderr.on('data', bytes => {
      output += bytes;
    });
    server.once('error', reject);
    server.once('exit', () => {
      if (!output.includes('listening on')) reject(new Error('scratch server did not start'));
    });
  });
  context.after(async () => {
    if (server.exitCode === null) {
      const exited = once(server, 'exit');
      server.kill('SIGTERM');
      await exited;
    }
    fs.rmSync(ctx.directory, { recursive: true, force: true });
  });
  await started;
  const endpoint = 'http://127.0.0.1:' + ctx.cfg.port;
  const request = async (method, route, body, credential = ctx.adminFile.credential, extraHeaders = {}) => {
    const headers = { 'Content-Type': 'application/json', ...extraHeaders };
    if (credential) headers.Authorization = 'Bearer ' + credential;
    const response = await fetch(endpoint + route, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });
    return { status: response.status, body: await response.json() };
  };
  const privateOutput = values =>
    assert.ok(
      values.every(value => !output.includes(value)),
      'server logs are redacted',
    );
  return { ...ctx, endpoint, request, privateOutput, logs: () => output };
}

module.exports = { httpFixture };
