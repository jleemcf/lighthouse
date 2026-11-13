'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { bash, env } = require('../../verification/update/bootstrap-replay.cjs');
const scripts = path.join(__dirname, '../scripts');
const pause = delay => new Promise(resolve => setTimeout(resolve, delay));
const read = file => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '');

async function until(predicate, label, timeout = 20000) {
  const deadline = performance.now() + timeout;
  while (performance.now() < deadline) {
    if (predicate()) return;
    await pause(30);
  }
  assert.fail(label);
}

function setup(context, fault = 'none') {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lease-stall-'));
  for (const name of [
    'monitor.cjs',
    'watch-lease.cjs',
    'watch-output.cjs',
    'gate.cjs',
    'gate-policy.cjs',
    'gate-rules.json',
    'fmwatch.cjs',
    'boardwatch.cjs',
    'conductwatch.cjs',
  ])
    fs.copyFileSync(path.join(scripts, name), path.join(home, name));
  fs.writeFileSync(
    path.join(home, 'fault.cjs'),
    [
      "const fs = require('node:fs'); const original = fs.renameSync;",
      'if (process.argv[1].endsWith("monitor.cjs")) {',
      '  let started = 0, injected = false;',
      '  if (process.env.LEASE_STALL_FAULT === "loop") setTimeout(() => {',
      '    fs.writeFileSync(__dirname + "/fault-start", "loop");',
      '    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 4000);',
      '    fs.writeFileSync(__dirname + "/fault-end", "done");',
      '  }, 2000);',
      '  fs.renameSync = (from, to) => {',
      '    if (/monitor-.*[.]json$/.test(to)) {',
      '      started ||= performance.now();',
      '      const fault = process.env.LEASE_STALL_FAULT;',
      '      if (!["loop", "reader"].includes(fault) && !injected && performance.now() - started >= 1100) {',
      '        injected = true;',
      '        fs.writeFileSync(__dirname + "/fault-start", String(performance.now()));',
      '        if (fault === "rename")',
      '          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 4000);',
      '        if (fault === "frozen")',
      '          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 30000);',
      '        if (fault === "busy") started = performance.now();',
      '      }',
      '      if (injected && fault === "busy" && performance.now() - started < 4000)',
      '        throw Object.assign(new Error("fixture sharing violation"), { code: "EPERM" });',
      '      original(from, to);',
      '      fs.appendFileSync(__dirname + "/timing.jsonl", JSON.stringify({',
      '        at: performance.now(), remaining: JSON.parse(fs.readFileSync(to)).expires - Date.now()',
      '      }) + "\\n");',
      '      if (injected) fs.writeFileSync(__dirname + "/fault-end", "done");',
      '      return;',
      '    }',
      '    return original(from, to);',
      '  };',
      '}',
      'if (process.argv[1].endsWith("boardwatch.cjs") && process.env.LEASE_STALL_FAULT === "reader") {',
      '  const read = fs.readFileSync; let reads = 0;',
      '  fs.readFileSync = function(file, ...args) {',
      '    if (file === process.env.LH_MONITOR_LEASE && ++reads === 8) {',
      '      fs.writeFileSync(__dirname + "/fault-start", String(performance.now()));',
      '      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 4000);',
      '      const lease = JSON.parse(read.call(this, file, ...args));',
      '      process.kill(lease.pid, 0);',
      '      fs.writeFileSync(__dirname + "/reader-fault.json", JSON.stringify({',
      '        remaining: lease.expires - Date.now(), launcherAlive: true',
      '      }));',
      '      fs.writeFileSync(__dirname + "/fault-end", "done");',
      '      throw Object.assign(new Error("fixture read after stall"), { code: "EPERM" });',
      '    }',
      '    return read.call(this, file, ...args);',
      '  };',
      '}',
    ].join('\n'),
  );
  fs.writeFileSync(
    path.join(home, 'watch-all.sh'),
    [
      'cd "$1" || exit 2',
      'node fmwatch.cjs | node gate.cjs --home "$1" --mode off &',
      'node boardwatch.cjs --server http://127.0.0.1:1 --board fixture --interval 0.1 &',
      'node conductwatch.cjs --server http://127.0.0.1:1 --boards fixture --interval 0.1 &',
      'wait',
    ].join('\n'),
  );
  fs.writeFileSync(
    path.join(home, 'owner.cjs'),
    [
      "const { spawn } = require('node:child_process'); const path = require('node:path');",
      'const args = [path.join(__dirname, "monitor.cjs"), "--source", "mixed",',
      '  "--", process.env.LEASE_TEST_BASH, path.join(__dirname, "watch-all.sh"), __dirname.split("\\\\").join("/")],',
      'options = { stdio: "inherit", windowsHide: true };',
      'const pipeline = \'{ printf "fixture-ignored\\\\n"; "$@" 2>&1; } | while IFS= read -r line; do' +
        '  [[ "$line" == fixture-ignored ]] || printf "%s\\\\n" "$line"; done\';',
      'const child = process.env.LEASE_TEST_FILTER === "1"',
      '  ? spawn(process.env.LEASE_TEST_BASH, ["-c", pipeline, "filter-fixture", process.execPath, ...args], options)',
      '  : spawn(process.execPath, args, options);',
      'child.on("exit", code => process.exit(code || 0));',
    ].join('\n'),
  );
  const environment = { ...env, LEASE_STALL_FAULT: fault, LEASE_TEST_BASH: bash };
  for (const name of ['TYPESAFE_API_KEY', 'LH_MONITOR_LEASE', 'LH_MONITOR_LEASE_TOKEN']) delete environment[name];
  const pressure = [];
  if (process.env.LEASE_PRESSURE === '1') {
    const cpuWorkers = Number(process.env.LEASE_CPU_WORKERS || 2);
    for (let index = 0; index < cpuWorkers + 2; index++) {
      const program =
        index < cpuWorkers
          ? 'const until = Date.now() + 60000; while (Date.now() < until) Math.sqrt(Math.random());'
          : 'const fs = require("node:fs"); const file = process.argv[1]; const data = Buffer.alloc(4 * 1024 * 1024);' +
            'const until = Date.now() + 60000; while (Date.now() < until) {' +
            'const descriptor = fs.openSync(file + ".tmp", "w"); fs.writeSync(descriptor, data);' +
            'fs.fsyncSync(descriptor); fs.closeSync(descriptor); fs.renameSync(file + ".tmp", file); }';
      pressure.push(
        spawn(process.execPath, ['-e', program, path.join(home, 'pressure-' + index)], {
          env: environment,
          stdio: 'ignore',
          windowsHide: true,
        }),
      );
    }
  }
  environment.NODE_OPTIONS = '--require ' + JSON.stringify(path.join(home, 'fault.cjs'));
  const owner = spawn(process.execPath, [path.join(home, 'owner.cjs')], {
    env: environment,
    stdio: 'pipe',
    windowsHide: true,
  });
  let output = '';
  owner.stdout.on('data', text => (output += text));
  owner.stderr.on('data', text => (output += text));
  const identities = new Set();
  const sample = () => {
    try {
      const gates = read(path.join(home, 'gate-pids.json'));
      if (gates) for (const identity of Object.keys(JSON.parse(gates))) identities.add(Number(identity));
      for (const name of fs.readdirSync(home)) {
        if (name.endsWith('.pid')) identities.add(Number(read(path.join(home, name))));
        if (/^monitor-.*[.]json$/.test(name)) identities.add(JSON.parse(read(path.join(home, name))).pid);
      }
    } catch {}
  };
  const sampler = setInterval(sample, 50);
  context.after(async () => {
    clearInterval(sampler);
    context.diagnostic(JSON.stringify({ fault, output, timing: read(path.join(home, 'timing.jsonl')) }));
    sample();
    owner.kill();
    for (const child of pressure) child.kill('SIGKILL');
    for (const identity of identities) {
      if (!(identity > 1) || identity === process.pid) continue;
      try {
        process.kill(identity, 'SIGKILL');
      } catch {}
    }
    await pause(300);
    fs.rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  });
  const stopped = () => read(path.join(home, 'watch-lease-events.jsonl'));
  const allStopped = () => {
    const events = stopped().trim().split('\n').filter(Boolean).map(JSON.parse);
    return ['fmwatch', 'gate', 'boardwatch', 'conductwatch'].every(name =>
      events.some(event => event.watcher === name + '.cjs'),
    );
  };
  const ready = () =>
    ['fmwatch', 'boardwatch', 'conductwatch'].every(name =>
      fs.readdirSync(home).some(file => file.startsWith(name) && file.endsWith('.pid')),
    ) && read(path.join(home, 'gate-pids.json')).includes('source');
  const launcher = () => {
    const name = fs.readdirSync(home).find(name => /^monitor-.*[.]json$/.test(name));
    return name && JSON.parse(read(path.join(home, name)));
  };
  return { home, owner, output: () => output, stopped, allStopped, ready, launcher };
}

