'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { fixture, alive, pause, read, json, until } = require('./gate_parent_fixture.cjs');
const events = setup =>
  read(path.join(setup.home, 'gate-stop-events.jsonl'))
    .split('\n')
    .filter(Boolean)
    .map(line => JSON.parse(line));
const direct = (setup, source = 'mixed', extra = [], env = {}) =>
  setup.start(process.execPath, ['gate.cjs', '--mode', 'off', '--source', source, ...extra], env);
const exited = running => until(() => running.child.exitCode !== null, 'gate exits: ' + running.errors());

test('real fmwatch survives quiet default ticks, but gate and watcher stop when Monitor dies', async context => {
  const setup = fixture(context);
  const monitor = setup.monitor('fmwatch');
  const gate = await setup.gate('mixed');
  const watcher = await until(() => Number(read(path.join(setup.home, 'fmwatch.cjs.pid'))), 'real fmwatch starts');
  await until(() => monitor.output().includes('FM WATCH |'), 'scratch source reports blind');
  const firstHeartbeat = setup.heartbeat().t;
  if (process.platform === 'win32') {
    const tree = setup.tree([monitor.child.pid, gate.pid, gate.ppid, watcher]);
    context.diagnostic(JSON.stringify(tree));
    assert.equal(tree.find(row => row.ProcessId === gate.ppid)?.Name, 'bash.exe');
    process.kill(gate.ppid);
  }
  await pause(16200);
  context.diagnostic(
    JSON.stringify({
      gateAlive: alive(gate.pid),
      watcherAlive: alive(watcher),
      monitorAlive: alive(monitor.child.pid),
      heartbeatAdvanced: setup.heartbeat().t > firstHeartbeat,
    }),
  );
  assert.equal(alive(gate.pid), true, 'default two-quiet-tick threshold must not stop live input');
  assert.equal(alive(watcher), true);
  assert.equal(alive(monitor.child.pid), true);
  assert.ok(setup.heartbeat().t > firstHeartbeat);
  monitor.child.kill();
  await until(() => !alive(gate.pid), 'gate stops when its real Monitor lease is gone');
  await until(() => !alive(watcher), 'real fmwatch stops when its Monitor lease is gone');
  assert.match(events(setup).find(event => event.pid === gate.pid).reason, /^lease (parent gone|expired|removed)$/);
});

for (const arrangement of ['documented', 'wrapper', 'documented-parent-exit', 'wrapper-parent-exit']) {
  test('quiet leased Git Bash pipeline survives its intermediate parent: ' + arrangement, async context => {
    if (arrangement.endsWith('parent-exit') && process.platform !== 'win32') {
      context.skip('native Windows keeps the recorded Windows parent after its shell exits');
      return;
    }
    const setup = fixture(context);
    const monitor = setup.monitor(arrangement);
    const gate = await setup.gate('mixed');
    await until(() => monitor.output().includes('watcher ready'), 'initial watcher line');
    const watcher = json(path.join(setup.home, 'watcher.json'));
    const leasePath = path.join(setup.home, setup.leaseFile());
    const firstExpiry = json(leasePath).expires;
    const tree = setup.tree([monitor.child.pid, gate.pid, gate.ppid, watcher.pid, watcher.ppid]);
    context.diagnostic(JSON.stringify(tree));
    const wrapper = tree.find(row => row.ProcessId === gate.ppid)?.ParentProcessId || gate.ppid;
    if (arrangement.endsWith('parent-exit')) {
      assert.notEqual(gate.ppid, watcher.ppid, 'the gate has its own Git Bash exec intermediary');
      assert.notEqual(gate.ppid, monitor.child.pid);
      process.kill(gate.ppid);
      await until(() => !alive(gate.ppid), 'intermediate shell exits');
    }
    await pause(850);
    await until(() => json(leasePath)?.expires > firstExpiry, 'lease renews after quiet ticks', 3000);
    const observation = {
      platform: process.platform,
      arrangement,
      gate: gate.pid,
      parent: gate.ppid,
      parentAlive: alive(gate.ppid),
      gateAlive: alive(gate.pid),
      watcherAlive: alive(watcher.pid),
      wrapperAlive: alive(wrapper),
      monitorAlive: alive(monitor.child.pid),
      renewed: json(leasePath)?.expires > firstExpiry,
      output: monitor.output().trim(),
    };
    context.diagnostic(JSON.stringify(observation));
    assert.equal(observation.monitorAlive, true);
    assert.equal(observation.watcherAlive, true);
    assert.equal(observation.renewed, true);
    assert.equal(observation.gateAlive, true, 'a dead intermediate parent is not end of input');
    setup.write('emit', 'go');
    await until(() => monitor.output().includes('later decision'), 'decision after quiet ticks');
    setup.write('end-input', 'go');
    await until(() => monitor.child.exitCode !== null, 'pipeline exits after EOF');
    if (!arrangement.endsWith('parent-exit')) assert.equal(monitor.child.exitCode, 0, monitor.errors());
    await until(() => !alive(gate.pid), 'gate exits after actual EOF');
  });
}

