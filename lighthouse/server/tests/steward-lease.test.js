'use strict';
const { testPort, spawnServer } = require('../../tests/sandbox.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { req, wait } = require('./helpers');

const requestId = '0123456789abcdef';
async function fixture(t, fields = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-steward-lease-'));
  const port = await testPort();
  const config = {
    port,
    bind: '127.0.0.1',
    storeFile: 'store.json',
    stewardClockMs: 3600000,
    tokens: {
      STEWARD: { name: 'steward-s', via: 'api', mode: 'steward', board: 's' },
      REPLACEMENT: { name: 'replacement-s', via: 'api', mode: 'steward', board: 's' },
    },
    boards: { s: { name: 'Test board', steward: true } },
  };
  const request = {
    id: requestId,
    board: 's',
    kind: 'ask',
    text: 'What should happen next?',
    state: 'pending',
    attempts: 0,
    priority: 0,
    t: new Date().toISOString(),
    ...fields,
  };
  fs.writeFileSync(path.join(directory, 'config.json'), JSON.stringify(config));
  fs.writeFileSync(path.join(directory, 'store.json'), JSON.stringify({ stewardRequests: { [requestId]: request } }));
  let child;
  const start = async () => {
    let output = '';
    child = spawnServer(path.join(directory, 'config.json'), { stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', data => (output += data));
    child.stderr.on('data', data => (output += data));
    for (let attempt = 0; attempt < 60 && !output.includes('listening'); attempt++) await wait(50);
    assert.ok(output.includes('listening'), output);
  };
  const stop = async () => {
    const exited = new Promise(resolve => child.once('exit', resolve));
    child.kill();
    await exited;
  };
  t.after(async () => {
    await stop();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  await start();
  return {
    call: (method, route, body, token = 'STEWARD') => req(port, method, '/api/steward/' + route, body, token),
    stored: () => JSON.parse(fs.readFileSync(path.join(directory, 'store.json'), 'utf8')),
    restart: async () => {
      await stop();
      await start();
    },
  };
}

test('a repeated steward claim replays the same leased job after a lost reply', async t => {
  const board = await fixture(t);
  const first = await board.call('GET', 'next');
  const second = await board.call('GET', 'next');
  assert.equal(first.status, 200);
  assert.ok(first.body.job);
  assert.ok(second.body.job, 'a lost reply must not strand the steward behind busy');
  assert.deepEqual(second.body.job, first.body.job);
  assert.equal(board.stored().stewardRequests[requestId].attempts, 1);
});

test('the claim holder and exact job survive a board restart and a starting heartbeat', async t => {
  const board = await fixture(t);
  const first = (await board.call('GET', 'next')).body.job;
  const stored = board.stored().stewardRequests[requestId];
  assert.equal(stored.lease.holder, 'steward-s');
  assert.ok(first.id);
  await board.restart();
  await board.call('POST', 'heartbeat', { starting: true });
  assert.deepEqual((await board.call('GET', 'next')).body.job, first);
  assert.equal(board.stored().stewardRequests[requestId].attempts, 1);
});

test('an old running record becomes the same holders lease without spending another attempt', async t => {
  const board = await fixture(t, {
    state: 'running',
    attempts: 1,
    runningSince: new Date(Date.now() - 31 * 60000).toISOString(),
  });
  const job = (await board.call('GET', 'next')).body.job;
  assert.equal(job.request, requestId);
  assert.equal(job.attempt, 1);
  assert.equal(board.stored().stewardRequests[requestId].lease.holder, 'steward-s');
});

test('a live lease blocks another holder and heartbeats keep it alive past the run limit', async t => {
  const board = await fixture(t, {
    state: 'running',
    attempts: 1,
    runningSince: new Date(Date.now() - 31 * 60000).toISOString(),
    lease: { holder: 'steward-s', at: new Date().toISOString() },
  });
  await board.call('POST', 'heartbeat', {});
  const other = await board.call('GET', 'next', null, 'REPLACEMENT');
  assert.equal(other.body.busy, true);
  assert.equal((await board.call('GET', 'next')).body.job.attempt, 1);
});

test('lease expiry is a fallback only when another holder replaces a departed steward', async t => {
  const old = new Date(Date.now() - 31 * 60000).toISOString();
  const board = await fixture(t, {
    state: 'running',
    attempts: 1,
    runningSince: old,
    lease: { holder: 'departed-steward', at: old },
  });
  const job = (await board.call('GET', 'next')).body.job;
  assert.equal(job.request, requestId);
  assert.equal(job.attempt, 2);
  assert.equal(board.stored().stewardRequests[requestId].lease.holder, 'steward-s');
});

test('a legacy result is durable before acknowledgement and duplicates preserve the first answer', async t => {
  const board = await fixture(t);
  const job = (await board.call('GET', 'next')).body.job;
  const first = await board.call('POST', 'result', { request: job.request, oneLine: 'First answer', text: 'Keep it.' });
  assert.equal(first.status, 200);
  assert.equal(first.body.request, requestId);
  assert.equal(board.stored().stewardRequests[requestId].state, 'answered');
  await board.restart();
  const again = await board.call('POST', 'result', { request: job.request, oneLine: 'Different answer' });
  assert.equal(again.status, 200);
  assert.equal(again.body.duplicate, true);
  assert.equal(again.body.advice, first.body.advice);
  const advice = Object.values(board.stored().advice);
  assert.equal(advice.length, 1);
  assert.equal(advice[0].oneLine, 'First answer');
  assert.equal((await board.call('GET', 'next')).body.job, null);
});

test('the first completed answer can settle a failed attempt without waiting for a rerun', async t => {
  const board = await fixture(t);
  await board.call('GET', 'next');
  const failed = await board.call('POST', 'result', { request: requestId, failed: true, detail: 'interrupted' });
  assert.equal(failed.body.state, 'pending');
  const late = await board.call('POST', 'result', { request: requestId, oneLine: 'Completed answer' });
  assert.equal(late.status, 200);
  assert.equal(board.stored().stewardRequests[requestId].attempts, 1);
  assert.equal((await board.call('GET', 'next')).body.job, null);
});

test('an unclaimed request cannot be answered', async t => {
  const board = await fixture(t);
  assert.equal((await board.call('POST', 'result', { request: requestId, oneLine: 'Not run' })).status, 409);
});
