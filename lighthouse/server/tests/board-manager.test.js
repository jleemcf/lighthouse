'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const http = require('node:http');
const { req, wait } = require('./helpers');
const { assertNoPaidKey, assertTestConfig, testPort } = require('../../tests/sandbox.cjs');

const SOURCE = path.join(__dirname, '..');
const linuxOnly = { skip: process.platform !== 'linux' && 'board.sh requires Linux /proc and setsid' };

async function boardHome(t, options = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-manager-'));
  const port = await testPort();
  for (const name of fs
    .readdirSync(SOURCE)
    .filter(name => name.endsWith('.js') || ['rulings.json', 'release.json'].includes(name)))
    fs.copyFileSync(path.join(SOURCE, name), path.join(home, name));
  const script = path.join(home, 'board.sh');
  fs.writeFileSync(script, fs.readFileSync(path.join(SOURCE, 'board.sh'), 'utf8').replace(/\r\n/g, '\n'));
  fs.chmodSync(script, 0o644);
  const config = path.join(home, options.config || 'config.json');
  fs.mkdirSync(path.dirname(config), { recursive: true });
  fs.writeFileSync(
    config,
    JSON.stringify({
      port,
      bind: '127.0.0.1',
      storeFile: options.storeFile || 'store.json',
      tokens: { TEST: { name: 'tester', via: 'page' }, CLAIM: { name: 'fixture-operator', via: 'api' } },
      boards: { test: { access: { tester: 'owner' } } },
    }),
  );
  const storeFile = path.resolve(path.dirname(config), options.storeFile || 'store.json');
  fs.mkdirSync(path.dirname(storeFile), { recursive: true });
  fs.writeFileSync(
    storeFile,
    JSON.stringify({
      cards: {
        'test-old': { id: 'test-old', board: 'test', status: 'done', updatedAt: '2000-01-01T00:00:00Z' },
        'test-open': { id: 'test-open', board: 'test', status: 'inflight' },
      },
    }),
  );
  const env = { ...process.env, NODE: process.execPath, LH_CONFIG: config };
  const pids = new Set();
  const pidFile = path.join(home, 'board.pid');
  const pid = () => Number(fs.readFileSync(pidFile, 'utf8').trim());
  function run(...args) {
    assertNoPaidKey(env);
    assertTestConfig(env.LH_CONFIG);
    return new Promise((resolve, reject) => {
      const child = spawn('bash', [script, ...args], { cwd: home, env });
      let output = '';
      child.stdout.on('data', data => (output += data));
      child.stderr.on('data', data => (output += data));
      child.on('error', reject);
      child.on('close', code => {
        if (fs.existsSync(pidFile)) pids.add(pid());
        resolve({ code, output });
      });
    });
  }
  t.after(async () => {
    if (fs.existsSync(pidFile)) pids.add(pid());
    for (const processId of pids) {
      try {
        process.kill(processId, 'SIGKILL');
      } catch {}
    }
    await wait(100);
    fs.rmSync(home, { recursive: true, force: true });
  });
  const started = await run('start');
  assert.equal(started.code, 0, started.output);
  assert.match(started.output, /started, pid/);
  return { home, port, config, env, storeFile, pidFile, pid, run };
}

test('stop waits for an in-flight write, its final save and port release', linuxOnly, async t => {
  const board = await boardHome(t);
  const body = JSON.stringify({ board: 'test', title: 'Saved during shutdown' });
  let pending;
  const response = new Promise((resolve, reject) => {
    pending = http.request(
      {
        host: '127.0.0.1',
        port: board.port,
        method: 'PUT',
        path: '/api/cards/test-late',
        headers: { Authorization: 'Bearer TEST', 'Content-Length': Buffer.byteLength(body) },
      },
      res => {
        res.resume();
        res.on('end', () => resolve(res.statusCode));
      },
    );
    pending.on('error', reject);
    pending.write(body.slice(0, -1));
  });
  response.catch(() => {});
  t.after(() => pending.destroy());
  await wait(100);
  assert.equal((await req(board.port, 'GET', '/api/whoami', null, 'TEST')).status, 200);
  const started = Date.now();
  let stopResult;
  const stopped = board.run('stop').then(result => (stopResult = result));
  await wait(1200);
  assert.equal(stopResult, undefined, 'stop must wait while the last write is still in flight');
  assert.ok(fs.existsSync(board.pidFile), 'the pid stays until exit');
  pending.end(body.slice(-1));
  assert.equal(await response, 200);
  const result = await stopped;
  assert.equal(result.code, 0, result.output);
  assert.match(result.output, /^stopped\s*$/);
  assert.ok(Date.now() - started >= 1200);
  assert.ok(!fs.existsSync(board.pidFile));
  assert.equal(JSON.parse(fs.readFileSync(board.storeFile)).cards['test-late'].title, 'Saved during shutdown');
  const listener = net.createServer();
  await new Promise((resolve, reject) => {
    listener.once('error', reject);
    listener.listen(board.port, '127.0.0.1', resolve);
  });
  await new Promise(resolve => listener.close(resolve));
});

