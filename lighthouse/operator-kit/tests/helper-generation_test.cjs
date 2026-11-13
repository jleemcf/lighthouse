'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { protect } = require('../../server/registry-files');
const generation = require('../scripts/helper-generation.cjs');
const runner = require('../scripts/helper-runner.cjs');
const cursors = require('../scripts/helper-cursors.cjs');
const transfer = require('../scripts/dispatch-transfer.cjs');
function fixture(context) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'helper-generation-'));
  protect(home, true);
  context.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const status = {
    enabled: true,
    recoveryAvailable: true,
    targetAvailability: 'same-home',
    ownership: {
      holderSessionId: 'session-original',
      installationId: 'installation-original',
      epoch: 1,
      leaseUntil: Date.now() + 60000,
      phase: 'working',
    },
  };
  const session = { sessionId: status.ownership.holderSessionId, epoch: 1 };
  return { home, board: 'test-board', session, status };
}
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
test('new generation retires old helpers without importing any PID and keeps concurrent helper kinds', context => {
  const f = fixture(context);
  const first = generation.create(f.home, f.board, f.session, f.status, 'boardwatch');
  const collector = generation.create(f.home, f.board, f.session, f.status, 'collector');
  assert.equal(generation.alive(first.file, first.id), true);
  assert.equal(generation.alive(collector.file, collector.id), true);
  const second = { sessionId: 'session-successor', epoch: 2 };
  const next = { ...f.status, ownership: { ...f.status.ownership, holderSessionId: second.sessionId, epoch: 2 } };
  const helper = generation.create(f.home, f.board, second, next, 'boardwatch');
  assert.equal(generation.alive(first.file, first.id), false);
  assert.equal(generation.alive(collector.file, collector.id), false);
  assert.throws(() => generation.refresh(first, f.status), /retired/);
  assert.throws(() => generation.create(f.home, f.board, f.session, f.status, 'fmwatch'), /newer generation/);
  assert.equal(generation.alive(helper.file, helper.id), true);
  assert.deepEqual(
    generation.references(f.home, f.board).map(item => item.id),
    [helper.id],
  );
  assert.doesNotMatch(JSON.stringify(helper.record), /pid|lockPid/);
  generation.retire(first);
  assert.equal(generation.alive(helper.file, helper.id), true);
});
test('generation readiness and exact epoch fail closed; feature-off creates no generation state', context => {
  const f = fixture(context);
  for (const status of [
    { ...f.status, recoveryAvailable: false },
    { ...f.status, ownership: { ...f.status.ownership, epoch: 2 } },
    { ...f.status, ownership: { ...f.status.ownership, leaseUntil: 0 } },
  ])
    assert.throws(() => generation.create(f.home, f.board, f.session, status, 'collector'), /readiness/);
  assert.deepEqual(fs.readdirSync(f.home), []);
  assert.equal(generation.alive(undefined, undefined), true);
});
for (const legacy of [false, true])
  test('generation loss reports authority unconfirmed; legacy lease=' + legacy, async context => {
    const f = fixture(context);
    const helper = generation.create(f.home, f.board, f.session, f.status, 'boardwatch');
    generation.retire(helper);
    const environment = { ...process.env, LH_HELPER_LEASE: helper.file, LH_HELPER_ID: helper.id };
    delete environment.LH_MONITOR_LEASE;
    delete environment.LH_MONITOR_LEASE_TOKEN;
    if (legacy) {
      environment.LH_MONITOR_LEASE = path.join(f.home, 'monitor-lease.json');
      environment.LH_MONITOR_LEASE_TOKEN = 'fixture-monitor';
      fs.writeFileSync(
        environment.LH_MONITOR_LEASE,
        JSON.stringify({
          token: 'fixture-monitor',
          expires: Date.now() + 60000,
          parents: [process.pid],
        }),
      );
    }
    const child = spawn(
      process.execPath,
      ['-e', 'require(process.argv[1]).check()', path.join(__dirname, '../scripts/watch-lease.cjs')],
      { env: environment, stdio: 'pipe' },
    );
    context.after(() => child.kill());
    let errors = '';
    let output = '';
    child.stderr.on('data', bytes => (errors += bytes));
    child.stdout.on('data', bytes => (output += bytes));
    const [code] = await once(child, 'exit');
    assert.equal(code, 1, errors);
    assert.equal(errors, '');
    assert.match(output, /WATCH LEASE .*stopped: authority unconfirmed; .*re-arm/);
  });

