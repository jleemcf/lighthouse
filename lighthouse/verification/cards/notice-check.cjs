'use strict';
// Replays the authority and wake counterexamples against actual scratch servers/watchers, never live homes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '../../..');
const env = { ...process.env };
delete env.TYPESAFE_API_KEY;
const tests = [
  'lighthouse/server/tests/coordinator-notice.test.js',
  'lighthouse/server/tests/coordinator-watch.test.js',
  'lighthouse/server/tests/coordinator-access.test.js',
  'lighthouse/operator-kit/tests/boardwatch_test.cjs',
  'lighthouse/operator-kit/tests/gate_test.cjs',
  'lighthouse/board/tests/coordinator-notice.test.cjs',
];
function run(cwd, files, pattern) {
  return spawnSync(
    process.execPath,
    ['--test', '--test-reporter=tap', ...(pattern ? ['--test-name-pattern=' + pattern] : []), ...files],
    {
      cwd,
      env,
      encoding: 'utf8',
      timeout: 60000,
      maxBuffer: 4 * 1024 * 1024,
    },
  );
}
const good = run(root, tests);
process.stdout.write(good.stdout || '');
process.stderr.write(good.stderr || '');
assert.equal(good.status, 0, 'notice acceptance tests must pass');
if (!process.argv.includes('--mutate')) process.exit(0);
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'notice-mutation-'));
try {
  for (const folder of [
    'lighthouse/server',
    'lighthouse/tests',
    'lighthouse/operator-kit/scripts',
    'lighthouse/operator-kit/tests',
    'lighthouse/verification/update',
  ])
    fs.cpSync(path.join(root, folder), path.join(scratch, folder), { recursive: true });
  for (const mutation of [
    {
      file: 'lighthouse/server/routes-messages.js',
      before: "author: notice ? 'coordinator'",
      after: "author: notice ? 'owner'",
      test: tests[0],
      pattern: 'cannot answer an ask',
      evidence: /actual: 201/,
      name: 'notice cannot record owner authority',
    },
    {
      file: 'lighthouse/operator-kit/scripts/collector.py',
      before: ', owner_text)',
      after: ', text or "")',
      test: tests[0],
      pattern: 'notice prose cannot redirect',
      evidence: /0: 'victim'/,
      name: 'notice prose cannot redirect an inbox reply',
    },
    {
      file: 'lighthouse/operator-kit/scripts/gate.cjs',
      before: '|^NOTICE from /',
      after: '/',
      test: tests[4],
      pattern: 'coordinator notices always wake',
      evidence: /timed out waiting/,
      name: 'notice cannot be quieted by the gate',
    },
    {
      file: 'lighthouse/operator-kit/scripts/boardwatch.cjs',
      before: "&& once('m:' + message.id)",
      after: "&& (message.author === 'coordinator' || once('m:' + message.id))",
      test: tests[3],
      pattern: 'announces coordinator notices once',
      evidence: /expected: 1/,
      name: 'notice cannot announce repeatedly',
    },
  ]) {
    const file = path.join(scratch, mutation.file);
    const original = fs.readFileSync(file, 'utf8').replaceAll('\r\n', '\n');
    assert.equal(original.split(mutation.before).length, 2, 'review mutation anchor: ' + mutation.name);
    fs.writeFileSync(file, original.replace(mutation.before, mutation.after));
    const broken = run(scratch, [mutation.test], mutation.pattern);
    assert.equal(broken.status, 1, mutation.name + ': ' + broken.stdout + broken.stderr);
    assert.match(broken.stdout, mutation.evidence, mutation.name);
    fs.writeFileSync(file, original);
    const restored = run(scratch, [mutation.test], mutation.pattern);
    assert.equal(restored.status, 0, 'restored source: ' + restored.stdout + restored.stderr);
    console.log('Mutation caught and restored: ' + mutation.name);
  }
} finally {
  fs.rmSync(scratch, { recursive: true, force: true });
}
