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
const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function until(predicate, label) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await pause(20);
  }
  assert.fail(label);
}

function start(command, args, options = {}) {
  const child = spawn(command, args, { env, stdio: 'pipe', ...options });
  let output = '';
  child.stdout.on('data', bytes => (output += bytes));
  child.stderr.on('data', bytes => (output += bytes));
  return { child, output: () => output };
}

function read(file) {
  try {
    return fs.readFileSync(file, 'utf8').trim();
  } catch {
    return '';
  }
}

function alive(pid) {
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch {
    return false;
  }
}

for (const name of ['fmwatch.cjs', 'boardwatch.cjs', 'conductwatch.cjs']) {
  test(name + ' takes over its PID file and logs replacement without printing it', async context => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'watcher-rearm-'));
    const previous = start(process.execPath, ['-e', 'setInterval(() => {}, 1000)']);
    const pidFile = path.join(home, name + '.pid');
    fs.writeFileSync(pidFile, String(previous.child.pid));
    const script = fs
      .readFileSync(path.join(scripts, name), 'utf8')
      .replace("'//wsl.localhost/__WSL_DISTRO__/home/__WSL_USER__'", JSON.stringify(home))
      .replace("'C:/Users/__WINDOWS_USER__/.codex/sessions'", JSON.stringify(home));
    fs.writeFileSync(path.join(home, name), script);
    fs.copyFileSync(path.join(scripts, 'watch-output.cjs'), path.join(home, 'watch-output.cjs'));
    fs.copyFileSync(path.join(scripts, 'watch-lease.cjs'), path.join(home, 'watch-lease.cjs'));
    const watcher = start(process.execPath, [
      path.join(home, name),
      '--server',
      'http://127.0.0.1:1',
      '--board',
      'fixture',
      '--boards',
      'fixture',
    ]);
    context.after(async () => {
      previous.child.kill();
      watcher.child.kill();
      await until(() => watcher.child.exitCode !== null || watcher.child.signalCode !== null, 'watcher exits');
      fs.rmSync(home, { recursive: true, force: true });
    });
    await until(() => read(path.join(home, 'watcher-starts.jsonl')), 'replacement is logged');
    await until(() => !alive(previous.child.pid), 'the leftover watcher exits');
    assert.equal(Number(read(pidFile)), watcher.child.pid);
    assert.match(JSON.parse(read(path.join(home, 'watcher-starts.jsonl'))).line, /replaced a leftover copy/);
    assert.doesNotMatch(watcher.output(), /replaced a leftover copy/);
  });
}

test('route re-arm leaves one board reader, one delivery and the shared cursor with its replacement', async context => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'route-rearm-'));
  const changes = [];
  const messages = [];
  const server = http.createServer((request, response) => {
    response.setHeader('Content-Type', 'application/json');
    const url = new URL(request.url, 'http://127.0.0.1');
    const body =
      url.pathname === '/api/whoami'
        ? { principal: 'fixture' }
        : url.pathname === '/api/changes'
          ? {
              seq: changes.length + 1,
              changes: changes.filter(change => change.seq > Number(url.searchParams.get('since'))),
            }
          : { comments: messages };
    response.end(JSON.stringify(body));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const route = fs
    .readFileSync(path.join(scripts, 'route.sh'), 'utf8')
    .replace(/\r/g, '')
    .replace('__BOARD_SERVER__', 'http://127.0.0.1:' + server.address().port)
    .replace('__BOARD_ID__', 'fixture --interval 0.05');
  fs.writeFileSync(path.join(home, 'route.sh'), route);
  fs.copyFileSync(path.join(scripts, 'boardwatch.cjs'), path.join(home, 'boardwatch.cjs'));
  fs.copyFileSync(path.join(scripts, 'watch-output.cjs'), path.join(home, 'watch-output.cjs'));
  fs.copyFileSync(path.join(scripts, 'watch-lease.cjs'), path.join(home, 'watch-lease.cjs'));
  fs.writeFileSync(path.join(home, 'LH-TOKEN.txt'), 'fixture');
  const preload = path.join(home, 'slow-stop.cjs');
  fs.writeFileSync(
    preload,
    'const on = process.on.bind(process);\n' +
      'process.on = (event, handler) => on(event, event === "SIGTERM" ? () => setTimeout(handler, 150) : handler);\n',
  );
  const pidFile = path.join(home, 'boardwatch.cjs.pid');
  const cursor = path.join(home, 'boardwatch-fixture.json');
  const watchers = [];
  context.after(async () => {
    const pid = read(pidFile);
    if (pid && alive(pid)) process.kill(Number(pid));
    await until(
      () => watchers.every(watcher => watcher.child.exitCode !== null || watcher.child.signalCode !== null),
      'route wrappers exit',
    );
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(home, { recursive: true, force: true });
  });
  for (let attempt = 0; attempt < 3; attempt++) {
    const previous = read(pidFile);
    watchers.push(
      start(bash, [path.join(home, 'route.sh')], {
        env: {
          ...env,
          NODE_OPTIONS: '--require "' + preload.replace(/\\/g, '/') + '"',
        },
      }),
    );
    await until(() => read(pidFile) && read(pidFile) !== previous && read(cursor), 'route owns its cursor');
    if (previous) assert.equal(alive(previous), false, 'old route must exit before its replacement claims the cursor');
  }
  messages.push({ id: 'message', by: 'owner', text: 'fixture delivery' });
  changes.push({ seq: 2, board: 'fixture', kind: 'comment', id: 'message' });
  await until(() => watchers.at(-1).output().includes('fixture delivery'), 'replacement delivers input');
  await pause(300);
  const output = watchers.map(watcher => watcher.output()).join('\n');
  assert.equal(output.match(/fixture delivery/g).length, 1);
  assert.equal(output.trim(), 'the captain (general): fixture delivery', 're-arm adds no operator wake');
  assert.doesNotMatch(output, /replaced a leftover copy/);
  assert.equal(JSON.parse(read(cursor)).seq, 2);
  assert.equal(read(path.join(home, 'watcher-starts.jsonl')).split('\n').length, 2);
});

