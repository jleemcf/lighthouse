'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn, spawnSync } = require('node:child_process');
const { bash, env } = require('../../verification/update/bootstrap-replay.cjs');
const scripts = path.join(__dirname, '../scripts');
const environment = { ...env };
delete environment.TYPESAFE_API_KEY;
const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const read = file => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '');

async function until(predicate, label) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await pause(20);
  }
  assert.fail(label);
}

function fixture(context) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'watch-pipe-'));
  const children = [];
  for (const name of ['watch-output.cjs', 'watch-lease.cjs', 'gate-policy.cjs', 'gate-rules.json'])
    fs.copyFileSync(path.join(scripts, name), path.join(home, name));
  const copy = (name, transform = text => text) => {
    fs.writeFileSync(path.join(home, name), transform(fs.readFileSync(path.join(scripts, name), 'utf8')));
  };
  const start = (name, args = [], extra = {}) => {
    const { command = process.execPath, ...options } = extra;
    const child = spawn(command, [path.join(home, name), ...args], {
      env: environment,
      stdio: 'pipe',
      ...options,
    });
    children.push(child);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    let output = '';
    let errors = '';
    child.stdout.on('data', bytes => (output += bytes));
    child.stderr.on('data', bytes => (errors += bytes));
    return { child, output: () => output, errors: () => errors };
  };
  context.after(async () => {
    const sweepPid = read(path.join(home, 'lh.pid')).trim();
    if (/^\d+$/.test(sweepPid))
      spawnSync(bash, ['-c', 'kill -TERM "$1"', 'stop-sweep-fixture', sweepPid], { env: environment });
    for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill();
    await until(
      () => children.every(child => child.exitCode !== null || child.signalCode !== null),
      'fixture children exit',
    );
    fs.rmSync(home, { recursive: true, force: true });
  });
  return { home, copy, start, children };
}

