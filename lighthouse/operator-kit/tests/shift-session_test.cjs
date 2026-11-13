'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { testPort } = require('../../tests/sandbox.cjs');
const { watch, HEARTBEAT_MS } = require('../scripts/shift-session.cjs');
const { wait } = require('../../server/tests/helpers');

test('session heartbeat: quiet pipes keep pulsing; shadow sessions never pulse', async context => {
  const pulses = [];
  const stop = watch({
    board: 't',
    shadow: () => false,
    intervalMs: 20,
    request: async (...args) => pulses.push(args),
  });
  context.after(stop);
  await wait(75);
  stop();
  assert.ok(pulses.length >= 3);
  assert.equal(HEARTBEAT_MS, 60000);
  assert.ok(pulses.every(pulse => pulse[1] === '/api/boards/t/heartbeat'));
  assert.equal(new Set(pulses.map(pulse => pulse[2].session)).size, 1);
  const count = pulses.length;
  const stopShadow = watch({
    board: 't',
    shadow: () => true,
    intervalMs: 10,
    request: async (...args) => pulses.push(args),
  });
  await wait(35);
  stopShadow();
  assert.equal(pulses.length, count);
});

test('explicit session retries through a 90-second restart without losing its lease', async context => {
  context.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 0 });
  const identity = { sessionId: 'session-restart', processId: 'process-restart', epoch: 7 };
  let leaseUntil = 180000;
  const pulses = [];
  const stop = watch({
    board: 'fixture',
    shadow: () => false,
    identity,
    request: async (_method, route, body) => {
      if (route.endsWith('/ownership')) return { status: 200 };
      const now = Date.now();
      pulses.push({ now, session: body.session });
      if (now >= 60000 && now < 150000) return { status: 0 };
      assert.ok(now < leaseUntil, 'restart must not require a new session or captain recovery');
      leaseUntil = now + 180000;
      return { status: 200 };
    },
  });
  context.after(stop);
  const settle = async () => {
    for (let turn = 0; turn < 8; turn++) await Promise.resolve();
  };
  await settle();
  for (let elapsed = 5000; elapsed <= 155000; elapsed += 5000) {
    context.mock.timers.tick(5000);
    await settle();
  }
  assert.ok(pulses.some(pulse => pulse.now === 150000));
  assert.equal(leaseUntil, 330000);
  assert.ok(pulses.every(pulse => pulse.session === identity.sessionId));
  assert.equal(identity.epoch, 7);
  stop();
  const count = pulses.length;
  context.mock.timers.tick(120000);
  await settle();
  assert.equal(pulses.length, count);
});

for (const status of [0, 503, 409])
  test('explicit attachment retries respect response status ' + status, async context => {
    context.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
    let attempts = 0;
    let pulses = 0;
    const stop = watch({
      board: 'fixture',
      shadow: () => false,
      identity: { sessionId: 'session-retry', processId: 'process-retry', epoch: 1 },
      request: async (method, route) => {
        if (method === 'GET') return { status: 200, body: { enabled: false } };
        if (route.endsWith('/ownership')) {
          attempts++;
          return { status };
        }
        pulses++;
        return { status: 200 };
      },
    });
    context.after(stop);
    const settle = async () => {
      for (let turn = 0; turn < 8; turn++) await Promise.resolve();
    };
    await settle();
    for (let elapsed = 5000; elapsed <= 120000; elapsed += 5000) {
      context.mock.timers.tick(5000);
      await settle();
    }
    assert.equal(attempts, status === 409 ? 3 : 25);
    assert.equal(pulses, 0);
  });

test('session lifetime: actual MCP stdio heartbeat ends at EOF; shell calls never heartbeat', async context => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'shift-session-'));
  context.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const scripts = path.join(__dirname, '..', 'scripts');
  for (const file of [
    'lighthouse-mcp.cjs',
    'toolcalls-spec.json',
    'kit-version.cjs',
    'shift-session.cjs',
    'session-identity.cjs',
    'handoff.cjs',
    'dispatch-client.cjs',
    'dispatch-storage.cjs',
    'mcp-setup.cjs',
  ])
    fs.copyFileSync(path.join(scripts, file), path.join(home, file));
  const pulses = [];
  const edges = [];
  const server = http.createServer((request, response) => {
    let body = '';
    request.on('data', chunk => (body += chunk));
    request.on('end', () => {
      const data = body ? JSON.parse(body) : {};
      if (request.url.endsWith('/heartbeat')) pulses.push(data);
      if (request.url.endsWith('/shift')) edges.push(data.state);
      response.setHeader('Content-Type', 'application/json');
      response.end(
        JSON.stringify(
          request.url.endsWith('/shift')
            ? { state: data.state }
            : { results: [{ ok: true }], receipt: 'Synthetic receipt.' },
        ),
      );
    });
  });
  server.listen(await testPort(), '127.0.0.1');
  await once(server, 'listening');
  context.after(() => server.close());
  const env = {
    ...process.env,
    LH_SERVER: 'http://127.0.0.1:' + server.address().port,
    LH_BOARD: 't',
    LH_TOKEN: 'synthetic-session-token',
  };
  const start = args =>
    spawn(process.execPath, [path.join(home, 'lighthouse-mcp.cjs'), ...args], {
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  const session = start([]);
  context.after(() => {
    if (session.exitCode === null) session.kill();
  });
  for (let attempt = 0; attempt < 100 && !pulses.length; attempt++) await wait(10);
  assert.equal(pulses.length, 1, 'an idle connected server reports without a model tool call');
  const exited = once(session, 'exit');
  session.stdin.end();
  assert.equal((await exited)[0], 0, 'closing the session input terminates the real MCP process');
  const count = pulses.length;
  for (const args of [
    ['call', 'board_status', '{}'],
    ['shift', 'start'],
    ['shift', 'end'],
  ]) {
    const command = start(args);
    command.stdin.end();
    let output = '';
    command.stderr.on('data', chunk => (output += chunk));
    assert.equal((await once(command, 'exit'))[0], 0, output);
  }
  await wait(50);
  assert.equal(pulses.length, count, 'no session heartbeat from EOF or one-shot CLI commands');
  assert.deepEqual(edges, ['on', 'off']);
});
