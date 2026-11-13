'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..', '..', '..');
const source = path.join(root, 'lighthouse', 'server');
const environment = { ...process.env };
delete environment.TYPESAFE_API_KEY;
function run(directory, tests, pattern) {
  const args = ['--test', '--test-reporter=tap'];
  if (pattern) args.push('--test-name-pattern', pattern);
  args.push(...tests);
  return spawnSync(process.execPath, args, {
    cwd: directory,
    env: environment,
    encoding: 'utf8',
    timeout: 30000,
  });
}
const normal = run(root, [
  'lighthouse/server/tests/doorbell-retry.test.js',
  'lighthouse/server/tests/doorbells.test.js',
  'lighthouse/board/tests/doorbells.test.cjs',
]);
process.stdout.write(normal.stdout || '');
process.stderr.write(normal.stderr || '');
assert.equal(normal.status, 0, 'real-code doorbell replays must pass before mutation checks');

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-doorbell-mutation-'));
const variants = [
  {
    name: 'lost-wake',
    pattern: 'NoSilentLostWake: a sole 503',
    before: '      schedule(record);\n    };',
    after: '      if (accepted) schedule(record);\n    };',
    evidence: 'a failed sole wake must retry',
  },
  {
    name: 'invented-revision',
    pattern: 'CoalescingNeverInventsUpdates',
    before: 'const revision = record.revision;',
    after: 'const revision = record.revision + 1;',
    evidence: 'acknowledgment applies only to the revision sent',
  },
  {
    name: 'stale-acknowledgment',
    pattern: 'CoalescingNeverInventsUpdates',
    before: 'record.acknowledged = Math.max(record.acknowledged, revision);',
    after: 'record.acknowledged = Math.max(record.acknowledged, record.revision);',
    evidence: 'expected doorbell reconciliation',
  },
];
try {
  const copy = path.join(scratch, 'server');
  fs.mkdirSync(path.join(copy, 'tests'), { recursive: true });
  fs.mkdirSync(path.join(scratch, 'tests'));
  fs.copyFileSync(path.join(root, 'lighthouse/tests/sandbox.cjs'), path.join(scratch, 'tests/sandbox.cjs'));
  for (const name of [
    'store.js',
    'registry-files.js',
    'prompt-transitions.js',
    'card-transitions.js',
    'compatibility.js',
    'crm-state.js',
    'tests/helpers.js',
    'tests/doorbell-retry.test.js',
  ])
    fs.copyFileSync(path.join(source, name), path.join(copy, name));
  const implementation = fs.readFileSync(path.join(source, 'doorbells.js'), 'utf8').replace(/\r\n/g, '\n');
  for (const variant of variants) {
    assert.equal(implementation.split(variant.before).length, 2, 'mutation anchor must match exactly once');
    fs.writeFileSync(path.join(copy, 'doorbells.js'), implementation.replace(variant.before, variant.after));
    const broken = run(copy, ['tests/doorbell-retry.test.js'], variant.pattern);
    assert.equal(broken.status, 1, variant.name + ' must fail as an assertion, not a timeout or launch error');
    assert.ok(broken.stdout.includes(variant.evidence), variant.name + ' must expose its intended broken rule');
    console.log('mutation caught: ' + variant.name);
  }
} finally {
  assert.ok(path.resolve(scratch).startsWith(path.resolve(os.tmpdir()) + path.sep));
  fs.rmSync(scratch, { recursive: true, force: true });
}
console.log('Real-code replays pass; all three real-code broken variants fail as expected.');
