'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const vm = require('node:vm');
const scripts = path.join(__dirname, '../scripts');
const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function concurrent(context, fault) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lease-read-'));
  for (const name of [
    'monitor.cjs',
    'watch-lease.cjs',
    'watch-output.cjs',
    'gate.cjs',
    'gate-policy.cjs',
    'gate-rules.json',
    'fmwatch.cjs',
    'boardwatch.cjs',
  ]) {
    fs.copyFileSync(path.join(scripts, name), path.join(home, name));
  }
  fs.writeFileSync(
    path.join(home, 'fault.cjs'),
    [
      "const fs = require('node:fs'); const read = fs.readFileSync; let reads = 0;",
      'fs.readFileSync = function(file, ...args) {',
      '  if (file === process.env.LH_MONITOR_LEASE && ++reads === 8 &&',
      '      !process.argv[1].endsWith("monitor.cjs")) {',
      '    const fault = process.env.LEASE_READ_FAULT;',
      '    if (fault === "json") return "{";',
      '    if (["EPERM", "EACCES", "EBUSY"].includes(fault))',
      '      throw Object.assign(new Error("fixture read fault"), { code: fault });',
      '  }',
      '  return read.call(this, file, ...args);',
      '};',
    ].join('\n'),
  );
  fs.writeFileSync(
    path.join(home, 'readers.cjs'),
    [
      "const fs = require('node:fs'); const path = require('node:path');",
      "const { spawn } = require('node:child_process'); const children = []; const exits = [];",
      'const launched = Date.now(); const samples = [];',
      'let finished = false;',
      'const report = () => fs.writeFileSync(path.join(__dirname, "report.json"), JSON.stringify({ exits, samples }));',
      'for (const name of ["gate", "fmwatch", "boardwatch"]) {',
      '  const args = name === "gate" ? ["--home", __dirname, "--mode", "off"] :',
      '    name === "boardwatch" ? ["--server", "http://127.0.0.1:1", "--board", "fixture"] : [];',
      '  const child = spawn(process.execPath, [path.join(__dirname, name + ".cjs"), ...args],',
      '    { stdio: ["pipe", "inherit", "inherit"], windowsHide: true });',
      '  children.push(child);',
      '  child.on("exit", (code, signal) => {',
      '    if (!finished) { exits.push({ name, code, signal, after: Date.now() - launched }); report(); }',
      '  });',
      '}',
      'if (process.env.LEASE_READ_FAULT.startsWith("held")) {',
      '  const descriptor = fs.openSync(process.env.LH_MONITOR_LEASE, "r");',
      '  const delay = process.env.LEASE_READ_FAULT === "held-long" ? 1900 : 80;',
      '  setTimeout(() => fs.closeSync(descriptor), delay);',
      '}',
      'const timer = setInterval(() => {',
      '  try {',
      '    const lease = JSON.parse(fs.readFileSync(process.env.LH_MONITOR_LEASE, "utf8"));',
      '    samples.push({ expires: lease.expires, remaining: lease.expires - Date.now() });',
      '    report();',
      '    if (Date.now() - launched >= 2300 && samples.length >= 5 &&',
      '        samples.at(-1).expires > samples[0].expires) finish();',
      '  } catch {}',
      '}, 300);',
      'const timeout = setTimeout(finish, 10000);',
      'function finish() {',
      '  clearInterval(timer);',
      '  clearTimeout(timeout);',
      '  finished = true;',
      '  fs.writeFileSync(path.join(__dirname, "report.json"), JSON.stringify({ exits, samples }));',
      '  console.log("RESULT " + JSON.stringify({ exits, samples }));',
      '  for (const child of children) child.kill();',
      '}',
    ].join('\n'),
  );
  const environment = { ...process.env, LEASE_READ_FAULT: fault };
  delete environment.TYPESAFE_API_KEY;
  delete environment.LH_MONITOR_LEASE;
  delete environment.LH_MONITOR_LEASE_TOKEN;
  environment.NODE_OPTIONS = '--require ' + JSON.stringify(path.join(home, 'fault.cjs'));
  const child = spawn(
    process.execPath,
    [path.join(home, 'monitor.cjs'), '--source', 'fixture', '--', process.execPath, path.join(home, 'readers.cjs')],
    { env: environment, stdio: 'pipe', windowsHide: true },
  );
  let output = '',
    errors = '';
  child.stdout.setEncoding('utf8').on('data', text => (output += text));
  child.stderr.setEncoding('utf8').on('data', text => (errors += text));
  context.after(async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill();
    await pause(200);
    fs.rmSync(home, { recursive: true, force: true });
  });
  const result = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error('Monitor timed out: ' + errors));
    }, 20000);
    child.on('error', reject);
    child.on('close', code => {
      clearTimeout(timeout);
      resolve(code);
    });
  });
  assert.equal(result, 0, errors);
  const reportFile = path.join(home, 'report.json');
  const deadline = Date.now() + 5000;
  while (!fs.existsSync(reportFile) && Date.now() < deadline) await pause(20);
  assert.ok(fs.existsSync(reportFile), 'fixture driver completes after Monitor exits: ' + output + errors);
  const report = JSON.parse(fs.readFileSync(reportFile, 'utf8'));
  const journal = path.join(home, 'watch-lease-events.jsonl');
  const events = fs.existsSync(journal) ? fs.readFileSync(journal, 'utf8').trim().split('\n').map(JSON.parse) : [];
  context.diagnostic(JSON.stringify({ fault, ...report, output, errors }));
  assert.deepEqual(events, [], 'short native reader holds do not revoke live watchers');
  assert.ok(report.samples.length >= 5, 'real Monitor remains listening after the fault');
  assert.ok(report.samples.at(-1).expires > report.samples[0].expires, 'real renewal loop advances');
  assert.deepEqual(report.exits, [], 'no watcher silently dies beneath a live renewing Monitor');
}

