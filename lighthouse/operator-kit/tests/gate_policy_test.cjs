'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { ownRelay, relayEvidence, quietRule, patterns } = require('../scripts/gate-policy.cjs');
const { replay } = require('../scripts/gate-replay.cjs');
const table = require('../scripts/gate-rules.json');
const fixture = require('./fixtures/quiet-lines.json');

test('own relay evidence is exact, recent, successful, target-specific and used once', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-evidence-'));
  const now = Date.now();
  const text = 'Please use the August\ncomparison package.';
  const hash = require('node:crypto')
    .createHash('md5')
    .update('firstmate:' + text)
    .digest('hex')
    .slice(0, 12);
  try {
    const time = new Date(now - 1000)
      .toISOString()
      .replace('T', ' ')
      .replace(/\.\d+Z$/, ' UTC');
    fs.writeFileSync(path.join(home, 'relay-last.txt'), text + '\n');
    fs.writeFileSync(path.join(home, 'relay-ledger.tsv'), time + '\t' + hash + '\tsteward\tfixture\n');
    const line = 'FM INPUT 10:00 | Please use the August comparison package. [key input:echo]';
    assert.equal(ownRelay(line, relayEvidence(home), {}, now), null);
    fs.writeFileSync(path.join(home, 'relay-ledger.tsv'), time + '\t' + hash + '\tfirstmate\tfixture\n');
    const evidence = relayEvidence(home);
    const identity = ownRelay(line, evidence, {}, now);
    assert.ok(identity);
    assert.equal(ownRelay(line, evidence, { [identity]: now }, now), null);
    assert.equal(ownRelay(line, evidence, {}, now + 31 * 60000), null);
    assert.equal(ownRelay(line + ' and more', evidence, {}, now), null);
    assert.equal(ownRelay(line.replace('package.', 'package!'), evidence, {}, now), null);
    fs.unlinkSync(path.join(home, 'relay-ledger.tsv'));
    assert.equal(ownRelay(line, relayEvidence(home), {}, now), null, 'unconfirmed sends never hide input');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('proven requests are input echoes, while firstmate asks and full PR replies remain visible', () => {
  const rules = { quietDrop: patterns(table.quietDrop) };
  for (const text of ['Please use the package.', 'Can you use the package?', 'Send me the summary.']) {
    const input = 'FM INPUT 10:00 | ' + text + ' [key input:fixture]';
    assert.equal(quietRule(input, rules, 'proven').decision, 'drop');
    assert.equal(quietRule(input, rules, null).decision, 'wake');
    assert.equal(quietRule(input.replace('FM INPUT', 'FM REPLY'), rules, null).decision, 'wake');
  }
  const reply = 'FM REPLY 10:00 | Compared example/sample/board PR #48 with the complete package.';
  assert.equal(quietRule(reply, rules, null), null);
});

test('Signal and Sample replay fixtures preserve danger, asks and instrument faults', () => {
  for (const [name, lines] of Object.entries(fixture)) {
    const records = lines.map((line, index) => ({
      line,
      mode: 'hold',
      effective: 'hold',
      decision: 'wake',
      t: new Date(Date.UTC(2026, 10, 9, 12, index)).toISOString(),
    }));
    const hash = require('node:crypto')
      .createHash('md5')
      .update('firstmate:Use the fixture package.')
      .digest('hex')
      .slice(0, 12);
    const result = replay(records, table, [{ id: 'fixture', at: Date.UTC(2026, 10, 9, 11, 59), hash }]);
    assert.ok(result.kinds['FM TASK'].afterWakes < result.kinds['FM TASK'].beforeWakes, name);
    assert.equal(result.kinds['FM WAITING'].afterWakes, 1, name);
    assert.equal(result.kinds['LIGHTHOUSE ALERT'].afterWakes, 1, name);
    assert.equal(result.kinds['RECORD CHECK'].afterWakes, 1, 'record faults still wake');
    assert.equal(result.kinds['RECORD CHECK'].afterDigest, 1, 'ordinary records wait');
    assert.equal(result.kinds['FM INPUT'].afterWakes, 1, 'unproven input is always kept');
    assert.equal(result.kinds['FM INPUT'].beforeWakes, 2, 'the proven own echo is the only input removed');
    if (name === 'Signal') assert.equal(result.kinds['FM TASK'].afterWakes, 1, 'production always wakes');
  }
});

test('replay prints counts only, writes nothing and cannot reach Jev or the board', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'replay-'));
  const file = path.join(home, 'gate-log.jsonl');
  try {
    const records = fixture.Signal.map(line => ({
      line: line + ' PRIVATE',
      mode: 'shadow',
      decision: 'wake',
      t: '2026-11-09T12:00:00Z',
    }));
    const bytes = records.map(record => JSON.stringify(record)).join('\n') + '\n';
    fs.writeFileSync(file, bytes);
    const before = fs.statSync(file).mtimeMs;
    const run = spawnSync(process.execPath, [path.join(__dirname, '../scripts/gate-replay.cjs'), file], {
      encoding: 'utf8',
      env: { ...process.env, GATE_JEV_URL: 'http://127.0.0.1:1' },
    });
    assert.equal(run.status, 0, run.stderr);
    assert.ok(JSON.parse(run.stdout).kinds);
    assert.ok(!run.stdout.includes('PRIVATE'));
    assert.ok(!run.stdout.includes(home));
    assert.equal(fs.statSync(file).mtimeMs, before);
    assert.equal(fs.readFileSync(file, 'utf8'), bytes);
    assert.deepEqual(fs.readdirSync(home), ['gate-log.jsonl']);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('replay retains ambiguous legacy truncation and mode bypasses', () => {
  const prefix = 'FM TASK 10:00 | item | working: ';
  const records = [
    { line: prefix.padEnd(600, 'x'), mode: 'hold' },
    { line: prefix + 'a comparison', mode: 'off' },
    { line: prefix + 'a comparison', mode: 'observe' },
    { line: prefix + 'a comparison', mode: 'hold', effective: 'off' },
    { line: prefix + 'a comparison', mode: 'rules' },
  ].map(record => ({ t: '2026-11-09T12:00:00Z', decision: 'wake', ...record }));
  const counts = replay(records, table).kinds['FM TASK'];
  assert.equal(counts.beforeWakes, 5);
  assert.equal(counts.afterWakes, 4);
  assert.equal(counts.afterDrops, 1);
});
