// The wake gate, end to end against a fake Jev: node --test lighthouse/operator-kit/tests/gate_test.cjs
'use strict';
const test = require('node:test'),
  assert = require('node:assert'),
  http = require('http'),
  fs = require('fs'),
  os = require('os'),
  path = require('path'),
  { spawn } = require('child_process');
const GATE = path.join(__dirname, '..', 'scripts', 'gate.cjs');

// The fake Jev answers by markers in the event line. The gate's shape rule strips a trailing "[key ...]" tag, so a
// marker placed in the key varies the verdict without changing the line's shape: ROUTINE, PROG (new progress), DUP
// (repeated progress), UNSURE (low confidence), BOOM (a 500), SLOW (later than the timeout); anything else needs
// attention.
function fakeJev() {
  return new Promise(resolve => {
    const calls = [];
    const srv = http.createServer((req, res) => {
      let d = '';
      req.on('data', c => (d += c));
      req.on('end', () => {
        const body = JSON.parse(d),
          ev = body.state.event;
        calls.push(body);
        const answer = v => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ model: 'fake', answers: v, usage: {} }));
        };
        const kind = (choice, confidence) => ({ type: 'choice', choice, confidence, probabilities: {} }),
          noul = n => ({ type: 'noul', noul: n });
        if (/BOOM/.test(ev)) {
          res.writeHead(500);
          return res.end('no');
        }
        if (/SLOW/.test(ev))
          return setTimeout(
            () => answer({ attention: noul(0.1), repeat: noul(0.9), kind: kind('routine', 0.95) }),
            700,
          );
        if (/UNSURE/.test(ev)) return answer({ attention: noul(0.2), repeat: noul(0.5), kind: kind('routine', 0.4) });
        if (/DUP/.test(ev)) return answer({ attention: noul(0.1), repeat: noul(0.9), kind: kind('progress', 0.9) });
        if (/PROG/.test(ev)) return answer({ attention: noul(0.1), repeat: noul(0.1), kind: kind('progress', 0.9) });
        if (/ROUTINE/.test(ev))
          return answer({ attention: noul(0.05), repeat: noul(0.9), kind: kind('routine', 0.95) });
        answer({ attention: noul(0.9), repeat: noul(0.1), kind: kind('needs_attention_now', 0.9) });
      });
    });
    srv.listen(0, '127.0.0.1', () =>
      resolve({ url: `http://127.0.0.1:${srv.address().port}/v1/systemone`, close: () => srv.close(), calls }),
    );
  });
}
function startGate(home, jevUrl, extra, preload) {
  const args = [
    GATE,
    '--server',
    'http://127.0.0.1:1',
    '--board',
    't',
    '--mode',
    'hold',
    '--tick-ms',
    '50',
    '--flush-minutes',
    '0.02',
    '--flush-lines',
    '5',
    '--repeat-n',
    '3',
    '--repeat-minutes',
    '1',
    '--jev-timeout-ms',
    '250',
    '--release-minutes',
    '0.05',
  ].concat(extra || []);
  const p = spawn(process.execPath, (preload ? ['--require', preload] : []).concat(args), {
    env: Object.assign({}, process.env, { GATE_HOME: home, GATE_JEV_URL: jevUrl, TYPESAFE_API_KEY: 'test-key' }),
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const outp = { text: '', err: '' };
  p.stdout.on('data', c => (outp.text += c));
  p.stderr.on('data', c => (outp.err += c));
  const send = l => p.stdin.write(l + '\n');
  const until = (pred, ms = 2000) =>
    new Promise((res, rej) => {
      const t0 = Date.now();
      (function poll() {
        if (pred(outp.text)) return res(outp.text);
        if (Date.now() - t0 > ms)
          return rej(
            new Error('timed out waiting; output so far:\n' + outp.text + (outp.err ? '\nstderr:\n' + outp.err : '')),
          );
        setTimeout(poll, 20);
      })();
    });
  const quiet = ms => new Promise(res => setTimeout(res, ms));
  const lines = () => outp.text.split('\n').filter(Boolean);
  return {
    p,
    send,
    until,
    quiet,
    lines,
    outp,
    stop: () =>
      new Promise(res => {
        p.on('exit', res);
        p.stdin.end();
      }),
  };
}
const logOf = home =>
  fs
    .readFileSync(path.join(home, 'gate-log.jsonl'), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map(s => JSON.parse(s));
// one shape, many lines
const R = (n, marker) =>
  `FM INFO 10:${String(n).padStart(2, '0')} | ROUTINE ping alpha ${n} [key input:${marker || n}]`;
test('coordinator notices always wake even with quiet overrides and a repeated shape', async () => {
  const jev = await fakeJev();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'coordinator-gate-'));
  const line = 'NOTICE from coordinator (coordinator, not the owner) | ROUTINE ping';
  fs.writeFileSync(path.join(home, 'gate-rules.local.json'), JSON.stringify({ quietDrop: { notice: '^NOTICE' } }));
  const gate = startGate(home, jev.url);
  try {
    gate.send(line);
    gate.send(line);
    await gate.until(text => text.split(line).length === 3);
    assert.equal(jev.calls.length, 0);
    assert.equal(logOf(home).filter(row => row.source === 'route' && row.decision === 'wake').length, 2);
  } finally {
    await gate.stop();
    jev.close();
    fs.rmSync(home, { recursive: true, force: true });
  }
});

for (const mode of ['rules', 'shadow', 'hold', 'observe', 'off']) {
  test('quiet rules: own echoes only, routine records and asks in ' + mode, async () => {
    const jev = await fakeJev();
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'quiet-gate-'));
    const text = 'Please use the August comparison package. Can you send me the summary?';
    const hash = require('node:crypto')
      .createHash('md5')
      .update('firstmate:' + text)
      .digest('hex')
      .slice(0, 12);
    fs.writeFileSync(
      path.join(home, 'relay-ledger.tsv'),
      new Date().toISOString() + '\t' + hash + '\tfirstmate\t' + text + '\n',
    );
    fs.writeFileSync(path.join(home, 'relay-last.txt'), text + '\n');
    const gate = startGate(home, jev.url, ['--mode', mode, '--flush-minutes', '30']);
    const quietLines = [
      'FM INPUT 10:00 | ' + text + ' [key input:echo]',
      'FM TASK 10:00 | signal-item | working: comparing files [key task:working]',
      'FM TASK 10:01 | sample-item | paused: lunch [key task:paused]',
      'FM TASK 10:02 | sample-item | resolved: finished [key task:resolved]',
      "LIGHTHOUSE ok | firstmate's question is answered",
      'FM TASK 10:03 | board | example/sample/board PR #48 merged [key task:board]',
    ];
    const digest = [
      'RECORD CHECK | signal-item | in flight | no status line | on board: yes',
      'RECORD CHECK | 1 changed of 2 items',
      'LIGHTHOUSE ok | fleet lock re-acquired',
    ];
    try {
      for (const line of quietLines.concat(digest)) gate.send(line);
      await gate.quiet(300);
      if (['observe', 'off'].includes(mode)) {
        for (const line of quietLines.concat(digest)) assert.ok(gate.lines().includes(line));
      } else {
        assert.deepEqual(gate.lines(), [], 'first appearances are quiet too');
        const log = logOf(home);
        assert.equal(log.filter(row => row.decision === 'drop').length, quietLines.length);
        assert.equal(log.filter(row => row.decision === 'hold').length, digest.length);
        assert.deepEqual(
          log.filter(row => row.decision === 'hold').map(row => row.line),
          digest,
        );
      }
      gate.send('FM INPUT 10:04 | ' + text + ' [key input:human-repeat]');
      gate.send('FM INPUT 10:05 | A new direction typed here. [key input:human]');
      await gate.until(output => output.includes('[key input:human]'));
      assert.ok(
        gate.lines().some(line => line.includes('[key input:human-repeat]')),
        'a proven relay is consumed once, not every matching human input',
      );
      if (!['observe', 'off'].includes(mode)) {
        const lines = gate.lines();
        assert.deepEqual(lines.slice(0, digest.length), digest, 'digest is printed whole before the next wake');
      }
      const guards = [
        'FM TASK 10:06 | item | resolved: production is deploying',
        'FM TASK 10:06 | item | paused: error reading file',
        'FM WAITING 10:06 | firstmate is waiting [key waiting:1]',
        'FM REPLY 10:06 | asks you: send the package [key reply:ask]',
        'RECORD CHECK | board unreadable: access denied',
        'LIGHTHOUSE ALERT | GATE BLIND',
        'FM TASK 10:07 | board | example/sample/board PR #48 blocked',
        'FM TASK 10:08 | board | working: needs your go-ahead',
        'FM TASK 10:08 | board | resolved: still waiting on the package id',
        'FM TASK 10:08 | board | paused: send me the comparison',
        'FM TASK 10:08 | board | working: upload the bundle for me',
        'FM TASK 10:08 | board | working: needs you to confirm your call',
        'COLLECTOR | write your pickup note: context has passed 85% of the compaction window',
      ];
      for (const line of guards) gate.send(line);
      await gate.until(output => output.includes('write your pickup note'));
      for (const line of guards) assert.ok(gate.lines().includes(line), line);
      assert.equal(jev.calls.length, 0, 'quiet rules and guards never call Jev');
    } finally {
      await gate.stop();
      jev.close();
      fs.rmSync(home, { recursive: true, force: true });
    }
  });
}

