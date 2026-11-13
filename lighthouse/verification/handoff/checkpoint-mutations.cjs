'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const source = path.resolve(__dirname, '../../server');
const env = { ...process.env };
delete env.TYPESAFE_API_KEY;
const cases = [
  [
    'dry-run',
    '../operator-kit/scripts/handoff.cjs',
    "    if (tool === 'board_shift' && args?.dry_run) return null;",
    '',
  ],
  ['checkpoint-retry', '../operator-kit/scripts/handoff.cjs', '    return saved.input;', '    return build();'],
  [
    'changed-journals',
    '../operator-kit/scripts/handoff.cjs',
    "    if (reused && !['compaction', 'reconnect'].includes(input.reason)) {",
    '    if (false) {',
  ],
  [
    'shift-reset',
    'handoff-actions.js',
    '      owner.epoch++;',
    "      owner.epoch++; ctx.store.boards[board].shift.since += 'reset';",
  ],
  [
    'double-accept',
    'handoff.js',
    '        if (previous) {',
    '        if (previous) { ownership.record(board).epoch++;',
  ],
  [
    'rollback',
    'handoff-actions.js',
    "if (!['draining', 'sealed'].includes(value.status) || owner.holderSessionId !== value.from)",
    'if (false)',
  ],
  ['blind-accept', 'handoff-actions.js', "      proof(board, who, body, 'sealed');", ''],
  ['stale-pickup', 'handoff-actions.js', '        read.revision !== service.revision(board) ||', ''],
  ['drain-work', 'ownership.js', "if (record(board).phase !== 'working')", 'if (false)'],
  ['false-clean', 'handoff-actions.js', 'if (pending.blockers.length && body.degraded !== true)', 'if (false)'],
  [
    'feature-off',
    'handoff.js',
    '(ctx.activation ? ctx.activation.active(board) : ctx.cfg.boards[board].handoffEnabled === true)',
    'true',
  ],
  ['context-hold', 'handoff-checkpoint.js', 'heldTargets: effects.length ?', 'heldTargets: blockers.length ?'],
  [
    'continuation-hold',
    'handoff-actions.js',
    '      owner.handoffOperationId = value.id;',
    '      owner.handoffOperationId = value.id; ' +
      'value.heldTargets = snapshots.pending(ctx, board, saved).heldTargets;',
  ],
  [
    'cancel-hold',
    'handoff-actions.js',
    '      value.heldTargets = value.inheritedBlockers.map(blocker => ' +
      "blocker.slice('retained-dispatch-hold:'.length));",
    '      value.heldTargets = [...new Set(value.heldTargets.concat(pending.heldTargets))];',
  ],
  [
    'lost-accept',
    'handoff-actions.js',
    '      const lease = owner.leaseUntil;',
    '      const lease = Math.max(Date.now() + 60000, owner.leaseUntil);',
  ],
];
function run(directory) {
  const result = spawnSync(
    process.execPath,
    [
      '--test',
      '--test-reporter=tap',
      path.join(directory, 'tests/handoff.test.js'),
      path.join(directory, 'tests/handoff-safety.test.js'),
      path.join(directory, 'tests/handoff-regressions.test.js'),
      path.join(directory, 'tests/handoff-retry.test.js'),
    ],
    { env, encoding: 'utf8', timeout: 90000 },
  );
  if (result.error) throw result.error;
  return { status: result.status, output: result.stdout + result.stderr };
}
assert.equal(run(source).status, 0, 'unmodified checkpoint acceptance passes');
const kitFile = path.join(source, '../operator-kit/scripts/lighthouse-mcp.cjs');
function runKit(mutant) {
  const result = spawnSync(
    process.execPath,
    [
      '-e',
      'require(process.argv[1]); if (process.argv[2]) process.env.LH_RELAY_MCP = process.argv[2]; ' +
        'require(process.argv[3]);',
      path.join(source, '../tests/sandbox.cjs'),
      mutant || '',
      path.join(source, '../operator-kit/tests/handoff_test.cjs'),
    ],
    { env, encoding: 'utf8', timeout: 30000 },
  );
  return { status: result.status, output: result.stdout + result.stderr };
}
assert.equal(runKit().status, 0, 'unmodified receipt drain acceptance passes');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-checkpoint-mutations-'));
try {
  for (const [name, fileName, old, replacement] of cases) {
    const folder = path.join(scratch, name);
    fs.mkdirSync(path.join(folder, 'tests'), { recursive: true });
    fs.copyFileSync(path.join(source, '../tests/sandbox.cjs'), path.join(folder, 'tests/sandbox.cjs'));
    const copy = path.join(folder, 'server');
    fs.cpSync(source, copy, { recursive: true });
    fs.cpSync(path.join(source, '../operator-kit/scripts'), path.join(folder, 'operator-kit/scripts'), {
      recursive: true,
    });
    const file = path.join(copy, fileName);
    const text = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
    assert.equal(text.split(old).length, 2, 'unique real-code anchor: ' + name);
    fs.writeFileSync(file, text.replace(old, replacement));
    const result = run(copy);
    assert.notEqual(result.status, 0, 'real-code counterexample escaped: ' + name);
    assert.match(result.output, /not ok/);
    assert.doesNotMatch(result.output, /Cannot find module|SyntaxError/);
    console.log('caught checkpoint counterexample: ' + name);
  }
  const receiptFile = path.join(scratch, 'receipt-pause.cjs');
  const original = fs.readFileSync(kitFile, 'utf8');
  const anchor = 'if (draining) return;';
  assert.equal(original.split(anchor).length, 2, 'unique real-code receipt drain anchor');
  fs.writeFileSync(receiptFile, original.replace(anchor, 'if (draining || (await HANDOFF.paused())) return;'));
  const receipt = runKit(receiptFile);
  assert.equal(receipt.status, 1, 'receipt pause escaped: ' + receipt.output);
  assert.match(receipt.output, /AssertionError/);
  assert.doesNotMatch(receipt.output, /Cannot find module|SyntaxError/);
  console.log('caught checkpoint counterexample: receipt-pause (concrete kit path)');
} finally {
  fs.rmSync(scratch, { recursive: true, force: true });
}
assert.equal(run(source).status, 0, 'restored checkpoint acceptance passes');
assert.equal(runKit().status, 0, 'restored receipt drain acceptance passes');
console.log('restored checkpoint and transfer pass');