test('stop treats an unreaped zombie server as exited', linuxOnly, async t => {
  const board = await boardHome(t);
  assert.equal((await board.run('stop')).code, 0);
  const env = { ...process.env };
  assertNoPaidKey(env);
  const source = [
    'import os, sys',
    'child = os.fork()',
    'if child == 0:',
    '    os.execl(sys.argv[1], sys.argv[1], sys.argv[2], "--config", sys.argv[3])',
    'print(f"PID={child}", flush=True)',
    'sys.stdin.read()',
    'os.waitpid(child, 0)',
  ].join('\n');
  const parent = spawn(
    'python3',
    ['-c', source, process.execPath, path.join(board.home, 'server.js'), path.join(board.home, 'config.json')],
    { env },
  );
  let output = '';
  parent.stdout.on('data', data => (output += data));
  parent.stderr.on('data', data => (output += data));
  t.after(async () => {
    const match = /^PID=(\d+)$/m.exec(output);
    if (match) {
      try {
        process.kill(Number(match[1]), 'SIGKILL');
      } catch {}
    }
    if (parent.exitCode === null) {
      const exited = new Promise(resolve => parent.once('exit', resolve));
      parent.stdin.end();
      await exited;
    }
  });
  for (let attempt = 0; attempt < 100 && !output.includes('listening'); attempt++) await wait(50);
  assert.ok(output.includes('listening'), output);
  const processId = Number(/^PID=(\d+)$/m.exec(output)[1]);
  fs.writeFileSync(board.pidFile, String(processId));
  const started = Date.now();
  const result = await board.run('stop');
  assert.equal(result.code, 0, result.output);
  assert.match(result.output, /^stopped\s*$/);
  assert.ok(Date.now() - started < 5000, 'an exited server must not consume the shutdown deadline');
  process.kill(processId, 0);
  assert.match(fs.readFileSync('/proc/' + processId + '/stat', 'utf8'), /\) Z /);
  assert.ok(!fs.existsSync(board.pidFile));
});

for (const action of ['archive', 'clear-cards']) {
  test(`${action} works with a non-executable manager and starts the board again`, linuxOnly, async t => {
    const board = await boardHome(t);
    const previous = board.pid();
    const result = await board.run(action, 'test', '7');
    assert.equal(result.code, 0, result.output);
    assert.match(result.output, /stopped/);
    assert.match(result.output, /started, pid/);
    assert.notEqual(board.pid(), previous);
    const store = JSON.parse(fs.readFileSync(board.storeFile));
    assert.ok(!store.cards['test-old']);
    assert.equal(!!store.cards['test-open'], action === 'archive');
    const archived = path.join(board.home, 'archive', 'test', 'test-old.json');
    assert.equal(JSON.parse(fs.readFileSync(archived)).card.id, 'test-old');
    assert.equal((await req(board.port, 'GET', '/api/whoami', null, 'TEST')).status, 200);
    assert.equal((await board.run('stop')).code, 0);
  });
}