test('saved routine replies still reach Jev and hold instead of waking as claims', async () => {
  const jev = await fakeJev();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'routine-reply-'));
  const gate = startGate(home, jev.url, ['--flush-minutes', '30']);
  try {
    for (const reply of ['shipshape', 'all clear', 'nothing needed']) {
      const prefix = 'FM REPLY 10:00 | ' + reply + ' [exact text saved: C:/fixture/fm-replies/a.txt]';
      gate.send(prefix + ' [key reply:warm]');
      await gate.until(output => output.includes(prefix));
      const held = prefix + ' [key reply:ROUTINE]';
      gate.send(held);
      await gate.quiet(300);
      assert.ok(logOf(home).some(row => row.line === held && row.decision === 'hold'));
      assert.ok(!gate.lines().includes(held));
    }
    assert.equal(jev.calls.length, 3);
  } finally {
    await gate.stop();
    jev.close();
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('rule digests flush on the clock in rules and shadow, without a Jev call', async () => {
  for (const mode of ['rules', 'shadow', 'hold']) {
    const jev = await fakeJev();
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'digest-gate-'));
    const gate = startGate(home, jev.url, ['--mode', mode, '--flush-minutes', '0.001']);
    try {
      gate.send('RECORD CHECK | item | queued | on board: yes');
      await gate.until(output => output.includes('minutes passed'));
      assert.equal(gate.lines()[0], 'RECORD CHECK | item | queued | on board: yes');
      assert.equal(jev.calls.length, 0);
      assert.equal(logOf(home)[0].decision, 'hold');
    } finally {
      await gate.stop();
      jev.close();
      fs.rmSync(home, { recursive: true, force: true });
    }
  }
});

