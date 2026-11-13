'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { bash, env } = require('../../verification/update/bootstrap-replay.cjs');
const scripts = path.join(__dirname, '../scripts');
const clean = { ...env };
delete clean.TYPESAFE_API_KEY;
delete clean.LH_MONITOR_LEASE;
delete clean.LH_MONITOR_LEASE_TOKEN;
const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const read = file => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '');
const leaseStopped = output => assert.match(output, /^WATCH LEASE \| [^\r\n]+\n$/);
const alive = identity => {
  try {
    process.kill(identity, 0);
    return true;
  } catch {
    return false;
  }
};
async function until(predicate, label) {
  const end = Date.now() + 18000;
  while (Date.now() < end) {
    if (predicate()) return;
    await pause(30);
  }
  assert.fail(label);
}
function setup(context) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'monitor-lease-'));
  const children = [];
  for (const name of ['monitor.cjs', 'watch-lease.cjs', 'watch-output.cjs', 'gate-policy.cjs', 'gate-rules.json'])
    fs.copyFileSync(path.join(scripts, name), path.join(home, name));
  const copy = (name, transform = text => text) =>
    fs.writeFileSync(path.join(home, name), transform(fs.readFileSync(path.join(scripts, name), 'utf8')));
  const start = (command, args, environment = clean) => {
    const child = spawn(command, args, { env: environment, stdio: 'pipe', windowsHide: true });
    children.push(child);
    let output = '',
      errors = '';
    child.stdout.setEncoding('utf8').on('data', text => (output += text));
    child.stderr.setEncoding('utf8').on('data', text => (errors += text));
    return { child, output: () => output, errors: () => errors };
  };
  context.after(async () => {
    for (const name of fs.readdirSync(home)) {
      let identity;
      if (name.endsWith('.pid')) identity = Number(read(path.join(home, name)));
      else if (/^monitor-.*\.json$/.test(name)) identity = JSON.parse(read(path.join(home, name))).pid;
      if (identity > 1 && identity !== process.pid) {
        try {
          process.kill(identity);
        } catch {}
      }
    }
    for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill();
    await pause(200);
    fs.rmSync(home, { recursive: true, force: true });
  });
  return { home, copy, start };
}
function lease(home, valid = true) {
  const file = path.join(home, 'fixture-lease.json');
  fs.writeFileSync(
    file,
    JSON.stringify({ token: 'fixture', parents: [process.pid], expires: valid ? Date.now() + 60000 : 0 }),
  );
  return { ...clean, LH_MONITOR_LEASE: file, LH_MONITOR_LEASE_TOKEN: 'fixture', SW_THREAD: 'fixture' };
}

test('leased cursor publication recovers transient sharing failures without hiding permanent failures', context => {
  const fixture = setup(context);
  const cursor = path.join(fixture.home, 'watch-cursor-fmwatch.json');
  const previous = JSON.stringify({ savedAt: 1, offsets: [] });
  const source = fs.readFileSync(path.join(scripts, 'watch-lease.cjs'), 'utf8').replace(/\r/g, '');
  const body = source.split('function save(home, source, value) {')[1].split('\n}\nmodule.exports')[0];
  const save = new Function(
    'generation',
    'fs',
    'path',
    'active',
    'check',
    'Date',
    'performance',
    'home',
    'source',
    'value',
    body,
  ).bind(null, false);
  const value = { offsets: [['fixture', 42]] };
  for (const code of ['EPERM', 'EACCES', 'EBUSY']) {
    fs.writeFileSync(cursor, previous);
    let attempts = 0,
      checks = 0;
    const observed = {
      ...fs,
      renameSync(from, to) {
        assert.equal(read(cursor), previous, 'readers retain the complete old cursor until publication');
        assert.equal(checks, attempts + 2, 'each attempt freshly checks the lease');
        if (++attempts === 1) throw Object.assign(new Error('fixture sharing violation'), { code });
        fs.renameSync(from, to);
      },
    };
    const check = fresh => {
      assert.equal(fresh, true);
      checks++;
    };
    save(observed, path, true, check, Date, performance, fixture.home, 'fmwatch', value);
    assert.equal(attempts, 2);
    assert.deepEqual(JSON.parse(read(cursor)).offsets, value.offsets);
    assert.ok(JSON.parse(read(cursor)).savedAt > 1);
    assert.equal(fs.existsSync(cursor + '.tmp'), false);
  }
  for (const code of ['EPERM', 'EACCES', 'EBUSY', 'EIO']) {
    fs.writeFileSync(cursor, previous);
    let attempts = 0,
      time = 0;
    const failure = Object.assign(new Error('fixture persistent failure'), { code });
    const failing = {
      ...fs,
      renameSync() {
        attempts++;
        throw failure;
      },
    };
    assert.throws(
      () => save(failing, path, true, () => {}, Date, { now: () => (time += 300) }, fixture.home, 'fmwatch', value),
      error => error === failure,
    );
    assert.equal(attempts, code === 'EIO' ? 1 : 2, 'permanent failures are bounded and surfaced');
    assert.equal(read(cursor), previous);
    assert.equal(fs.existsSync(cursor + '.tmp'), false);
  }
  let attempts = 0;
  const revoked = new Error('fixture lease revoked');
  const check = () => {
    if (attempts) throw revoked;
  };
  const expiring = {
    ...fs,
    renameSync() {
      attempts++;
      throw Object.assign(new Error('fixture sharing violation'), { code: 'EPERM' });
    },
  };
  assert.throws(
    () => save(expiring, path, true, check, Date, performance, fixture.home, 'fmwatch', value),
    error => error === revoked,
  );
  assert.equal(attempts, 1, 'a revoked lease cannot publish on a later attempt');
  assert.equal(read(cursor), previous);
});