for (const fault of ['none', 'loop', 'rename', 'busy', 'reader']) {
  const label =
    fault === 'none'
      ? 'real leased watchers renew without an injected stall'
      : 'real leased watchers survive a four-second ' + fault + ' stall';
  test(label, async context => {
    const fixture = setup(context, fault);
    await until(fixture.ready, 'all four real watchers start');
    await until(
      () => fs.existsSync(path.join(fixture.home, 'fault-end')) || fixture.owner.exitCode !== null,
      'launcher finishes its stall',
    );
    await pause(fault === 'none' ? 4000 : 1200);
    if (fault === 'reader') {
      const observed = JSON.parse(read(path.join(fixture.home, 'reader-fault.json')));
      context.diagnostic(JSON.stringify({ readerFault: observed }));
      assert.equal(observed.launcherAlive, true);
      assert.ok(observed.remaining > 0, 'the stalled watcher fails a read while the on-disk lease is live');
    }
    assert.equal(fixture.stopped(), '', fixture.output());
    assert.equal(fixture.owner.exitCode, null, fixture.output());
    assert.equal(fixture.ready(), true);
    assert.doesNotMatch(fixture.output(), /fixture-ignored/, 'the downstream exclusion filter stays independent');
    const samples = read(path.join(fixture.home, 'timing.jsonl')).trim().split('\n').map(JSON.parse);
    const gaps = samples.slice(1).map((sample, index) => sample.at - samples[index].at);
    context.diagnostic(JSON.stringify({ fault, maxPublishGap: Math.max(...gaps), samples }));
  });
}

