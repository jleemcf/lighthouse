'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
if (process.platform !== 'linux') throw new Error('Run the manager replay in Linux/WSL');
const root = path.resolve(__dirname, '../../..');
const env = { ...process.env };
delete env.TYPESAFE_API_KEY;
function check(directory) {
  return spawnSync(
    process.execPath,
    [
      '--test',
      '--test-reporter=tap',
      '--test-name-pattern=archive refuses an invalid board',
      path.join(directory, 'tests/board-manager.test.js'),
    ],
    { env, encoding: 'utf8', timeout: 30000 },
  );
}
const original = path.join(root, 'lighthouse/server');
assert.equal(check(original).status, 0, 'normal target preflight must pass');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-maintenance-target-'));
try {
  const server = path.join(scratch, 'lighthouse/server');
  fs.cpSync(original, server, { recursive: true });
  fs.cpSync(path.join(root, 'lighthouse/tests'), path.join(scratch, 'lighthouse/tests'), { recursive: true });
  const manager = path.join(server, 'board.sh');
  const source = fs.readFileSync(manager, 'utf8');
  const guard = '    target="$("$NODE" "$RELEASE/config-target.js" "$CONFIG" "' + '$' + '{2:-}")" || exit 2';
  assert.equal(source.split(guard).length, 2, 'target guard mutation anchor');
  const without = source.replace(guard + '\n', '');
  const archive = without.indexOf('  archive)');
  const stop = without.indexOf('    bash "$0" stop || exit $?', archive);
  assert.ok(stop > archive);
  const boundary = without.indexOf('\n', stop);
  fs.writeFileSync(manager, without.slice(0, boundary) + '\n' + guard + without.slice(boundary));
  const result = check(server);
  assert.notEqual(result.status, 0, 'stopping before target refusal must fail');
  assert.match(result.stdout + result.stderr, /not ok[^\n]*archive refuses an invalid board/);
  assert.match(result.stdout + result.stderr, /ENOENT/);
  console.log('InvalidArchiveTargetLeavesServing: stop-before-validation mutation caught');
} finally {
  fs.rmSync(scratch, { recursive: true, force: true });
}
assert.equal(check(original).status, 0, 'normal target preflight must still pass after mutation');