test('restarted rule digests keep the 30-minute ceiling even with a longer Jev timer', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-deadline-'));
  const line = 'RECORD CHECK | item | queued | on board: yes';
  fs.writeFileSync(
    path.join(home, 'digest.txt'),
    JSON.stringify({ t: Date.now() - 31 * 60000, line, ruleDigest: true }) + '\n',
  );
  const gate = startGate(home, 'http://127.0.0.1:1', ['--mode', 'rules', '--flush-minutes', '600']);
  try {
    await gate.until(output => output.includes(line));
    assert.equal(gate.lines()[0], line);
    assert.equal(fs.readFileSync(path.join(home, 'digest.txt'), 'utf8'), '');
    assert.equal(logOf(home)[0].kind, 'flush');
  } finally {
    await gate.stop();
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('same-source gates in separate temporary homes cannot replace each other', async () => {
  const homes = Array.from({ length: 2 }, () => fs.mkdtempSync(path.join(os.tmpdir(), 'gate-isolated-')));
  const gates = [];
  try {
    for (const home of homes) {
      const gate = startGate(home, 'http://127.0.0.1:1', ['--source', 'mixed', '--mode', 'off']);
      gates.push(gate);
      gate.send('BOARD | ready');
      await gate.until(text => text.includes('BOARD | ready'));
    }
    for (const [index, gate] of gates.entries()) {
      gate.send('BOARD | still running');
      await gate.until(text => text.includes('BOARD | still running'));
      const registry = JSON.parse(fs.readFileSync(path.join(homes[index], 'gate-pids.json'), 'utf8'));
      assert.deepEqual(Object.keys(registry), [String(gate.p.pid)]);
      assert.equal(registry[gate.p.pid].home, homes[index]);
      assert.equal(gate.p.exitCode, null);
    }
  } finally {
    const running = gates.filter(gate => gate.p.exitCode === null && gate.p.signalCode === null);
    await Promise.all(running.map(gate => gate.stop()));
    for (const home of homes) fs.rmSync(home, { recursive: true, force: true });
  }
});

test('an unconfigured gate always passes the shared default owner label', async () => {
  const jev = await fakeJev();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'default-owner-gate-'));
  const gate = startGate(home, jev.url);
  try {
    gate.send('the captain (general): hello');
    await gate.until(text => text.includes('the captain (general): hello'));
    gate.send('the captain (general): hello');
    await gate.until(() => gate.lines().filter(line => line.includes('(general): hello')).length === 2);
    assert.equal(jev.calls.length, 0);
    const records = logOf(home).filter(record => record.line.includes('(general): hello'));
    assert.equal(records.length, 2);
    assert.ok(records.every(record => record.source === 'route' && record.decision === 'wake'));
  } finally {
    await gate.stop();
    jev.close();
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('the wake gate: rules first, Jev second, nothing lost', async () => {
  const jev = await fakeJev();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-'));
  fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ ownerName: 'Captain Example' }));
  const g = startGate(home, jev.url);
  try {
    // 0: Owner and the board route always pass
    g.send('Captain Example (general): are you there?');
    await g.until(t => t.includes('Captain Example (general): are you there?'));
    g.send('Captain Example (general): are you there?');
    await g.until(() => g.lines().filter(line => line.includes('are you there?')).length === 2);
    assert.equal(jev.calls.length, 0, 'repeated owner messages never reach the judge');
    // 1: a danger word wakes with no judgment
    const before = jev.calls.length;
    g.send('FM WAKE 10:00 | worker task failed on step 3 [key fmwake:1]');
    await g.until(t => t.includes('worker task failed'));
    assert.equal(jev.calls.length, before, 'a danger word never reaches Jev');
    // 3 then 5: a shape never seen wakes once; the same echo next time is dropped, and logged
    g.send('FM WAKE 10:01 | firstmate woken by its own status file write [key fmwake:2]');
    await g.until(t => t.includes('own status file write'));
    const n1 = g.lines().length;
    g.send('FM WAKE 10:07 | firstmate woken by its own status file write [key fmwake:3]');
    await g.quiet(300);
    assert.equal(g.lines().length, n1, 'the second identical echo is not printed');
    const dropped = logOf(home).find(r => r.decision === 'drop');
    assert.ok(dropped && /echo/.test(dropped.reason), 'the drop is in the log with its reason');
    // 6: a stateful line restating the same state is dropped; a state that changed and changed back is judged
    const rc = s => `FM TASK 10:00 | sample-report-v2 | ${s} | no status line | on board: no`;
    g.send(rc('queued'));
    await g.until(t => t.includes('sample-report-v2 | queued')); // first shape: wakes, state remembered
    const c0 = jev.calls.length;
    g.send(rc('queued'));
    await g.quiet(300);
    assert.equal(jev.calls.length, c0, 'an unchanged record check is dropped before Jev');
    assert.equal(logOf(home).pop().reason, 'unchanged state');
    g.send(rc('in flight'));
    await g.until(t => t.includes('sample-report-v2 | in flight')); // a new shape: wakes by rule
    assert.equal(jev.calls.length, c0);
    g.send(rc('queued'));
    // known shape, changed state: judged (attention -> wake)
    await g.until(t => t.split('sample-report-v2 | queued').length > 2);
    assert.equal(jev.calls.length, c0 + 1, 'a changed state is judged once');
    assert.equal(logOf(home).pop().stage, 'jev');
    // stage 1: routine is held; a later wake flushes it first, verbatim, in order
    g.send(R(10));
    await g.until(t => t.includes('ROUTINE ping alpha 10')); // first shape wakes
    const n2 = g.lines().length;
    g.send(R(11));
    await g.quiet(400);
    assert.equal(g.lines().length, n2, 'a routine line is held, not printed');
    assert.equal(
      JSON.parse(fs.readFileSync(path.join(home, 'digest.txt'), 'utf8').trim().split('\n').pop()).line,
      R(11),
      'the held line is on disk verbatim',
    );
    g.send('STEWARD WATCH | steward finished 10:12 | the branch is pushed');
    await g.until(t => t.includes('steward finished 10:12'));
    const L = g.lines();
    const i = L.findIndex(l => l === R(11));
    assert.ok(
      i >= 0 &&
        /^GATE \| 1 line held since .*flushed because a wake for another reason/.test(L[i + 1]) &&
        L[i + 2].includes('steward finished 10:12'),
      'held line, then the flush line, then the waking line:\n' + L.slice(Math.max(0, i - 1)).join('\n'),
    );
    // new progress wakes; repeated progress is held; low confidence wakes
    g.send(R(13, 'PROG'));
    await g.until(t => t.includes('ROUTINE ping alpha 13'));
    assert.match(logOf(home).pop().reason, /new progress/);
    const n3 = g.lines().length;
    g.send(R(14, 'DUP'));
    await g.quiet(400);
    assert.equal(g.lines().length, n3, 'repeated progress is held');
    assert.match(logOf(home).pop().reason, /repeated progress/);
    g.send(R(15, 'UNSURE'));
    await g.until(t => t.includes('ROUTINE ping alpha 15'));
    assert.match(logOf(home).pop().reason, /confidence/);
    // repetition escalates: the third routine hold of one shape inside the window flushes, before the clock would
    g.send(R(16));
    await g.quiet(120);
    g.send(R(17));
    await g.quiet(120);
    g.send(R(18));
    await g.until(t => /flushed because repetition/.test(t), 3000);
    // the clock flushes a lone held line
    g.send(R(20));
    await g.until(t => /flushed because 0\.02 minutes passed/.test(t), 4000);
    // fail-open: a 500 and a timeout both wake the line and say so once
    g.send(R(21, 'BOOM'));
    await g.until(t => t.includes('ROUTINE ping alpha 21') && t.includes('GATE | fail-open: Jev answered 500'));
    g.send(R(22, 'SLOW'));
    await g.until(t => t.includes('ROUTINE ping alpha 22'), 3000);
    assert.equal(
      g.lines().filter(l => l.startsWith('GATE | fail-open')).length,
      1,
      'one fail-open note per ten minutes',
    );
    g.send(R(23));
    await g.until(t => t.includes('GATE | judging again'));
    // the mode file switches live: off passes routine through unjudged; hold holds again
    fs.writeFileSync(path.join(home, 'gate-mode'), 'off\n');
    await g.quiet(150);
    const c1 = jev.calls.length;
    g.send(R(24));
    await g.until(t => t.includes('ROUTINE ping alpha 24'));
    assert.equal(jev.calls.length, c1, 'off mode judges nothing');
    fs.writeFileSync(path.join(home, 'gate-mode'), 'hold\n');
    await g.quiet(150);
    const n4 = g.lines().length;
    g.send(R(25));
    await g.quiet(400);
    assert.equal(g.lines().length, n4, 'hold mode holds again');
    // a production word alone wakes by rule 1 and opens no window; a production action under way opens the release
    // window: the line wakes, the gate says it is off, routine passes through, then the window closes
    g.send('FM WAKE 10:26 | the worker is asking which database the migration should target [key fmwake:26]');
    await g.until(t => t.includes('which database the migration'));
    assert.match(logOf(home).pop().reason, /^word "migration"$/);
    assert.ok(!/GATE \| off for/.test(g.outp.text), 'no window on the word alone');
    g.send('FM INPUT 10:26 | focused tests 47 passed, no migration; starting validation [key input:126]');
    await g.until(t => t.includes('no migration; starting'));
    assert.ok(!/GATE \| off for/.test(g.outp.text), 'a negated migration opens no window');
    g.send('FM INPUT 10:26 | migration 31 applied on DEV [key input:127]');
    await g.until(t => t.includes('migration 31 applied'));
    assert.ok(!/GATE \| off for/.test(g.outp.text), 'a migration with no production marker opens no window');
    g.send('FM WAKE 10:26 | firstmate is asking whether to do the promotion to Production now? [key fmwake:128]');
    await g.until(t => t.includes('promotion to Production now'));
    assert.ok(!/GATE \| off for/.test(g.outp.text), 'a question about a promotion opens no window');
    g.send('STEWARD WATCH | Owner -> steward 10:26 | Production is release; the plan stands as written.');
    await g.until(t => t.includes('Production is release'));
    assert.ok(!/GATE \| off for/.test(g.outp.text), 'a statement with no action under way opens no window');
    g.send(
      'STEWARD WATCH | steward finished 10:26 | time the report against Production-scale data without changing ' +
        'Development or starting a copied app',
    );
    await g.until(t => t.includes('Production-scale data'));
    assert.ok(!/GATE \| off for/.test(g.outp.text), 'a compound production word and a negated verb open no window');
    g.send('FM INPUT 10:27 | the production deploy of the api service started [key input:27]');
    await g.until(
      t =>
        t.includes('deploy of the api service') &&
        new RegExp(
          /GATE \| off for 0\.05 min: a production action is under way /.source +
            /\("production deploy of the api service started"\)/.source,
        ).test(t),
    );
    g.send(R(27));
    await g.until(t => t.includes('ROUTINE ping alpha 27'));
    await g.until(t => t.includes('GATE | the release window closed'), 5000);
    // the heartbeat carries counts
    const hb = JSON.parse(fs.readFileSync(path.join(home, 'gate-heartbeat.json'), 'utf8'));
    assert.ok(
      hb.judged >= 8 && hb.woke >= 8 && hb.dropped >= 2 && hb.held >= 5 && hb.failed >= 2,
      'heartbeat counts: ' + JSON.stringify(hb),
    );
    assert.equal(hb.mode, 'hold');
  } finally {
    await g.stop();
    jev.close();
  }
});