test('the launcher retries a Windows lease rename without expiring a live watch', async context => {
  const fixture = setup(context);
  const preload = path.join(fixture.home, 'rename-busy.cjs');
  fs.writeFileSync(
    preload,
    [
      "const fs = require('node:fs'); const original = fs.renameSync; let busy = false;",
      'fs.renameSync = (from, to) => {',
      '  if (/monitor-.*[.]json$/.test(to) && !busy) {',
      "    busy = true; throw Object.assign(new Error('fixture sharing violation'), { code: 'EPERM' });",
      '  }',
      '  busy = false; return original(from, to);',
      '};',
    ].join('\n'),
  );
  const watcher = fixture.start(
    process.execPath,
    [
      path.join(fixture.home, 'monitor.cjs'),
      '--source',
      'busy',
      '--',
      process.execPath,
      '-e',
      'setTimeout(() => process.stdout.write("live watch\\n"), 1900)',
    ],
    { ...clean, NODE_OPTIONS: '--require ' + JSON.stringify(preload) },
  );
  await until(() => watcher.output().includes('live watch'), 'live watch survives transient sharing violations');
  await until(() => watcher.child.exitCode !== null, 'foreground launcher finishes with its child');
  assert.equal(watcher.child.exitCode, 0, watcher.errors());
});

test('the launcher survives one exhausted publish while its last lease is live', async context => {
  const fixture = setup(context);
  const preload = path.join(fixture.home, 'rename-blocked.cjs');
  fs.writeFileSync(
    preload,
    [
      "const fs = require('node:fs'); const original = fs.renameSync; let calls = 0, blockedAt = 0;",
      'fs.renameSync = (from, to) => {',
      '  if (/monitor-.*[.]json$/.test(to) && ++calls > 1) {',
      '    blockedAt ||= Date.now();',
      '    if (Date.now() - blockedAt < 700)',
      "      throw Object.assign(new Error('fixture busy readers'), { code: 'EPERM' });",
      '  }',
      '  return original(from, to);',
      '};',
    ].join('\n'),
  );
  const watcher = fixture.start(
    process.execPath,
    [
      path.join(fixture.home, 'monitor.cjs'),
      '--source',
      'blocked',
      '--',
      process.execPath,
      '-e',
      'setTimeout(() => process.stdout.write("publish recovered\\n"), 2400)',
    ],
    { ...clean, NODE_OPTIONS: '--require ' + JSON.stringify(preload) },
  );
  await until(() => watcher.child.exitCode !== null, 'foreground launcher finishes');
  assert.equal(watcher.child.exitCode, 0, watcher.errors());
  assert.match(watcher.output(), /publish recovered/);
  assert.deepEqual(
    fs.readdirSync(fixture.home).filter(name => name.endsWith('.tmp')),
    [],
  );
});