test('runner retries a failed refresh within the existing lease but reports sustained loss', async context => {
  const f = fixture(context);
  const exitCode = process.exitCode;
  context.after(() => {
    process.exitCode = exitCode;
  });
  let calls = 0;
  let failed = true;
  let output = '';
  const write = fs.writeSync;
  context.mock.method(fs, 'writeSync', (descriptor, value, ...args) => {
    if (descriptor !== 1) return write(descriptor, value, ...args);
    output += value;
    return value.length;
  });
  const running = await runner.supervise({
    ...f,
    kind: 'boardwatch',
    request: async () => {
      calls++;
      if (failed && calls > 1) throw new Error('brief board restart');
      return f.status;
    },
    command: process.execPath,
    args: ['-e', 'setInterval(() => {}, 1000)'],
    stdio: 'ignore',
  });
  context.after(running.close);
  await wait(1000);
  assert.ok(calls >= 2);
  assert.equal(running.child.exitCode, null);
  assert.equal(running.child.signalCode, null);
  failed = false;
  await wait(900);
  assert.equal(generation.alive(running.helper.file, running.helper.id), true);
  assert.equal(output, '');
  const exited = once(running.child, 'exit');
  failed = true;
  await Promise.race([exited, wait(6000).then(() => assert.fail('unconfirmed helper did not stop'))]);
  assert.match(output, /WATCH LEASE \| boardwatch stopped: authority unconfirmed; re-arm/);
});

