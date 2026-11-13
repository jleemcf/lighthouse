'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const source = path.resolve(__dirname, '../..');
const env = { ...process.env, PYTHONDONTWRITEBYTECODE: '1' };
delete env.TYPESAFE_API_KEY;
const cases = [
  [
    'cancel',
    'server/handoff-actions.js',
    "if (value.kind === 'recovery' && !ownership.captain(who, board))",
    'if (false)',
  ],
  ['cancel-gap', 'server/handoff-actions.js', 'gap.resolved = true;', 'gap.resolved = false;'],
  ['pin-location', 'server/handoff-location.js', '      holder?.installationId === binding.installationId &&', ''],
  ['pin-checkpoint', 'server/handoff-checkpoint.js', '    who.sessionInstallationId === binding.installationId &&', ''],
  ['pin-recovery', 'server/handoff-recovery.js', '      holder?.installationId === original?.installationId &&', ''],
  [
    'unconfirmed-status',
    'operator-kit/scripts/helper-runner.cjs',
    'Number.isSafeInteger(current.ownership?.epoch) && current.ownership.epoch > session.epoch',
    'current.ownership?.holderSessionId !== session.sessionId',
  ],
  [
    'transient-runner',
    'operator-kit/scripts/helper-runner.cjs',
    'if (Date.now() >= helper.record.expiresAt)',
    'if (true)',
  ],
  ['transient-read', 'operator-kit/scripts/helper-generation.cjs', 'if (fallback &&', 'if (false &&'],
  [
    'write-expiry-ack',
    'operator-kit/scripts/helper-generation.cjs',
    '  storage.write(helper.file, JSON.stringify(record));\n  helper.record = record;',
    '  helper.record = record;\n  storage.write(helper.file, JSON.stringify(record));',
  ],
  [
    'transient-write',
    'operator-kit/scripts/helper-runner.cjs',
    "if (['EPERM', 'EACCES', 'EBUSY'].includes(error.code) && Date.now() < helper.record.expiresAt) return;",
    'if (false) return;',
  ],
  ['write-cleanup', 'operator-kit/scripts/dispatch-storage.cjs', '      fs.rmSync(temporary, { force: true });', ''],
  [
    'spawn-notice',
    'operator-kit/scripts/helper-runner.cjs',
    "child.once('error', () => close('spawn failed'));",
    "child.once('error', () => close('authority unconfirmed'));",
  ],
  [
    'transient-python',
    'operator-kit/scripts/helper_generation.py',
    'if previous is not None and transient:',
    'if False:',
  ],
  [
    'notice',
    'operator-kit/scripts/watch-lease.cjs',
    "if (generation && loss !== 'generation retired') {",
    'if (false) {',
  ],
  [
    'both-lease-reason',
    'operator-kit/scripts/watch-lease.cjs',
    "loss = state === 'retired' ? 'generation retired' : 'authority unconfirmed';",
    '',
  ],
  ['approval', 'server/handoff-recovery.js', 'if (!ownership.captain(who, board))', 'if (false)'],
  [
    'revocation',
    'server/handoff-recovery.js',
    'if (owner.leaseUntil > Date.now() && body.revoke !== true)',
    'if (false)',
  ],
  [
    'renew',
    'server/ownership.js',
    'function renew(who, board, epoch, processId) {',
    'function renew(who, board, epoch, processId) { return;',
  ],
  [
    'queue',
    'server/ownership.js',
    "function acting(who, board, epoch, scope = 'operator') {",
    "function acting(who, board, epoch, scope = 'operator') { return;",
  ],
  [
    'missing',
    'server/handoff-recovery.js',
    'degraded: true, blockers: pending.blockers',
    'degraded: false, blockers: pending.blockers',
  ],
  [
    'target',
    'server/handoff-location.js',
    "if (location.machineId !== binding.machineId) return 'different-machine';",
    "if (false) return 'different-machine';",
  ],
  [
    'steward',
    'server/handoff-recovery.js',
    "    owner.phase = 'draining';",
    "    for (const job of Object.values(ctx.store.stewardRequests || {})) job.state = 'failed';\n" +
      "    owner.phase = 'draining';",
  ],
  ['completion', 'server/steward-result.js', 'ctx.dispatchLedger?.releaseHolds(r.board);', '', 4],
  [
    'off',
    'server/handoff-recovery.js',
    '(ctx.activation ? ctx.activation.active(board) : ctx.cfg.boards[board].recoveryEnabled === true) &&',
    '',
  ],
  ['helper', 'operator-kit/scripts/helper-generation.cjs', "Number(name.split('.')[0]) > record.epoch", 'false'],
  ['pid', 'operator-kit/scripts/boardwatch.cjs', 'if (!process.env?.LH_HELPER_LEASE)', 'if (true)'],
  [
    'route',
    'operator-kit/scripts/dispatch-client.cjs',
    "if (recoveryBinding) require('./target-binding.cjs').verify(home, recoveryBinding);",
    '',
  ],
  [
    'replay',
    'operator-kit/scripts/collector.py',
    "if cursor.get('recoveryFloor') and (o.get('timestamp') or '') <= cursor['recoveryFloor']:",
    'if False:',
  ],
];
function run(directory, kind) {
  const suites =
    kind === 'server'
      ? ['server/tests/handoff-recovery.test.js', 'server/tests/recovery-http.test.js']
      : ['operator-kit/tests/helper-generation_test.cjs', 'operator-kit/tests/target-binding_test.cjs'];
  const python = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
  const executable = kind === 'python' ? python : process.execPath;
  const args =
    kind === 'python'
      ? [path.join(directory, 'operator-kit/tests/recovery-collector_test.py')]
      : [
          '--require',
          path.join(directory, 'tests/sandbox.cjs'),
          '--test',
          '--test-reporter=tap',
          ...suites.map(file => path.join(directory, file)),
        ];
  const result = spawnSync(executable, args, { env, encoding: 'utf8', timeout: 90000, maxBuffer: 4 * 1024 * 1024 });
  if (result.error) throw result.error;
  return { status: result.status, output: result.stdout + result.stderr };
}
for (const kind of ['server', 'kit', 'python']) assert.equal(run(source, kind).status, 0, 'baseline ' + kind);
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-recovery-mutations-'));
try {
  for (const [name, relative, anchor, replacement, count = 1] of cases) {
    const folder = path.join(scratch, name);
    for (const directory of ['server', 'operator-kit/scripts', 'operator-kit/tests', 'tests'])
      fs.cpSync(path.join(source, directory), path.join(folder, directory), { recursive: true });
    const file = path.join(folder, relative);
    const text = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
    assert.equal(text.split(anchor).length, count + 1, 'exact mutation anchor: ' + name);
    fs.writeFileSync(file, text.split(anchor).join(replacement));
    const kind = relative.startsWith('server/') ? 'server' : relative.endsWith('.py') ? 'python' : 'kit';
    const result = run(folder, kind);
    assert.notEqual(result.status, 0, 'counterexample escaped: ' + name);
    assert.match(result.output, kind === 'python' ? /FAIL/ : /not ok/);
    assert.doesNotMatch(result.output, /Cannot find module|SyntaxError|IndentationError/);
    console.log('caught recovery counterexample: ' + name);
  }
} finally {
  fs.rmSync(scratch, { recursive: true, force: true });
}
for (const kind of ['server', 'kit', 'python']) assert.equal(run(source, kind).status, 0, 'restored ' + kind);