test('concurrent lease readers cannot starve the foreground launcher', async context => {
  const fixture = setup(context);
  const reader = path.join(fixture.home, 'reader.cjs');
  fs.writeFileSync(
    reader,
    [
      "const lease = require('./watch-lease.cjs'); const until = Date.now() + 4000;",
      'while (Date.now() < until) lease.check();',
      'process.stdout.write("reader complete\\n");',
    ].join('\n'),
  );
  const command = path.join(fixture.home, 'readers.cjs');
  fs.writeFileSync(
    command,
    [
      "const { spawn } = require('node:child_process'); let finished = 0;",
      'for (let index = 0; index < 2; index++) {',
      '  const reader = spawn(process.execPath, [require("node:path").join(__dirname, "reader.cjs")],',
      '    { stdio: "inherit", windowsHide: true });',
      '  reader.on("exit", code => { if (code !== 0) process.exit(1);',
      '    if (++finished === 2) process.stdout.write("readers complete\\n"); });',
      '}',
    ].join('\n'),
  );
  const watcher = fixture.start(process.execPath, [
    path.join(fixture.home, 'monitor.cjs'),
    '--source',
    'readers',
    '--',
    process.execPath,
    command,
  ]);
  await until(() => watcher.child.exitCode !== null, 'readers and foreground launcher finish');
  assert.equal(watcher.child.exitCode, 0, watcher.errors());
  assert.match(watcher.output(), /readers complete/);
  assert.deepEqual(
    fs.readdirSync(fixture.home).filter(name => name.endsWith('.tmp')),
    [],
  );
});

test('cached liveness cannot authorize output or a cursor commit after revocation', async context => {
  for (const operation of ['output', 'cursor']) {
    const fixture = setup(context);
    const program = [
      "const fs = require('node:fs'); const home = process.argv[1];",
      "const lease = require(home + '/watch-lease.cjs'); lease.check();",
      "fs.writeFileSync(process.env.LH_MONITOR_LEASE, '{}');",
      operation === 'output'
        ? "require(home + '/watch-output.cjs')(home, 'cached')('must replay');"
        : "lease.save(home, 'cached', { consumed: true });",
      'process.stdout.write("stale authorization\\n");',
    ].join('\n');
    const watcher = fixture.start(process.execPath, ['-e', program, fixture.home], lease(fixture.home));
    await until(() => watcher.child.exitCode !== null, 'revoked watcher exits synchronously');
    leaseStopped(watcher.output());
    assert.equal(read(path.join(fixture.home, 'watch-cursor-cached.json')), '');
    if (operation === 'output') assert.equal(read(path.join(fixture.home, 'watch-output-cached.txt')), 'must replay\n');
  }
});

test('sweep journals record output before its producer returns and replays after lease expiry', async context => {
  const fixture = setup(context);
  fixture.copy('lighthouse-sweep.sh', text => text.replace(/\r/g, ''));
  const hook = path.join(fixture.home, 'capture-hook.sh');
  fs.writeFileSync(
    hook,
    [
      'if ! command -v python >/dev/null 2>&1; then python() { command python3 "$@"; }; fi',
      'timeout() {',
      '  case "$1" in',
      '    60) printf "fleet=unreachable\\n" ;;',
      '    90) printf "RECORD CHECK | captured-before-return\\n";',
      '        while [ ! -f "$RECORD_GO" ]; do sleep 0.01; done ;;',
      '  esac',
      '}',
    ].join('\n') + '\n',
  );
  const state = path.join(fixture.home, 'lh-state.txt');
  const previous = 'probe=ok\nswept_at=1\n';
  fs.writeFileSync(state, previous);
  const go = path.join(fixture.home, 'record-go');
  const launch = () =>
    fixture.start(bash, [path.join(fixture.home, 'lighthouse-sweep.sh')], {
      ...lease(fixture.home),
      BASH_ENV: hook.replace(/\\/g, '/'),
      RECORD_GO: go.replace(/\\/g, '/'),
      SWEEP_INTERVAL: '0.1',
    });
  const first = launch();
  await until(
    () => read(path.join(fixture.home, 'record-check-pending.txt')).includes('captured-before-return'),
    'producer output is already journaled while the producer is running',
  );
  lease(fixture.home, false);
  fs.writeFileSync(go, 'go');
  await until(() => first.child.exitCode !== null, 'expired sweep exits before emitting or committing');
  leaseStopped(first.output());
  assert.equal(read(state), previous);
  const next = launch();
  await until(() => next.output().includes('captured-before-return'), 'next Monitor receives the captured record');
});