test('sweep re-arm stops the old loop silently and cleanup only removes its own PID file', async context => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sweep-rearm-'));
  const script = path.join(home, 'lighthouse-sweep.sh');
  fs.writeFileSync(script, fs.readFileSync(path.join(scripts, 'lighthouse-sweep.sh'), 'utf8').replace(/\r/g, ''));
  const hook = path.join(home, 'hooks.sh');
  fs.writeFileSync(
    hook,
    [
      'if ! command -v python >/dev/null 2>&1; then python() { command python3 "$@"; }; fi',
      'timeout() {',
      '  [ "$1" = 60 ] || return 0',
      '  printf "%s\\n" "$$" >> "$SWEEP_TICKS"',
      '  printf "fleet=unreachable\\n"',
      '}',
    ].join('\n') + '\n',
  );
  const pidFile = path.join(home, 'lh.pid');
  const stateFile = path.join(home, 'lh-state.txt');
  const ticks = path.join(home, 'ticks');
  const watchers = [];
  const predecessors = [];
  const signal = pid => spawnSync(bash, ['-c', 'kill -TERM "$1"', 'stop-fixture', pid], { env });
  const launch = () => {
    const watcher = start(bash, [script], {
      env: {
        ...env,
        BASH_ENV: hook.replace(/\\/g, '/'),
        SWEEP_INTERVAL: '0.2',
        SWEEP_TICKS: ticks.replace(/\\/g, '/'),
      },
    });
    watchers.push(watcher);
    return watcher;
  };
  context.after(async () => {
    const pid = read(pidFile);
    if (/^\d+$/.test(pid)) signal(pid);
    for (const watcher of watchers) {
      if (watcher.child.exitCode === null && watcher.child.signalCode === null) watcher.child.kill();
    }
    await until(
      () => watchers.every(watcher => watcher.child.exitCode !== null || watcher.child.signalCode !== null),
      'sweep wrappers exit',
    );
    fs.rmSync(home, { recursive: true, force: true });
  });
  for (let attempt = 0; attempt < 3; attempt++) {
    const previous = read(pidFile);
    const old = watchers.at(-1);
    launch();
    await until(
      () => read(pidFile) && read(pidFile) !== previous && read(stateFile).includes('swept_at='),
      'the sweep replacement runs',
    );
    if (old) {
      await until(() => old.child.exitCode !== null || old.child.signalCode !== null, 'old sweep exits');
      predecessors.push(previous);
    }
  }
  const owner = read(pidFile);
  const before = read(ticks).split('\n').length;
  await until(() => read(ticks).split('\n').length >= before + 2, 'replacement keeps sweeping');
  assert.ok(
    read(ticks)
      .split('\n')
      .slice(before)
      .every(pid => pid === owner),
    'only replacement probes',
  );
  assert.doesNotMatch(watchers.map(watcher => watcher.output()).join('\n'), /replaced the previous sweep/);
  assert.ok(
    watchers.slice(1).every(watcher => watcher.output() === ''),
    'sweep re-arm adds no operator wake',
  );
  assert.equal(read(path.join(home, 'watcher-starts.jsonl')).split('\n').length, 2);
  const marker = path.join(home, 'usage-pickup.json');
  const warning = 'COLLECTOR | write your pickup note: context has passed 85% of the compaction window';
  fs.writeFileSync(marker, JSON.stringify({ sequence: 1, prompt: 900, window: 1000 }));
  await until(() => watchers.at(-1).output().includes(warning), 'the Monitor-facing sweep carries the warning');
  const warnedAt = read(ticks).split('\n').length;
  await until(() => read(ticks).split('\n').length >= warnedAt + 2, 'the warned sweep keeps probing');
  assert.equal(watchers.at(-1).output().split(warning).length - 1, 1, 'one warning per marker');
  const predecessor = predecessors[0];
  assert.equal(
    spawnSync(bash, ['-c', '! kill -0 "$1" 2>/dev/null', 'check-fixture', predecessor], { env }).status,
    0,
    "the successor sentinel is one of this test's exited sweeps, not an arbitrary process",
  );
  fs.writeFileSync(pidFile, predecessor);
  signal(owner);
  await until(() => watchers.at(-1).child.exitCode !== null, 'current sweep stops');
  assert.equal(read(pidFile), predecessor, 'an exiting sweep cannot unlink its successor lock');
  launch();
  await until(() => read(pidFile) && read(pidFile) !== predecessor, 'stale PID is replaced');
  const rearmedAt = read(ticks).split('\n').length;
  await until(() => read(ticks).split('\n').length >= rearmedAt + 2, 'rearmed sweep reads the persisted marker');
  assert.equal(watchers.at(-1).output(), '', 're-arm does not repeat the pickup warning');
  fs.writeFileSync(marker, JSON.stringify({ sequence: 2, prompt: 900, window: 1000 }));
  await until(() => watchers.at(-1).output().includes(warning), 'a compaction rearms the Monitor-facing warning');
  signal(read(pidFile));
  await until(() => !fs.existsSync(pidFile), 'normal stop cleans its owned PID file');
});