test('EOF drains queued input, announces one stop and unregisters', async context => {
  const setup = fixture(context);
  const running = direct(setup);
  const gate = await setup.gate('mixed');
  running.child.stdin.end('Owner (general): final decision\n');
  await exited(running);
  assert.equal(running.child.exitCode, 0, running.errors());
  assert.match(running.output(), /^Owner \(general\): final decision\nGATE \| mixed stopped: input ended;[^\n]+\n$/);
  assert.deepEqual(
    events(setup).map(event => [event.pid, event.reason, event.code]),
    [[gate.pid, 'input ended', 0]],
  );
  assert.deepEqual(setup.registry(), {});
});

test('same-source replacement notifies the old Monitor before taking over', async context => {
  const setup = fixture(context);
  const previous = direct(setup);
  const gate = await setup.gate('mixed');
  previous.child.stdin.write('Owner (general): previous ready\n');
  await until(() => previous.output().includes('previous ready'), 'previous gate is reading');
  setup.write(
    'registry-sharing.cjs',
    [
      'const fs = require("node:fs"); const rename = fs.renameSync; let failed = false;',
      'fs.renameSync = function(from, to) {',
      '  if (!failed && String(to).endsWith("gate-pids.json")) {',
      '    failed = true; throw Object.assign(new Error("fixture registry sharing"), {code:"EPERM"});',
      '  }',
      '  return rename.call(this, from, to);',
      '};',
    ].join('\n'),
  );
  const next = direct(setup, 'mixed', [], {
    NODE_OPTIONS: '--require ' + JSON.stringify(path.join(setup.home, 'registry-sharing.cjs')),
  });
  await until(() => setup.registry()[next.child.pid], 'replacement registers');
  await exited(previous);
  assert.match(previous.output(), /\nGATE \| mixed stopped: replaced by same source;[^\n]+\n$/);
  assert.match(previous.output(), /newer gate owns this source; no action\n$/);
  assert.equal(events(setup).filter(event => event.pid === gate.pid).length, 1);
  assert.equal(next.output(), '');
  next.child.stdin.end('Owner (general): next ready\n');
  await exited(next);
  assert.match(next.output(), /next ready\nGATE \| mixed stopped: input ended;/);
});

for (const outcome of ['timeout', 'requester-exit']) {
  test('an abandoned replacement leaves the previous gate running: ' + outcome, async context => {
    const setup = fixture(context);
    setup.write(
      'pause-gate.cjs',
      [
        'const fs = require("node:fs");',
        'const sleeper = new Int32Array(new SharedArrayBuffer(4));',
        'setInterval(() => {',
        '  if (!fs.existsSync("pause-gate")) return;',
        '  fs.unlinkSync("pause-gate"); fs.writeFileSync("gate-paused", "ready");',
        '  while (!fs.existsSync("resume-gate")) Atomics.wait(sleeper, 0, 0, 20);',
        '}, 10);',
      ].join('\n'),
    );
    const previous = direct(setup, 'mixed', [], {
      NODE_OPTIONS: '--require ' + JSON.stringify(path.join(setup.home, 'pause-gate.cjs')),
    });
    const gate = await setup.gate('mixed');
    setup.write('pause-gate', 'go');
    try {
      await until(() => read(path.join(setup.home, 'gate-paused')), 'previous gate blocks its event loop');
      const next = direct(setup);
      await until(() => setup.registry()[gate.pid]?.stop, 'replacement publishes its stop request');
      if (outcome === 'timeout') {
        await exited(next);
        assert.equal(next.child.exitCode, 1);
        assert.match(next.output(), /previous gate did not exit;/);
        assert.equal(setup.registry()[gate.pid].stop, undefined, 'refusal retracts its own request');
      } else {
        next.child.kill('SIGKILL');
        await until(
          () => next.child.exitCode !== null || next.child.signalCode !== null,
          'requester exits before completing handoff',
        );
      }
    } finally {
      setup.write('resume-gate', 'go');
    }
    await pause(350);
    assert.equal(previous.child.exitCode, null, 'an abandoned request must not stop the surviving gate');
    assert.equal(alive(gate.pid), true);
    previous.child.stdin.end('Owner (general): decision after refused replacement\n');
    await exited(previous);
    assert.match(previous.output(), /decision after refused replacement\nGATE \| mixed stopped: input ended;/);
    assert.equal(events(setup).find(event => event.pid === gate.pid).reason, 'input ended');
  });
}