for (const fault of ['held-short', 'held-long']) {
  test('real native lease replacement with ' + fault + ' reader', { skip: process.platform !== 'win32' }, context =>
    concurrent(context, fault),
  );
}

for (const fault of ['none', 'EPERM', 'EACCES', 'EBUSY', 'json']) {
  test('concurrent real watchers survive lease read ' + fault, context => concurrent(context, fault));
}

function reader() {
  let time = 1000;
  let wallOffset = 0;
  let contents = JSON.stringify({ token: 'fixture', parents: [42], pid: 42, expires: 2500 });
  let failure;
  let failures = Infinity;
  let malformed = 0;
  let attempts = 0;
  let parent = true;
  const records = [],
    lines = [],
    descriptors = [];
  const exit = new Error('fixture exit');
  const context = {
    module: { exports: {} },
    require: name =>
      name === 'node:path'
        ? path
        : name === 'node:os'
          ? { uptime: () => time / 1000 }
          : {
              readFileSync: () => {
                attempts++;
                if (failure && failures-- > 0) throw Object.assign(new Error('fixture failure'), { code: failure });
                if (malformed-- > 0) return '{';
                return contents;
              },
              appendFileSync: (_file, text) => records.push(JSON.parse(text)),
              writeSync: (descriptor, text) => {
                descriptors.push(descriptor);
                lines.push(text);
              },
            },
    process: {
      env: { LH_MONITOR_LEASE: '/fixture/monitor.json', LH_MONITOR_LEASE_TOKEN: 'fixture' },
      argv: ['node', 'gate.cjs'],
      pid: 43,
      kill: () => {
        if (!parent) throw Object.assign(new Error('gone'), { code: 'ESRCH' });
      },
      exit: () => {
        throw exit;
      },
    },
    Date: class extends Date {
      constructor(...args) {
        super(...(args.length ? args : [time]));
      }
      static now() {
        return time + wallOffset;
      }
    },
    setInterval: () => ({ unref() {} }),
    performance: { now: () => time },
    Buffer,
    Atomics: { wait: (_array, _index, _value, delay) => (time += delay) },
    Int32Array,
    SharedArrayBuffer,
  };
  vm.runInNewContext(fs.readFileSync(path.join(scripts, 'watch-lease.cjs'), 'utf8'), context);
  return {
    lease: context.module.exports,
    records,
    lines,
    descriptors,
    exit,
    time: value => (time = value),
    wallOffset: value => (wallOffset = value),
    fault: (value, count = Infinity) => {
      failure = value;
      failures = count;
    },
    torn: count => (malformed = count),
    attempts: () => attempts,
    elapsed: () => time - 1000,
    contents: value => (contents = value),
    parentGone: () => (parent = false),
  };
}

test('uptime expiry ignores wall-clock jumps but never extends authority', () => {
  for (const offset of [-3600000, 3600000]) {
    const fixture = reader();
    fixture.contents(JSON.stringify({ token: 'fixture', parents: [42], expires: 2500, expiresUptime: 2.5 }));
    assert.equal(fixture.lease.alive(true), true);
    fixture.wallOffset(offset);
    fixture.time(2400);
    assert.equal(fixture.lease.alive(true), true);
    fixture.fault('EPERM');
    fixture.time(2500);
    assert.equal(fixture.lease.alive(), false);
    assert.throws(
      () => fixture.lease.save('/fixture', 'gate', {}),
      error => error === fixture.exit,
    );
    assert.equal(fixture.records[0].reason, 'expired');
  }
});

