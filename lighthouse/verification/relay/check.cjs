'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { SOURCE } = require('./adapter.cjs');

const root = path.resolve(__dirname, '../../..');
const testFile = path.join(root, 'lighthouse/operator-kit/tests/relay_test.cjs');
const original = fs.readFileSync(SOURCE, 'utf8');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-relay-mutations-'));
const environment = { ...process.env };
delete environment.TYPESAFE_API_KEY;
delete environment.LH_RELAY_MCP;

function run(source, pattern) {
  const result = spawnSync(process.execPath, ['--test', '--test-name-pattern=' + pattern, testFile], {
    cwd: root,
    encoding: 'utf8',
    env: { ...environment, ...(source ? { LH_RELAY_MCP: source } : {}) },
    timeout: 30000,
  });
  return { status: result.status, output: result.stdout + result.stderr };
}

try {
  const promptResult = spawnSync(
    process.execPath,
    [
      '--test',
      path.join(root, 'lighthouse/server/tests/prompt-lifecycle.test.js'),
      path.join(root, 'lighthouse/server/tests/prompt-compatibility.test.js'),
    ],
    {
      cwd: root,
      encoding: 'utf8',
      env: environment,
      timeout: 30000,
    },
  );
  assert.equal(promptResult.status, 0, promptResult.stdout + promptResult.stderr);
  console.log('PASS board prompt receipt and final-state regressions');
  const clean = run(null, '.');
  assert.equal(clean.status, 0, clean.output);
  console.log('PASS real adapter regressions');
  const marker = 'const accepted = acceptedRelay(item, response);';
  assert.equal(original.split(marker).length, 2, 'acceptance boundary changed; review mutation coverage');
  const mutations = [
    {
      name: 'delete-refused-receipt',
      pattern: 'DeliveredResultNotSilentlyLost',
      replacement:
        marker +
        '\n' +
        '  if (!accepted) await locked(async () => ' +
        'saveRelayJournal(relayJournal().filter(entry => entry.id !== item.id)));',
    },
    {
      name: 'false-success',
      pattern: 'SuccessRequiresBoardReceipt',
      replacement: 'const accepted = response.status !== 0 && response.status < 500;',
    },
  ];
  for (const mutation of mutations) {
    const file = path.join(scratch, mutation.name + '.cjs');
    fs.writeFileSync(file, original.replace(marker, mutation.replacement));
    const result = run(file, mutation.pattern);
    assert.equal(result.status, 1, mutation.name + ' escaped detection: ' + result.output);
    assert.match(result.output, /AssertionError/);
    assert.ok(result.output.includes(mutation.pattern), result.output);
    console.log('CAUGHT ' + mutation.name + ' by ' + mutation.pattern);
  }
  const restored = run(null, '.');
  assert.equal(restored.status, 0, restored.output);
  console.log('PASS unchanged real adapter after both scratch mutations');
} finally {
  fs.rmSync(scratch, { recursive: true, force: true });
}