test('another source does not revoke a gate with a dead recorded shell', async context => {
  const setup = fixture(context);
  const previous = direct(setup, 'mixed', ['--tick-ms', '60000']);
  const gate = await setup.gate('mixed');
  const registry = setup.registry();
  registry[gate.pid].ppid = 2147483647;
  setup.write('gate-pids.json', JSON.stringify(registry));
  const next = direct(setup, 'fmwatch');
  await setup.gate('fmwatch');
  assert.equal(alive(gate.pid), true, 'only the same source can replace its gate');
  previous.child.stdin.end();
  next.child.stdin.end();
  await Promise.all([exited(previous), exited(next)]);
});

test('an uncooperative previous gate is not silently force-killed', async context => {
  const setup = fixture(context);
  setup.write('uncooperative.cjs', 'setInterval(() => {}, 1000);\n');
  const previous = setup.start(process.execPath, ['uncooperative.cjs']);
  setup.write('gate-pids.json', JSON.stringify({ [previous.child.pid]: { source: 'mixed', ppid: process.pid } }));
  const next = direct(setup);
  await exited(next);
  assert.equal(next.child.exitCode, 1);
  assert.equal(alive(previous.child.pid), true);
  assert.match(next.output(), /^GATE \| mixed stopped: cannot replace previous gate: previous gate did not exit;/);
  assert.match(next.output(), /stop old Monitor; run bash shift.sh kill-watchers; then re-arm\n$/);
  assert.equal(events(setup)[0].pid, next.child.pid);
});

test('a lost lease journals in the gate home with exactly one shared stdout diagnostic', async context => {
  const setup = fixture(context);
  const leasePath = path.join(setup.home, 'fixture-lease.json');
  const lease = { token: 'fixture', pid: process.pid, parents: [process.pid], expires: Date.now() + 60000 };
  setup.write('fixture-lease.json', JSON.stringify(lease));
  const running = direct(setup, 'mixed', [], {
    LH_MONITOR_LEASE: leasePath,
    LH_MONITOR_LEASE_TOKEN: 'fixture',
  });
  const gate = await setup.gate('mixed');
  setup.write('fixture-lease.json', JSON.stringify({ ...lease, expires: 0 }));
  await exited(running);
  assert.match(running.output(), /^WATCH LEASE \| gate.cjs \[fixture-lease.json\] stopped: expired;[^\n]+\n$/);
  assert.deepEqual(
    events(setup).map(event => [event.pid, event.reason]),
    [[gate.pid, 'lease expired']],
  );
  assert.deepEqual(setup.registry(), {});
});

test('startup failures are visible even in off mode', async context => {
  const setup = fixture(context);
  const hash = require('node:crypto').createHash('sha256').update('mixed').digest('hex').slice(0, 16);
  setup.write('gate-input-' + hash + '.json', '{}');
  const running = direct(setup);
  await exited(running);
  assert.equal(running.child.exitCode, 1);
  assert.match(running.output(), /^GATE \| mixed stopped: startup failed;[^\n]+\n$/);
  assert.equal(events(setup)[0].reason, 'startup failed; inspect input journal and gate home before re-arm');
});

test('a failed input journal stops visibly without acknowledging its input', async context => {
  const setup = fixture(context);
  const hash = require('node:crypto').createHash('sha256').update('mixed').digest('hex').slice(0, 16);
  fs.mkdirSync(path.join(setup.home, 'gate-input-' + hash + '.json.tmp'));
  const running = direct(setup);
  await setup.gate('mixed');
  running.child.stdin.write('Owner (general): cannot persist\n');
  await exited(running);
  assert.equal(running.child.exitCode, 1);
  assert.match(running.output(), /^GATE \| mixed stopped: cannot save pending input;[^\n]+\n$/);
  assert.equal(events(setup)[0].reason, 'cannot save pending input');
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  test('handled ' + signal + ' is visible and journalled', async context => {
    if (process.platform === 'win32') {
      context.skip('Windows process.kill forcibly terminates Node without signal handlers');
      return;
    }
    const setup = fixture(context);
    const running = direct(setup);
    await setup.gate('mixed');
    running.child.kill(signal);
    await exited(running);
    assert.match(running.output(), new RegExp('^GATE \\| mixed stopped: signal ' + signal + ';[^\\n]+\\n$'));
    assert.equal(events(setup)[0].reason, 'signal ' + signal);
  });
}
