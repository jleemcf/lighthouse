'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { runUpdate } = require('./replay.cjs');

const source = fs.readFileSync(path.join(__dirname, '../../operator-kit/scripts/shift.sh'), 'utf8');
for (const [fault, guard, rule] of [
  ['installer', ' || update_fail "installer"', 'SuccessRequiresInstallation'],
  ['copy', ' || update_fail "WSL copy or verification"', 'SuccessRequiresMatchingCopies'],
]) {
  assert.ok(source.includes(guard), 'mutation guard must still map to the updater');
  const broken = runUpdate({ fault, source: source.replaceAll(guard, '') });
  try {
    assert.equal(broken.status, 0, 'broken updater must reproduce false success');
    console.log(rule + ': removed guard reproduces a zero exit; regression rejects it');
  } finally {
    broken.cleanup();
  }
  const fixed = runUpdate({ fault });
  try {
    assert.notEqual(fixed.status, 0);
    console.log(rule + ': restored guard passes');
  } finally {
    fixed.cleanup();
  }
}