test('clear-cards backs up the configured non-default store before removing cards', linuxOnly, async test => {
  const board = await boardHome(test, { config: 'settings/board.json', storeFile: 'state/custom.json' });
  const result = await board.run('clear-cards', 'test');
  assert.equal(result.code, 0, result.output);
  const copies = fs.readdirSync(path.dirname(board.storeFile)).filter(name => name.startsWith('custom.json.bak-'));
  assert.equal(copies.length, 1);
  const backup = JSON.parse(fs.readFileSync(path.join(path.dirname(board.storeFile), copies[0])));
  assert.ok(backup.cards['test-open']);
  assert.ok(!JSON.parse(fs.readFileSync(board.storeFile)).cards['test-open']);
  assert.equal((await req(board.port, 'GET', '/api/whoami', null, 'TEST')).status, 200);
});

test('a failed safety copy refuses clear-cards and preserves its failure through restart', linuxOnly, async test => {
  const board = await boardHome(test);
  const binaries = path.join(board.home, 'bin');
  fs.mkdirSync(binaries);
  fs.writeFileSync(path.join(binaries, 'cp'), '#!/usr/bin/env bash\nexit 37\n', { mode: 0o755 });
  board.env.PATH = binaries + path.delimiter + board.env.PATH;
  const result = await board.run('clear-cards', 'test');
  assert.equal(result.code, 37, result.output);
  assert.match(result.output, /safety copy failed/i);
  assert.ok(JSON.parse(fs.readFileSync(board.storeFile)).cards['test-open']);
  assert.ok(!fs.existsSync(path.join(board.home, 'archive')));
  assert.equal((await req(board.port, 'GET', '/api/whoami', null, 'TEST')).status, 200);
});

test('archive reports an invalid target even when the stopped board restarts', linuxOnly, async test => {
  const board = await boardHome(test);
  fs.writeFileSync(path.join(board.home, 'archive'), 'Not a directory');
  const result = await board.run('archive', 'test');
  assert.notEqual(result.code, 0, result.output);
  assert.match(result.output, /started, pid/);
  assert.ok(JSON.parse(fs.readFileSync(board.storeFile)).cards['test-old']);
});

test('archive refuses an invalid board before stopping the serving process', linuxOnly, async test => {
  const board = await boardHome(test);
  const before = board.pid();
  const result = await board.run('archive', 'missing-board');
  assert.equal(result.code, 2, result.output);
  assert.match(result.output, /Select a configured board/);
  assert.doesNotMatch(result.output, /started, pid/);
  assert.equal(board.pid(), before);
});

test('claim uses the manager configuration and its adjacent claims directory', linuxOnly, async test => {
  const board = await boardHome(test, { config: 'settings/board.json' });
  const result = await board.run('claim', 'fixture-operator');
  assert.equal(result.code, 0, 'claim must use LH_CONFIG, not config.json beside the manager');
  const claims = fs.readdirSync(path.join(path.dirname(board.config), 'claims'));
  assert.equal(claims.length, 1);
  const claim = JSON.parse(fs.readFileSync(path.join(path.dirname(board.config), 'claims', claims[0])));
  assert.equal(claim.name, 'fixture-operator');
  assert.ok(!fs.existsSync(path.join(board.home, 'claims')));
});

test('a stop timeout blocks archive, clear-cards and restart without changing the store', linuxOnly, async t => {
  await Promise.all(
    ['archive', 'clear-cards', 'restart'].map(action =>
      t.test(action, async subtest => {
        const board = await boardHome(subtest);
        const previous = board.pid();
        const before = fs.readFileSync(board.storeFile, 'utf8');
        process.kill(previous, 'SIGSTOP');
        const started = Date.now();
        const result = await board.run(action, 'test', '7');
        assert.notEqual(result.code, 0, result.output);
        assert.match(result.output, /did not stop/);
        assert.doesNotMatch(result.output, /stopped|started, pid/);
        assert.ok(Date.now() - started >= 14000, 'allow the server its shutdown deadline');
        assert.equal(board.pid(), previous, 'keep the original pid for recovery; never start another server');
        assert.equal(fs.readFileSync(board.storeFile, 'utf8'), before);
        assert.ok(!fs.existsSync(path.join(board.home, 'archive')));
        assert.ok(!fs.readdirSync(board.home).some(name => name.startsWith('store.json.bak-')));
        process.kill(previous, 0);
      }),
    ),
  );
});