test(
  'Monitor shell expiry reproduces the legacy swallowed route and the launcher preserves it for re-arm',
  { timeout: 60000 },
  async context => {
    for (const leased of process.platform === 'win32' ? [false, 'launcher', 'parent'] : ['launcher', 'parent']) {
      const fixture = setup(context);
      let changed = false;
      let polls = 0;
      let releaseInbox;
      const inboxReleased = new Promise(resolve => (releaseInbox = resolve));
      const server = http.createServer(async (request, response) => {
        const url = request.url;
        if (!leased && url.startsWith('/api/comments') && polls === 3) await inboxReleased;
        response.setHeader('Content-Type', 'application/json');
        let body;
        if (url === '/api/whoami') body = { principal: 'fixture' };
        else if (url.startsWith('/api/comments'))
          body = { comments: changed ? [{ id: 'message', by: 'owner', text: 'gap message' }] : [] };
        else {
          polls++;
          body = {
            seq: changed ? 2 : 1,
            changes: changed ? [{ board: 'fixture', kind: 'comment', id: 'message' }] : [],
          };
        }
        response.end(JSON.stringify(body));
      });
      await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
      context.after(() => server.close());
      const url = 'http://127.0.0.1:' + server.address().port;
      fixture.copy('boardwatch.cjs', text =>
        leased
          ? text
          : text.replace(
              "const output = require('./watch-output.cjs')(__dirname, 'boardwatch');",
              "const output = line => process.stdout.write(line + '\\n'); output.replay = () => {};",
            ),
      );
      fixture.copy('route.sh', text =>
        text.replace('__BOARD_SERVER__', url).replace('__BOARD_ID__', 'fixture --interval 0.05').replace(/\r/g, ''),
      );
      fs.writeFileSync(path.join(fixture.home, 'LH-TOKEN.txt'), 'fixture');
      const cursor = path.join(fixture.home, 'boardwatch-fixture.json');
      fs.writeFileSync(cursor, JSON.stringify({ seq: 1, said: [] }));
      const command = leased
        ? 'node "$1/monitor.cjs" --source route -- bash "$1/route.sh"; exit $?'
        : 'bash "$1/route.sh"; exit $?';
      const launch = () =>
        fixture.start(
          bash,
          leased
            ? ['-c', command, 'monitor-fixture', fixture.home.replace(/\\/g, '/')]
            : [path.join(fixture.home, 'route.sh')],
        );
      const first = launch();
      await until(() => polls > 2, 'foreground command keeps polling: ' + first.errors());
      const owner = Number(read(path.join(fixture.home, 'boardwatch.cjs.pid')));
      assert.ok(alive(owner));
      if (leased) {
        await pause(1800);
        assert.ok(alive(owner), 'live Monitor ancestry must not expire: ' + leased + ': ' + first.errors());
      }
      first.child.stdout.destroy();
      if (leased === 'parent') {
        first.child.kill();
        await until(() => first.child.exitCode !== null || first.child.signalCode !== null, 'Monitor shell exits');
      } else if (leased === 'launcher') {
        const marker = fs.readdirSync(fixture.home).find(name => /^monitor-.*\.json$/.test(name));
        process.kill(JSON.parse(read(path.join(fixture.home, marker))).pid);
      }
      changed = true;
      releaseInbox();
      if (!leased && process.platform === 'win32') {
        await until(
          () => JSON.parse(read(cursor)).said.includes('m:message'),
          'pre-fix async route acknowledges unread output',
        );
        assert.deepEqual(JSON.parse(read(cursor)), { seq: 1, said: ['m:message'] });
        assert.equal(first.output(), '', 'nothing was emitted before the reader closed');
        try {
          process.kill(owner);
        } catch {}
        first.child.kill();
        continue;
      }
      await until(() => !alive(owner), 'orphaned route exits instead of acknowledging the gap');
      assert.deepEqual(JSON.parse(read(cursor)), { seq: 1, said: [] });
      const next = launch();
      await until(() => next.output().includes('gap message'), 're-arm delivers the gap: ' + next.errors());
      await until(() => JSON.parse(read(cursor)).seq === 2, 'delivery then advances the cursor');
    }
  },
);