test('failed lease writes retain the persisted expiry and remove their temporary files', context => {
  const setup = fixture(context);
  const helper = generation.create(setup.home, setup.board, setup.session, setup.status, 'collector');
  const expiry = helper.record.expiresAt;
  const rename = fs.renameSync;
  for (const code of ['EPERM', 'EACCES', 'EBUSY']) {
    const mock = context.mock.method(fs, 'renameSync', (source, destination) => {
      if (destination === helper.file) throw Object.assign(new Error('lease busy'), { code });
      return rename(source, destination);
    });
    assert.throws(() => generation.refresh(helper, setup.status), { code });
    assert.equal(helper.record.expiresAt, expiry);
    assert.equal(JSON.parse(fs.readFileSync(helper.file, 'utf8')).expiresAt, expiry);
    assert.deepEqual(
      fs.readdirSync(helper.record.directory).filter(name => name.endsWith('.tmp')),
      [],
    );
    mock.mock.restore();
  }
});
test('runner retries transient lease writes only until the last persisted expiry', async context => {
  const setup = fixture(context);
  const exitCode = process.exitCode;
  context.after(() => (process.exitCode = exitCode));
  let output = '';
  const write = fs.writeSync;
  context.mock.method(fs, 'writeSync', (descriptor, value, ...args) => {
    if (descriptor !== 1) return write(descriptor, value, ...args);
    output += value;
    return value.length;
  });
  const running = await runner.supervise({
    ...setup,
    kind: 'boardwatch',
    request: async () => setup.status,
    command: process.execPath,
    args: ['-e', 'setInterval(() => {}, 1000)'],
    stdio: 'ignore',
  });
  context.after(running.close);
  let remaining = 1;
  let failures = 0;
  const rename = fs.renameSync;
  context.mock.method(fs, 'renameSync', (source, destination) => {
    if (destination === running.helper.file && remaining !== 0) {
      remaining--;
      failures++;
      throw Object.assign(new Error('lease busy'), { code: 'EPERM' });
    }
    return rename(source, destination);
  });
  await wait(1100);
  assert.equal(failures, 1);
  assert.equal(running.child.signalCode, null);
  assert.equal(running.child.exitCode, null);
  assert.equal(output, '');
  await wait(900);
  const expiry = running.helper.record.expiresAt;
  assert.ok(expiry > Date.now());
  const exited = once(running.child, 'exit');
  remaining = -1;
  await Promise.race([exited, wait(6000).then(() => assert.fail('write-failed helper did not stop'))]);
  assert.equal(running.helper.record.expiresAt, expiry);
  assert.ok(Date.now() >= expiry);
  assert.ok(Date.now() < expiry + 2000);
  assert.ok(failures > 1);
  assert.equal(process.exitCode, 1);
  assert.match(output, /WATCH LEASE \| boardwatch stopped: authority unconfirmed; re-arm/);
  assert.deepEqual(
    fs.readdirSync(running.helper.record.directory).filter(name => name.endsWith('.tmp')),
    [],
  );
});
test('runner reports process-start failure separately from authority loss', async context => {
  const setup = fixture(context);
  const exitCode = process.exitCode;
  context.after(() => (process.exitCode = exitCode));
  let output = '';
  const write = fs.writeSync;
  context.mock.method(fs, 'writeSync', (descriptor, value, ...args) => {
    if (descriptor !== 1) return write(descriptor, value, ...args);
    output += value;
    return value.length;
  });
  const running = await runner.supervise({
    ...setup,
    kind: 'collector',
    request: async () => setup.status,
    command: path.join(setup.home, 'missing-runtime'),
    args: [],
    stdio: 'ignore',
  });
  context.after(running.close);
  await new Promise(resolve => running.child.once('close', resolve));
  assert.equal(process.exitCode, 1);
  assert.match(output, /collector stopped: process start failed; check runtime/);
  assert.doesNotMatch(output, /authority unconfirmed|re-arm/);
});
test('transient generation reads keep only the last good unexpired authority', context => {
  const f = fixture(context);
  const helper = generation.create(f.home, f.board, f.session, f.status, 'collector');
  const read = fs.readFileSync;
  const transient = new Set(['EPERM', 'EACCES', 'EBUSY', 'syntax']);
  for (const code of transient) {
    const mock = context.mock.method(fs, 'readFileSync', (file, ...args) => {
      if (file === helper.file) {
        if (code === 'syntax') return '{';
        throw Object.assign(new Error('read in progress'), { code });
      }
      return read(file, ...args);
    });
    assert.equal(generation.alive(helper.file, helper.id), true, code);
    mock.mock.restore();
  }
  fs.writeFileSync(path.join(helper.record.directory, '2.generation.json'), '{}');
  assert.equal(generation.alive(helper.file, helper.id), false);
  fs.rmSync(path.join(helper.record.directory, '2.generation.json'));
  helper.record.expiresAt = 0;
  fs.writeFileSync(helper.file, JSON.stringify(helper.record));
  assert.equal(generation.alive(helper.file, helper.id), false);
  context.mock.method(fs, 'readFileSync', () => {
    throw Object.assign(new Error('busy'), { code: 'EBUSY' });
  });
  assert.equal(generation.alive(helper.file, helper.id), false);
});
test('runner reports an unconfirmed status rather than inventing a newer generation', async context => {
  const setup = fixture(context);
  const exitCode = process.exitCode;
  context.after(() => (process.exitCode = exitCode));
  const write = fs.writeSync;
  let output = '';
  context.mock.method(fs, 'writeSync', (descriptor, value, ...args) => {
    if (descriptor !== 1) return write(descriptor, value, ...args);
    output += value;
    return value.length;
  });
  let current = setup.status;
  const running = await runner.supervise({
    ...setup,
    kind: 'boardwatch',
    request: async () => current,
    command: process.execPath,
    args: ['-e', 'setInterval(() => {}, 1000)'],
    stdio: 'ignore',
  });
  context.after(running.close);
  const exited = once(running.child, 'exit');
  current = { enabled: true, recoveryAvailable: true };
  await Promise.race([exited, wait(5000).then(() => assert.fail('unconfirmed helper did not stop'))]);
  assert.match(output, /WATCH LEASE \| boardwatch stopped: authority unconfirmed; re-arm/);
  assert.equal(process.exitCode, 1);
});
test('runner stops only its own child on ownership change; unrelated local process survives', async context => {
  const f = fixture(context);
  const unrelated = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  context.after(() => unrelated.kill());
  let current = f.status;
  const running = await runner.supervise({
    ...f,
    kind: 'collector',
    request: async () => current,
    command: process.execPath,
    args: ['-e', 'setInterval(() => {}, 1000)'],
    stdio: 'ignore',
  });
  context.after(running.close);
  const exited = once(running.child, 'exit');
  current = { ...f.status, ownership: { ...f.status.ownership, epoch: 2 } };
  await Promise.race([exited, wait(5000).then(() => assert.fail('old child did not retire'))]);
  assert.equal(unrelated.exitCode, null);
  assert.doesNotThrow(() => process.kill(unrelated.pid, 0));
  assert.equal(generation.alive(running.helper.file, running.helper.id), false);
  await assert.rejects(
    runner.supervise({
      ...f,
      kind: 'fmwatch',
      request: async () => ({ ...f.status, targetAvailability: 'different-machine' }),
    }),
    /original firstmate/,
  );
});
test('generation watchers ignore a stale PID file naming an unrelated process', async context => {
  const f = fixture(context);
  fs.cpSync(path.join(__dirname, '../scripts'), f.home, { recursive: true });
  const unrelated = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  context.after(() => unrelated.kill());
  for (const kind of ['boardwatch', 'fmwatch']) {
    fs.writeFileSync(path.join(f.home, kind + '.cjs.pid'), String(unrelated.pid));
    const helper = generation.create(f.home, f.board, f.session, f.status, kind);
    const child = spawn(
      process.execPath,
      [path.join(f.home, kind + '.cjs'), '--server', 'http://127.0.0.1:1', '--board', f.board],
      { cwd: f.home, stdio: 'ignore', env: { ...process.env, LH_HELPER_LEASE: helper.file, LH_HELPER_ID: helper.id } },
    );
    const exit = once(child, 'exit');
    await wait(150);
    assert.doesNotThrow(() => process.kill(unrelated.pid, 0));
    generation.retire(helper);
    child.kill();
    await exit;
    assert.equal(fs.readFileSync(path.join(f.home, kind + '.cjs.pid'), 'utf8'), String(unrelated.pid));
  }
});
test('authenticated cross-home cursor import never imports paths, locks or process identities', context => {
  const f = fixture(context);
  const next = fixture(context);
  fs.writeFileSync(
    path.join(f.home, 'collector-cursor.json'),
    JSON.stringify({
      seen: ['event-already-collected'],
      hwm: '2026-11-12T12:00:00Z',
      offsets: { '/old/transcript': 500 },
      pid: 123,
      scope: { sessionId: f.session.sessionId, epoch: 1 },
    }),
  );
  fs.writeFileSync(
    path.join(f.home, 'watch-cursor-fmwatch.json'),
    JSON.stringify({
      started: '2026-11-12T12:00:00Z',
      order: ['firstmate-event'],
      lockPid: 123,
      offsets: [['/old/firstmate', 55]],
    }),
  );
  fs.writeFileSync(path.join(f.home, 'boardwatch-test-board.json'), JSON.stringify({ seq: 99, said: ['m:known'] }));
  const targetBinding = { id: 'firstmate', installationId: 'installation-original', freshness: 'fresh' };
  const destination = path.join(f.home, 'cursor.evidence');
  const keyFile = path.join(f.home, 'cursor.key');
  transfer.exportEvidence({ home: f.home, board: f.board, destination, keyFile, targetBinding, includeCursors: true });
  transfer.importEvidence({ home: next.home, board: next.board, source: destination, keyFile, targetBinding });
  const cursor = JSON.parse(fs.readFileSync(path.join(next.home, 'collector-cursor.json'), 'utf8'));
  assert.deepEqual(cursor.seen, ['event-already-collected']);
  assert.equal(cursor.recoveryFloor, '2026-11-12T12:00:00Z');
  assert.deepEqual(cursor.offsets, {});
  const watcher = JSON.parse(fs.readFileSync(path.join(next.home, 'watch-cursor-fmwatch.json'), 'utf8'));
  assert.deepEqual(watcher.order, ['firstmate-event']);
  assert.doesNotMatch(JSON.stringify(watcher), /lockPid|pid|old\/firstmate/);
  const board = JSON.parse(fs.readFileSync(path.join(next.home, 'boardwatch-test-board.json'), 'utf8'));
  assert.equal(board.seq, 99);
  assert.deepEqual(board.said, ['m:known']);
  const before = fs.readFileSync(path.join(next.home, 'collector-cursor.json'), 'utf8');
  assert.equal(
    transfer.importEvidence({ home: next.home, board: next.board, source: destination, keyFile, targetBinding })
      .duplicate,
    true,
  );
  assert.equal(fs.readFileSync(path.join(next.home, 'collector-cursor.json'), 'utf8'), before);
  assert.equal(cursors.references(next.home, f.board).length, 3);
});
