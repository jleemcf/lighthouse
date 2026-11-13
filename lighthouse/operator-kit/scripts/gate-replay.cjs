'use strict';
const fs = require('node:fs');
const path = require('node:path');
const quiet = require('./gate-policy.cjs');

function replay(records, table, evidence = []) {
  const rules = {
    wake: new RegExp(table.wake.map(word => '\\b(?:' + word + ')\\b').join('|'), 'i'),
    instrument: new RegExp(table.instrument.join('|')),
    quietDrop: quiet.patterns(table.quietDrop),
    digest: quiet.patterns(table.digest),
  };
  const consumed = {};
  const kinds = {};
  let pending = [];
  let digestWakes = 0;
  for (const record of records) {
    if (typeof record.line !== 'string' || !['wake', 'pass', 'drop', 'hold'].includes(record.decision)) continue;
    const now = Date.parse(record.t);
    const kind =
      '^(FM (?:INPUT|TASK|REPLY|WAITING|WAKE)|RECORD CHECK|' +
      'LIGHTHOUSE (?:ok|ALERT|fleet|DECISION)|STEWARD WATCH|BOARD WATCH|GATE)';
    const label = record.line.match(new RegExp(kind))?.[1] || 'other';
    const counts = (kinds[label] ||= {
      lines: 0,
      beforeWakes: 0,
      afterWakes: 0,
      beforeDigest: 0,
      afterDigest: 0,
      beforeDrops: 0,
      afterDrops: 0,
    });
    counts.lines++;
    if (['wake', 'pass'].includes(record.decision)) counts.beforeWakes++;
    if (record.decision === 'hold') counts.beforeDigest++;
    if (record.decision === 'drop') counts.beforeDrops++;
    if (pending.length && now - pending[0] >= 30 * 60000) {
      digestWakes++;
      pending = [];
    }
    const relay = quiet.ownRelay(record.line, evidence, consumed, now);
    const guard = record.source === 'route' || rules.wake.test(quiet.dangerText(record.line));
    const rule = guard ? { decision: 'wake' } : quiet.quietRule(record.line, rules, relay);
    const bypass =
      record.mode === 'off' || record.mode === 'observe' || record.effective === 'off' || record.line.length === 600;
    const decision = bypass ? record.decision : rule?.decision || record.decision;
    if (!bypass && rule?.relay) consumed[rule.relay] = now;
    if (['wake', 'pass'].includes(decision)) {
      counts.afterWakes++;
      pending = [];
    } else if (decision === 'hold') {
      counts.afterDigest++;
      if (rule?.decision === 'hold') pending.push(now);
    } else counts.afterDrops++;
  }
  if (pending.length) digestWakes++;
  return { kinds, digestOnlyWakes: digestWakes };
}

module.exports = { replay };
if (require.main === module) {
  try {
    const file = process.argv[2];
    if (!file) throw new Error('log required');
    const home = process.argv[3] === '--home' ? process.argv[4] : path.dirname(file);
    const records = fs
      .readFileSync(file, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map(line => JSON.parse(line));
    const table = JSON.parse(fs.readFileSync(path.join(__dirname, 'gate-rules.json'), 'utf8'));
    let local = {};
    try {
      local = JSON.parse(fs.readFileSync(path.join(home, 'gate-rules.local.json'), 'utf8'));
    } catch {}
    for (const field of ['wake', 'instrument']) table[field] = table[field].concat(local[field] || []);
    for (const field of ['quietDrop', 'digest']) Object.assign(table[field], local[field] || {});
    process.stdout.write(JSON.stringify(replay(records, table, quiet.relayEvidence(home)), null, 2) + '\n');
  } catch {
    process.stderr.write('Replay refused: provide a readable complete JSONL log; no files were changed.\n');
    process.exitCode = 1;
  }
}