for (const old of [false, true])
  test('documented fmwatch launch' + (old ? ' baselines an old cursor' : ' replays four replies'), async context => {
    const fixture = setup(context);
    const conversation = path.join(fixture.home, '.claude/projects/fixture');
    fs.mkdirSync(conversation, { recursive: true });
    fs.mkdirSync(path.join(fixture.home, 'fm/state'), { recursive: true });
    const transcript = path.join(conversation, 'rollout-fixture.jsonl');
    fs.writeFileSync(transcript, '');
    fixture.copy('fmwatch.cjs', text =>
      text
        .replace("'//wsl.localhost/__WSL_DISTRO__/home/__WSL_USER__'", JSON.stringify(fixture.home))
        .replace('__FM_CONV_DIR__', 'fixture')
        .replace('__FM_HOME_REL__', '/fm')
        .replace(/POLL_MS = \d+/, 'POLL_MS = 40'),
    );
    const documented = fs
      .readFileSync(path.join(__dirname, '../SETUP.md'), 'utf8')
      .match(/^node monitor[.]cjs --source fmwatch -- node fmwatch[.]cjs$/m);
    assert.ok(documented, 'SETUP documents the leased firstmate launch');
    const command = documented[0]
      .split(' ')
      .map(word => (word === 'node' ? process.execPath : word.endsWith('.cjs') ? path.join(fixture.home, word) : word));
    const launch = () => fixture.start(command[0], command.slice(1));
    const first = launch();
    const cursor = path.join(fixture.home, 'watch-cursor-fmwatch.json');
    await until(() => read(cursor), 'initial baseline is saved');
    const owner = Number(read(path.join(fixture.home, 'fmwatch.cjs.pid')));
    first.child.kill();
    await until(() => !alive(owner), 'watcher exits after its foreground Monitor expires');
    const original = read(cursor);
    if (old) {
      const saved = JSON.parse(original);
      saved.savedAt = Date.now() - 3 * 3600000;
      fs.writeFileSync(cursor, JSON.stringify(saved));
    }
    const reply = identity => ({
      timestamp: new Date().toISOString(),
      uuid: 'uuid-' + identity,
      type: 'assistant',
      message: { id: identity, stop_reason: 'end_turn', content: [{ type: 'text', text: identity }] },
    });
    const keys = ['gap-one', 'gap-two', 'gap-three', 'gap-four'];
    fs.appendFileSync(transcript, keys.map(identity => JSON.stringify(reply(identity)) + '\n').join(''));
    const next = launch();
    if (old) {
      await until(() => JSON.parse(read(cursor)).savedAt > Date.now() - 60000, 'new shift baselines its cursor');
      assert.doesNotMatch(next.output(), /FM REPLY/, 'between-shift history is not a fresh wake');
      fs.appendFileSync(transcript, JSON.stringify(reply('fresh')) + '\n');
    }
    const expected = old ? ['fresh'] : keys;
    await until(() => expected.every(key => next.output().includes('[key reply:' + key + ']')), next.errors());
    await until(() => JSON.parse(read(cursor)).offsets[0][1] === fs.statSync(transcript).size, 'cursor advances');
    await pause(150);
    const delivered = next
      .output()
      .split('[key reply:')
      .slice(1)
      .map(tail => tail.split(']')[0]);
    assert.deepEqual(delivered, expected);
    assert.equal(read(cursor).includes('uuid-gap-one'), !old, 'only delivered reply UUIDs are retained');
  });

test('a leased gate unregisters its own PID when the lease expires', async context => {
  const fixture = setup(context);
  fixture.copy('gate.cjs');
  const registry = path.join(fixture.home, 'gate-pids.json');
  const watcher = fixture.start(
    process.execPath,
    [path.join(fixture.home, 'gate.cjs'), '--home', fixture.home, '--mode', 'off'],
    lease(fixture.home),
  );
  await until(() => JSON.parse(read(registry) || '{}')[watcher.child.pid], 'gate registers its own PID');
  lease(fixture.home, false);
  await until(() => watcher.child.exitCode !== null, 'gate exits on lease expiry');
  assert.equal(watcher.child.exitCode, 0, watcher.errors());
  assert.equal(JSON.parse(read(registry))[watcher.child.pid], undefined, 'expired gate leaves no stale PID');
});