test('unknown reads never extend the last observed expiry or authorize expired writes', () => {
  for (const fault of ['EPERM', 'EACCES', 'EBUSY', 'json']) {
    const fixture = reader();
    assert.equal(fixture.lease.alive(true), true);
    fixture.time(2000);
    if (fault === 'json') fixture.contents('{');
    else fixture.fault(fault);
    assert.equal(fixture.lease.alive(true), true, fault);
    assert.equal(fixture.elapsed(), 1250, 'cached reads retry for at most 250 ms');
    fixture.time(2499);
    assert.equal(fixture.lease.alive(), false, 'cached reads cannot cross expiry');
    assert.equal(fixture.elapsed(), 1500, 'retries stop exactly at the last validated expiry');
    assert.throws(
      () => fixture.lease.save('/fixture', 'gate', {}),
      error => error === fixture.exit,
    );
    assert.equal(fixture.records.length, 1);
    assert.equal(fixture.records[0].reason, 'expired');
    assert.equal(fixture.records[0].lease, 'monitor.json');
    assert.match(fixture.lines[0], /WATCH LEASE .*gate.cjs \[monitor.json\] stopped: expired; check gap; re-arm/);
    assert.deepEqual(fixture.descriptors, [1], 'stdout is the Monitor notification stream');
    assert.throws(
      () => fixture.lease.check(true),
      error => error === fixture.exit,
    );
    assert.equal(fixture.lines.length, 1, 'one diagnostic per process');
  }
});

test('transient reads after startup revalidate ownership before using the cached lease', () => {
  for (const replacement of [false, true]) {
    const fixture = reader();
    assert.equal(fixture.lease.alive(true), true);
    fixture.fault('EPERM', 1);
    if (replacement) fixture.contents(JSON.stringify({ token: 'different' }));
    assert.equal(fixture.lease.alive(true), !replacement);
    assert.equal(fixture.attempts(), 3);
    assert.equal(fixture.elapsed(), 10);
  }
});

test('definite loss cannot use an otherwise unexpired last good lease', () => {
  for (const contents of ['{}', 'null', '{"token":"different"}', '{"token":"fixture","expires":0}']) {
    const fixture = reader();
    assert.equal(fixture.lease.alive(true), true);
    fixture.contents(contents);
    assert.equal(fixture.lease.alive(true), false);
  }
  for (const fault of ['EIO', 'ENOENT']) {
    const fixture = reader();
    assert.equal(fixture.lease.alive(true), true);
    fixture.fault(fault);
    assert.equal(fixture.lease.alive(true), false, 'definite read failures fail closed');
  }
});

test('first-read sharing and parse failures retry without granting startup authority', () => {
  for (const fault of ['EPERM', 'EACCES', 'EBUSY', 'json']) {
    const fixture = reader();
    if (fault === 'json') fixture.torn(1);
    else fixture.fault(fault, 1);
    assert.equal(fixture.lease.alive(true), true, fault);
    assert.equal(fixture.attempts(), 2);
    assert.equal(fixture.elapsed(), 10);
    assert.deepEqual(fixture.lines, []);
  }
  const fixture = reader();
  fixture.fault('EPERM');
  assert.throws(
    () => fixture.lease.check(true),
    error => error === fixture.exit,
  );
  assert.equal(fixture.elapsed(), 250, 'unknown startup is bounded, not an authorization grace period');
  assert.equal(fixture.records[0].reason, 'unreadable');
  assert.deepEqual(fixture.descriptors, [1]);
});

test('replacement diagnostics identify the lease without recommending another takeover', () => {
  const fixture = reader();
  fixture.lease.check(true);
  fixture.contents('{"token":"different"}');
  assert.throws(
    () => fixture.lease.check(true),
    error => error === fixture.exit,
  );
  assert.match(fixture.lines[0], /\[monitor.json\] stopped: replaced; newer Monitor owns this source; no action/);
  assert.doesNotMatch(fixture.lines[0], /re-arm/);
  for (const contents of ['{}', '{"token":"fixture"}']) {
    const initial = reader();
    initial.contents(contents);
    assert.throws(
      () => initial.lease.check(true),
      error => error === initial.exit,
    );
    assert.equal(initial.lines.length, 1, 'unknown initial Monitor identity does not suppress its diagnostic');
  }
});

test('dead Monitor is recorded locally without writing its pipe, even during unknown reads', () => {
  const fixture = reader();
  fixture.lease.check(true);
  fixture.parentGone();
  fixture.fault('EPERM');
  assert.throws(
    () => fixture.lease.check(true),
    error => error === fixture.exit,
  );
  assert.equal(fixture.records[0].reason, 'parent gone');
  assert.deepEqual(fixture.lines, []);
});