for (const lost of ['launcher', 'owner']) {
  test('real watchers stop promptly after losing their ' + lost, async context => {
    const fixture = setup(context);
    await until(fixture.ready, 'all real watchers start');
    const started = performance.now();
    if (lost === 'launcher') process.kill(fixture.launcher().pid, 'SIGKILL');
    else fixture.owner.kill('SIGKILL');
    await until(fixture.allStopped, 'all four watchers record parent loss', 3000);
    const elapsed = performance.now() - started;
    assert.ok(elapsed < 2000, 'dead parent detection stays independent of the longer expiry');
    assert.match(fixture.stopped(), /parent gone|removed/);
    context.diagnostic(JSON.stringify({ lost, elapsed }));
  });
}

test('a live but frozen launcher loses authority within sixteen seconds', async context => {
  const fixture = setup(context, 'frozen');
  await until(fixture.ready, 'all real watchers start');
  await until(() => fs.existsSync(path.join(fixture.home, 'fault-start')), 'launcher freezes');
  const started = performance.now();
  await until(fixture.allStopped, 'all four watchers expire', 16000);
  const elapsed = performance.now() - started;
  assert.ok(elapsed < 16000);
  context.diagnostic(JSON.stringify({ frozenExpiryElapsed: elapsed }));
  assert.match(fixture.output(), /WATCH LEASE .*stopped: expired/);
});