test('observe mode passes everything through and only records; rules mode drops but never judges', async () => {
  const jev = await fakeJev();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-'));
  fs.writeFileSync(path.join(home, 'gate-mode'), 'observe\n');
  const g = startGate(home, jev.url);
  try {
    g.send(R(1));
    await g.until(t => t.includes('ROUTINE ping alpha 1 '));
    g.send(R(2));
    await g.until(t => t.includes('ROUTINE ping alpha 2 '));
    const r = logOf(home).pop();
    assert.equal(r.decision, 'pass');
    assert.equal(r.would, 'hold');
    assert.equal(r.jev.kind, 'routine');
    fs.writeFileSync(path.join(home, 'gate-mode'), 'rules\n');
    await g.quiet(150);
    const c = jev.calls.length;
    g.send(R(3));
    await g.until(t => t.includes('ROUTINE ping alpha 3 '));
    assert.equal(jev.calls.length, c, 'rules mode sends nothing to Jev');
    g.send('FM WAKE 11:03 | firstmate woken by its own status file write [key fmwake:4]');
    await g.until(t => t.includes('own status file write')); // unseen: wakes
    const n = g.lines().length;
    g.send('FM WAKE 11:04 | firstmate woken by its own status file write [key fmwake:5]');
    await g.quiet(300);
    assert.equal(g.lines().length, n, 'rules mode drops a known echo for real');
    fs.writeFileSync(path.join(home, 'gate-mode'), 'shadow' + String.fromCharCode(10));
    await g.quiet(150);
    const c2 = jev.calls.length;
    g.send(R(5));
    await g.until(t => t.includes('ROUTINE ping alpha 5 '));
    assert.equal(jev.calls.length, c2 + 1, 'shadow mode judges');
    const sr = logOf(home).pop();
    assert.equal(sr.decision, 'pass');
    assert.equal(sr.would, 'hold');
    const n5 = g.lines().length;
    g.send('FM WAKE 11:06 | firstmate woken by its own status file write [key fmwake:6]');
    await g.quiet(300);
    assert.equal(g.lines().length, n5, 'shadow mode drops a known echo for real');
  } finally {
    await g.stop();
    jev.close();
  }
});