test('an expired lease retains a queued gate input and pending output instead of marking its shape', async context => {
  const fixture = setup(context);
  fixture.copy('gate.cjs');
  const hash = require('node:crypto').createHash('sha256').update('default').digest('hex').slice(0, 16);
  const input = path.join(fixture.home, 'gate-input-' + hash + '.json');
  const line = 'FM INFO | leased gap [key fixture:gap]';
  fs.writeFileSync(input, JSON.stringify([line]));
  fs.writeFileSync(path.join(fixture.home, 'watch-output-gate-' + hash + '.txt'), line + '\n');
  const start = valid =>
    fixture.start(
      process.execPath,
      [path.join(fixture.home, 'gate.cjs'), '--home', fixture.home, '--mode', 'rules'],
      lease(fixture.home, valid),
    );
  const expired = start(false);
  await until(() => expired.child.exitCode !== null, 'gate refuses expired output');
  leaseStopped(expired.output());
  assert.equal(read(path.join(fixture.home, 'gate-shapes.json')), '');
  assert.deepEqual(JSON.parse(read(input)), [line]);
  const next = start(true);
  await until(() => next.output().includes(line), 'gate input survives expired lease');
  await until(() => read(input) === '[]', 'gate acknowledges only after recovery');
});

test('conductwatch cannot commit a response that arrives after lease expiry', async context => {
  const fixture = setup(context);
  fixture.copy('conductwatch.cjs');
  let pending;
  const server = http.createServer((request, response) => {
    pending = response;
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  context.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const watcher = fixture.start(
    process.execPath,
    [
      path.join(fixture.home, 'conductwatch.cjs'),
      '--server',
      'http://127.0.0.1:' + server.address().port,
      '--boards',
      'fixture',
    ],
    lease(fixture.home),
  );
  await until(() => pending, 'conduct poll is in flight');
  lease(fixture.home, false);
  pending.end(JSON.stringify({ signals: { untagged: 1 } }));
  await until(() => watcher.child.exitCode !== null, 'stale conduct watcher exits');
  leaseStopped(watcher.output());
  assert.equal(read(path.join(fixture.home, 'conductwatch-state.json')), '');
});

test('sweep preserves its cursor and uncommitted record when its lease expires during a probe', async context => {
  const fixture = setup(context);
  fixture.copy('lighthouse-sweep.sh', text => text.replace(/\r/g, ''));
  const hook = path.join(fixture.home, 'hook.sh');
  fs.writeFileSync(
    hook,
    [
      'if ! command -v python >/dev/null 2>&1; then python() { command python3 "$@"; }; fi',
      'timeout() {',
      '  case "$1" in',
      '    60) while [ ! -f "$SWEEP_GO" ]; do sleep 0.01; done; printf "fleet=unreachable\\n" ;;',
      '    90) printf "RECORD CHECK | leased-record\\n" ;;',
      '  esac',
      '}',
    ].join('\n') + '\n',
  );
  const state = path.join(fixture.home, 'lh-state.txt');
  const previous = 'probe=ok\nswept_at=1\n';
  fs.writeFileSync(state, previous);
  const go = path.join(fixture.home, 'go');
  const launch = () =>
    fixture.start(bash, [path.join(fixture.home, 'lighthouse-sweep.sh')], {
      ...lease(fixture.home),
      BASH_ENV: hook.replace(/\\/g, '/'),
      SWEEP_INTERVAL: '0.1',
      SWEEP_GO: go.replace(/\\/g, '/'),
    });
  const watcher = launch();
  await until(() => read(path.join(fixture.home, 'lh.pid')), 'leased sweep starts');
  lease(fixture.home, false);
  fs.writeFileSync(go, 'go');
  await until(() => watcher.child.exitCode !== null, 'sweep stops before output or commit');
  leaseStopped(watcher.output());
  assert.equal(read(state), previous);
  const next = launch();
  await until(() => next.output().includes('leased-record'), 'uncommitted record arrives after re-arm');
});
