'use strict';
// Run focused regressions against disposable broken sources; no real home, credentials or live port is used.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '../../..');
const env = { ...process.env, PYTHONDONTWRITEBYTECODE: '1' };
delete env.TYPESAFE_API_KEY;
const suite = 'lighthouse/operator-kit/tests/setup_faults_test.cjs';
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-setup-mutations-'));
const cases = [
  [
    'trust',
    'lighthouse/setup/operator.cjs',
    '!options.host || !options.trust',
    '!options.host',
    'SetupRefusesUntrustedHostsAndPopulatedHomesBeforeWrites',
  ],
  [
    'policy-bytes',
    'scripts/apply-profile.cjs',
    'bytes && JSON.stringify(JSON.parse(bytes)) === JSON.stringify(JSON.parse(selected)) ? bytes : selected',
    'selected',
    'PolicyApplyPreservesRunningBytesForEqualContent',
  ],
  [
    'policy-reapply',
    'scripts/apply-profile.cjs',
    'const selected = fs.readFileSync(path.resolve(path.dirname(profilePath), profile.policy.file));',
    'const selected = fs.readFileSync(exists ? policyPath : path.resolve(path.dirname(profilePath), profile.policy.file));',
    'PolicyApplyPreservesRunningBytesForEqualContent',
  ],
  [
    'doctor-heartbeat',
    'lighthouse/operator-kit/scripts/setup-runtime.cjs',
    "LH_SERVER: 'probe-only'",
    'LH_SERVER: process.env.LH_SERVER',
    'DoctorProbeLeavesNoHeartbeatOrLoadedReceipt',
  ],
  [
    'doctor-reconnect',
    'lighthouse/operator-kit/scripts/kit-version.cjs',
    "process.env.LH_MCP_PROBE === '1'",
    'false',
    'GuidedOperatorBindGrantAndPrivateStorage',
    'lighthouse/operator-kit/tests/setup_test.cjs',
  ],
  [
    'guided-update',
    'lighthouse/operator-kit/scripts/shift.sh',
    'start|stop|end|status|doctor|update)',
    'start|stop|end|status|doctor)',
    'GuidedOperatorBindGrantAndPrivateStorage',
    'lighthouse/operator-kit/tests/setup_test.cjs',
  ],
  [
    'owner-fallback',
    'lighthouse/operator-kit/scripts/collector.py',
    'owner_settings.get("ownerName") or "the captain"',
    'owner_settings.get("ownerName", "the captain")',
    'EmptyOwnerLabelFallbackMatchesCollectorAndUsage',
  ],
];
function run(repository, name, targetSuite = suite) {
  return spawnSync(process.execPath, ['--test', '--test-name-pattern', name, path.join(repository, targetSuite)], {
    cwd: repository,
    env,
    encoding: 'utf8',
    timeout: 120000,
  });
}
try {
  for (const [name, relative, before, after, test, targetSuite] of cases) {
    const directory = path.join(scratch, name);
    fs.cpSync(root, directory, {
      recursive: true,
      filter: file => !['.git', 'private', '__pycache__'].includes(path.basename(file)),
    });
    const source = path.join(directory, relative);
    const text = fs.readFileSync(source, 'utf8');
    assert.ok(text.includes(before), 'mutation anchor is current: ' + name);
    assert.equal(run(root, test, targetSuite).status, 0, 'normal regression passes: ' + name);
    fs.writeFileSync(source, text.replace(before, after));
    const broken = run(directory, test, targetSuite);
    assert.notEqual(broken.status, 0, 'mutant must fail: ' + name);
    assert.ok((broken.stdout + broken.stderr).includes(test), 'named regression ran: ' + name);
    fs.writeFileSync(source, text);
    assert.equal(run(directory, test, targetSuite).status, 0, 'restored regression passes: ' + name);
    console.log('caught setup mutation and restored: ' + name);
  }
} finally {
  fs.rmSync(scratch, { recursive: true, force: true });
}