async function board(context, handler) {
  const server = http.createServer((request, response) => {
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify(handler(request.url)));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  context.after(() => server.close());
  return 'http://127.0.0.1:' + server.address().port;
}

test('boardwatch exits on closed native output without committing its message cursor or seen key', async context => {
  const setup = fixture(context);
  let changed = false;
  let polls = 0;
  const server = await board(context, url => {
    if (url === '/api/whoami') return { principal: 'fixture' };
    if (url.startsWith('/api/comments'))
      return { comments: changed ? [{ id: 'message', by: 'owner', text: 'fixture words' }] : [] };
    polls++;
    return { seq: changed ? 2 : 1, changes: changed ? [{ board: 'fixture', kind: 'comment', id: 'message' }] : [] };
  });
  setup.copy('boardwatch.cjs');
  const cursor = path.join(setup.home, 'boardwatch-fixture.json');
  fs.writeFileSync(cursor, JSON.stringify({ seq: 1, said: [] }));
  fs.writeFileSync(path.join(setup.home, 'LH-TOKEN.txt'), 'fixture');
  const launch = () => setup.start('boardwatch.cjs', ['--server', server, '--board', 'fixture', '--interval', '0.03']);
  const watcher = launch();
  await until(() => polls > 0, 'boardwatch starts polling');
  watcher.child.stdout.destroy();
  changed = true;
  await until(() => watcher.child.exitCode !== null, 'closed boardwatch exits');
  assert.equal(watcher.child.exitCode, 1);
  assert.deepEqual(JSON.parse(read(cursor)), { seq: 1, said: [] });
  assert.match(read(path.join(setup.home, 'watch-output-boardwatch.txt')), /fixture words/);
  const rearmed = launch();
  await until(() => rearmed.output().includes('fixture words'), 'undelivered boardwatch output is replayed');
  await until(() => JSON.parse(read(cursor)).seq === 2, 'cursor commits after successful output');
  assert.ok(JSON.parse(read(cursor)).said.includes('m:message'));
});

test('gate closed output preserves its unseen shape, input and digest for the next re-arm', async context => {
  const setup = fixture(context);
  setup.copy('gate.cjs');
  const line = 'FM INFO | fixture state changed [key fixture:one]';
  fs.writeFileSync(
    path.join(setup.home, 'digest.txt'),
    JSON.stringify({ t: Date.now(), line: 'held fixture', ruleDigest: true }) + '\n',
  );
  const launch = () => setup.start('gate.cjs', ['--home', setup.home, '--mode', 'rules', '--tick-ms', '20']);
  const watcher = launch();
  await until(() => read(path.join(setup.home, 'gate-heartbeat.json')), 'gate is registered');
  watcher.child.stdout.destroy();
  watcher.child.stdin.write(line + '\n');
  await until(() => watcher.child.exitCode !== null, 'closed gate exits');
  assert.equal(watcher.child.exitCode, 1);
  assert.equal(read(path.join(setup.home, 'gate-shapes.json')), '');
  assert.match(read(path.join(setup.home, 'digest.txt')), /held fixture/);
  const inputFile = fs.readdirSync(setup.home).find(name => name.startsWith('gate-input-'));
  assert.deepEqual(JSON.parse(read(path.join(setup.home, inputFile))), [line]);
  const rearmed = launch();
  await until(() => rearmed.output().includes(line) && rearmed.output().includes('held fixture'), 'gate replays');
  await until(() => read(path.join(setup.home, 'digest.txt')) === '', 'digest clears only after output');
  await until(() => read(path.join(setup.home, inputFile)) === '[]', 'accepted input is acknowledged');
});

test('fmwatch exits on EPIPE and replays the failed event despite its startup baseline', async context => {
  const setup = fixture(context);
  const conversation = path.join(setup.home, '.claude/projects/fixture');
  fs.mkdirSync(conversation, { recursive: true });
  fs.mkdirSync(path.join(setup.home, 'fm/state'), { recursive: true });
  const transcript = path.join(conversation, 'rollout-fixture.jsonl');
  fs.writeFileSync(transcript, '');
  setup.copy('fmwatch.cjs', text =>
    text
      .replace("'//wsl.localhost/__WSL_DISTRO__/home/__WSL_USER__'", JSON.stringify(setup.home))
      .replace('__FM_CONV_DIR__', 'fixture')
      .replace('__FM_HOME_REL__', '/fm')
      .replace(/POLL_MS = \d+/, 'POLL_MS = 40'),
  );
  const launch = () => setup.start('fmwatch.cjs', []);
  const watcher = launch();
  await until(() => read(path.join(setup.home, 'fmwatch.cjs.pid')), 'watcher starts');
  await pause(150);
  watcher.child.stdout.destroy();
  const timestamp = new Date().toISOString();
  const record = { timestamp, uuid: 'fixture-input', type: 'user', message: { content: 'failed fixture input' } };
  fs.appendFileSync(transcript, JSON.stringify(record) + '\n');
  await until(() => watcher.child.exitCode !== null, 'watcher exits after failed write');
  assert.equal(watcher.child.exitCode, 1, watcher.errors());
  const pending = path.join(setup.home, 'watch-output-fmwatch.txt');
  assert.match(read(pending), /failed fixture input/);
  const rearmed = launch();
  await until(() => rearmed.output().includes('failed fixture input'), 'failed event survives the silent baseline');
  assert.equal(read(pending), '');
});

test('conductwatch saves changed signals only after output succeeds', async context => {
  const setup = fixture(context);
  let changed = false;
  const server = await board(context, () => ({ signals: { untagged: changed ? 1 : 0 } }));
  setup.copy('conductwatch.cjs');
  const state = path.join(setup.home, 'conductwatch-state.json');
  const launch = () =>
    setup.start('conductwatch.cjs', ['--server', server, '--boards', 'fixture', '--interval', '0.03']);
  const watcher = launch();
  await until(() => read(state), 'conduct state is baselined');
  watcher.child.stdout.destroy();
  changed = true;
  await until(() => watcher.child.exitCode !== null, 'conduct exits after failed write');
  assert.equal(watcher.child.exitCode, 1);
  assert.equal(JSON.parse(read(state)).fixture.untagged, 0);
  const rearmed = launch();
  await until(() => rearmed.output().includes('untagged: 1'), 'conduct signal is recovered');
  await until(() => JSON.parse(read(state)).fixture.untagged === 1, 'conduct commits after delivery');
});

test('sweep failed output preserves its state and every captured record through an MSYS re-arm', async context => {
  const setup = fixture(context);
  setup.copy('lighthouse-sweep.sh', text => text.replace(/\r/g, ''));
  const hook = path.join(setup.home, 'hook.sh');
  fs.writeFileSync(
    hook,
    [
      'if ! command -v python >/dev/null 2>&1; then python() { command python3 "$@"; }; fi',
      'timeout() {',
      '  case "$1" in',
      '    60) while [ ! -f "$SWEEP_GO" ]; do sleep 0.01; done; printf "fleet=unreachable\\n" ;;',
      '    90) printf "RECORD CHECK | fixture-one\\nRECORD CHECK | fixture-two\\n" ;;',
      '  esac',
      '}',
    ].join('\n') + '\n',
  );
  const state = path.join(setup.home, 'lh-state.txt');
  const previous = 'probe=ok\nswept_at=1\n';
  fs.writeFileSync(state, previous);
  const go = path.join(setup.home, 'go');
  const launch = () =>
    setup.start('lighthouse-sweep.sh', [], {
      command: bash,
      env: {
        ...environment,
        BASH_ENV: hook.replace(/\\/g, '/'),
        SWEEP_INTERVAL: '0.1',
        SWEEP_GO: go.replace(/\\/g, '/'),
      },
    });
  const watcher = launch();
  await until(() => read(path.join(setup.home, 'lh.pid')), 'sweep starts');
  watcher.child.stdout.destroy();
  fs.writeFileSync(go, 'go');
  await until(() => watcher.child.exitCode !== null, 'closed sweep exits');
  assert.notEqual(watcher.child.exitCode, 0);
  assert.equal(read(state), previous);
  assert.match(read(path.join(setup.home, 'record-check-pending.txt')), /fixture-one[\s\S]*fixture-two/);
  const rearmed = launch();
  await until(
    () => rearmed.output().includes('fixture-one') && rearmed.output().includes('fixture-two'),
    'the entire captured record batch survives',
  );
  await until(() => read(state).includes('probe=unreachable'), 'sweep state commits after successful output');
});

test('checked output handles partial UTF-8 writes and live-reader backpressure without losing bytes', async context => {
  const setup = fixture(context);
  const text = '\u00e9'.repeat(20000);
  const hook = path.join(setup.home, 'partial.cjs');
  fs.writeFileSync(
    hook,
    'const fs = require("node:fs"); const original = fs.writeSync;\n' +
      'fs.writeSync = (fd, bytes, offset, length) =>\n' +
      '  original(fd, bytes, offset, fd === 1 ? Math.min(17, length) : length);\n',
  );
  fs.writeFileSync(
    path.join(setup.home, 'emit.cjs'),
    'const output = require("./watch-output.cjs")(__dirname, "fixture"); output(' + JSON.stringify(text) + ');\n',
  );
  const watcher = setup.start('emit.cjs', [], {
    env: { ...environment, NODE_OPTIONS: '--require "' + hook.replace(/\\/g, '/') + '"' },
  });
  watcher.child.stdout.pause();
  await pause(150);
  watcher.child.stdout.resume();
  await until(() => watcher.child.exitCode !== null, 'checked writer completes');
  assert.equal(watcher.child.exitCode, 0, watcher.errors());
  assert.equal(watcher.output(), text + '\n');
  assert.equal(read(path.join(setup.home, 'watch-output-fixture.txt')), '');
});

test('gate re-arm recovers input accepted before an interrupted asynchronous judgment', async context => {
  const setup = fixture(context);
  setup.copy('gate.cjs');
  let requests = 0;
  const server = http.createServer((request, response) => {
    request.resume();
    request.on('end', () => {
      requests++;
      if (requests === 1) return;
      response.setHeader('Content-Type', 'application/json');
      response.end(
        JSON.stringify({
          model: 'fixture',
          answers: {
            attention: { type: 'noul', noul: 1 },
            repeat: { type: 'noul', noul: 0 },
            kind: { type: 'choice', choice: 'needs_attention_now', confidence: 0.99 },
          },
        }),
      );
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  context.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const launch = () =>
    setup.start(
      'gate.cjs',
      ['--home', setup.home, '--mode', 'hold', '--tick-ms', '20', '--server', 'http://127.0.0.1:1'],
      {
        env: {
          ...environment,
          TYPESAFE_API_KEY: 'fixture-only',
          GATE_JEV_URL: 'http://127.0.0.1:' + server.address().port,
        },
      },
    );
  const watcher = launch();
  watcher.child.stdin.write('FM INFO | fixture queued [key input:one]\n');
  await until(() => watcher.output().includes('input:one'), 'first shape is delivered');
  const line = 'FM INFO | fixture queued [key input:two]';
  watcher.child.stdin.write(line + '\n');
  await until(() => requests === 1, 'the second event is awaiting judgment');
  watcher.child.kill('SIGKILL');
  await until(() => watcher.child.signalCode !== null || watcher.child.exitCode !== null, 'old gate exits');
  const pending = fs.readdirSync(setup.home).find(name => name.startsWith('gate-input-'));
  assert.deepEqual(JSON.parse(read(path.join(setup.home, pending))), [line]);
  const rearmed = launch();
  await until(() => rearmed.output().includes(line), 'in-flight input is replayed by the replacement');
  await until(() => read(path.join(setup.home, pending)) === '[]', 'replayed input is acknowledged');
});