test('a digest left by a dead gate is flushed at the next wake', async () => {
  const jev = await fakeJev();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-'));
  fs.writeFileSync(
    path.join(home, 'digest.txt'),
    JSON.stringify({
      id: 'e1',
      t: Date.now() - 60000,
      line: 'FM INPUT 09:00 | ROUTINE left behind [key input:0]',
      source: 'fmwatch',
      shape: 'x',
    }) + '\n',
  );
  const g = startGate(home, jev.url, ['--flush-minutes', '600']);
  try {
    g.send('Owner (direct): status?');
    await g.until(t => t.includes('Owner (direct): status?'));
    const L = g.lines();
    assert.ok(
      L[0].includes('ROUTINE left behind') && /^GATE \| 1 line held/.test(L[1]) && L[2].includes('Owner (direct)'),
      L.join('\n'),
    );
  } finally {
    await g.stop();
    jev.close();
  }
});

test('legacy replacement notices drop before first-shape and instrument rules, while faults still wake', async () => {
  const jev = await fakeJev();
  const notices = [
    'fmwatch.cjs: replaced a leftover copy (pid 4242)',
    'boardwatch.cjs: replaced a leftover copy (pid 4243)',
    'stwatch.cjs: replaced a leftover copy (pid 4244)',
    'gate.cjs: replaced an orphaned gate (pid 4245, source mixed)',
    'LIGHTHOUSE | replaced the previous sweep (pid 4246) that was still running; single instance kept',
  ];
  try {
    for (const mode of ['rules', 'shadow', 'hold', 'observe', 'off']) {
      const home = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-startups-'));
      const gate = startGate(home, jev.url, ['--mode', mode]);
      try {
        for (const notice of notices) gate.send(notice);
        gate.send(notices[0] + '; error: replacement failed');
        await gate.until(text => text.includes('replacement failed'));
        for (const notice of notices) {
          const printed = gate.lines().includes(notice);
          assert.equal(printed, ['off', 'observe'].includes(mode), mode + ': ' + notice);
          if (mode !== 'off') {
            const record = logOf(home).find(entry => entry.line === notice);
            assert.equal(mode === 'observe' ? record.would : record.decision, 'drop');
          }
        }
      } finally {
        await gate.stop();
        fs.rmSync(home, { recursive: true, force: true });
      }
    }
    assert.equal(jev.calls.length, 0, 'routine replacement and instrument faults never need Jev');
  } finally {
    jev.close();
  }
});

test(
  'one gate per source per home: a newcomer with the same source replaces the leftover; ' +
    'a different source coexists',
  async () => {
    const jev = await fakeJev();
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-'));
    const a = startGate(home, jev.url, ['--source', 'mixed', '--mode', 'off']);
    try {
      a.send('Owner (general): a is up');
      await a.until(t => t.includes('a is up'));
      const reg1 = JSON.parse(fs.readFileSync(path.join(home, 'gate-pids.json'), 'utf8'));
      assert.equal(Object.keys(reg1).length, 1, 'a is registered');
      const b = startGate(home, jev.url, ['--source', 'fmwatch', '--mode', 'off']);
      b.send('Owner (general): b is up');
      await b.until(t => t.includes('b is up'));
      const reg2 = JSON.parse(fs.readFileSync(path.join(home, 'gate-pids.json'), 'utf8'));
      assert.equal(Object.keys(reg2).length, 2, 'a different source coexists: ' + JSON.stringify(reg2));
      const exitA = new Promise(res => a.p.on('exit', res));
      const preload = path.join(home, 'pause-announcement.cjs');
      const announced = path.join(home, 'announced');
      fs.writeFileSync(
        preload,
        "const fs = require('node:fs');\n" +
          'const pause = text => { if (!String(text).includes("replaced a leftover gate")) return;\n' +
          'fs.writeFileSync(' +
          JSON.stringify(announced) +
          ', "yes");\n' +
          'Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 150); };\n' +
          'const write = process.stdout.write.bind(process.stdout);\n' +
          'process.stdout.write = (text, ...args) => { const result = write(text, ...args);\n' +
          'pause(text); return result; };\n' +
          'const append = fs.appendFileSync;\n' +
          'fs.appendFileSync = (file, text, ...args) => { const result = append(file, text, ...args);\n' +
          'pause(text); return result; };\n',
      );
      const c = startGate(home, jev.url, ['--source', 'mixed', '--mode', 'off'], preload);
      try {
        await c.until(() => fs.existsSync(announced));
        const reg3 = JSON.parse(fs.readFileSync(path.join(home, 'gate-pids.json'), 'utf8'));
        assert.ok(!(a.p.pid in reg3), 'a is gone from the registry');
        assert.equal(Object.keys(reg3).length, 2, 'b and c remain: ' + JSON.stringify(reg3));
        assert.ok(c.p.pid in reg3, 'the announced replacement is already registered');
        assert.equal(c.outp.text, '', 'the gate logs its own takeover without waking, even in off mode');
        assert.equal(logOf(home).find(record => record.kind === 'startup').decision, 'drop');
        await Promise.race([exitA, new Promise((_, rej) => setTimeout(() => rej(new Error('a did not exit')), 3000))]);
        fs.unlinkSync(path.join(home, 'gate-pids.json'));
        await new Promise(r => setTimeout(r, 250)); // a cleared registry is rebuilt by every live gate within a tick
        const reg4 = JSON.parse(fs.readFileSync(path.join(home, 'gate-pids.json'), 'utf8'));
        assert.equal(Object.keys(reg4).length, 2, 'b and c re-registered: ' + JSON.stringify(reg4));
        await b.stop();
        await c.stop();
        assert.deepEqual(
          JSON.parse(fs.readFileSync(path.join(home, 'gate-pids.json'), 'utf8')),
          {},
          'a clean exit unregisters',
        );
      } finally {
        if (b.p.exitCode === null) b.p.kill();
        if (c.p.exitCode === null) c.p.kill();
      }
    } finally {
      if (a.p.exitCode === null) a.p.kill();
      jev.close();
    }
  },
);
