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
    'inventory-prior-hold',
    'dispatch-calls.js',
    '      settleCommitted(board, prior, false);',
    '      settleCommitted(board, prior, true);',
  ],
  [
    'inventory-new-hold',
    'dispatch-calls.js',
    '    settleCommitted(board, entry, false);',
    '    settleCommitted(board, entry, true);',
  ],
  [
    'owner-agree',
    'dispatch-attempts.js',
    'if (conflict || !attempt.ownerOutcome)',
    'if (conflict || !attempt.ownerOutcome || !args.delivered)',
  ],
  [
    'legacy-origin',
    'dispatch-calls.js',
    'const principal = entry.originSessionId ? entry.originPrincipal : null;',
    "const principal = entry.originPrincipal || 'beta2';",
  ],
  [
    'legacy-ambiguous',
    'dispatch-calls.js',
    "if (call.commitAmbiguous && body.disposition === 'adopted')",
    'if (false)',
  ],
  ['activation-commit', 'dispatch-ledger.js', '    calls.settleCalls(board);', ''],
  ['readiness-commit', 'toolcalls-request.js', 'if (ledgerTracked && !dry)', 'if (ledgerEnabled && !dry)'],
  [
    'cache-settlement',
    'toolcalls-request.js',
    'if (ledgerTracked && !prev.dry) ctx.dispatchLedger.rememberCall(board, who, raw, prev);',
    '',
  ],
  [
    'owner-source',
    'dispatch-attempts.js',
    "if (body.outcome === 'delivered') ctx.TC?.settleRelaySource?.(board, who, ticket, undefined, 'owner');",
    '',
  ],
  ['review-gap-hold', 'dispatch-ledger.js', '      attempts.releaseHolds(board);', ''],
  [
    'applied-call-hold',
    'dispatch-calls.js',
    "audit(board, who, 'call-' + entry.disposition, call.id, { bodyHash: entry.hash });\n    service.releaseHolds(board);",
    "audit(board, who, 'call-' + entry.disposition, call.id, { bodyHash: entry.hash });",
  ],
  [
    'recovered-call-hold',
    'dispatch-calls.js',
    "entry.history.push({ action: entry.disposition, source: 'commit-record', at: Date.now() });\n    if (release) service.releaseHolds(board);",
    "entry.history.push({ action: entry.disposition, source: 'commit-record', at: Date.now() });",
  ],
  [
    'inactive-hold',
    'dispatch-attempts.js',
    'function releaseHolds(board) {\n    if (!enabled(board)) return;',
    'function releaseHolds(board) {',
  ],
  ['owner-conflict', 'dispatch-attempts.js', "(attempt.ownerOutcome === 'not-delivered' && args.delivered)", 'false'],
  [
    'settled-hold',
    'dispatch-ledger.js',
    "['consumed', 'unknown', 'conflict'].includes(value.state)",
    "['consumed', 'unknown', 'delivered', 'conflict'].includes(value.state)",
  ],
  [
    'recorded-pruned',
    'dispatch-calls.js',
    "if (relay.state === 'recorded' && (!ticket || ticket.used)) return;",
    "if (relay.state === 'recorded' && ticket?.used) return;",
  ],
  [
    'schema-downgrade',
    'ownership-control.js',
    'ctx.store.schemaVersion = Math.max(ctx.store.schemaVersion || 1, 3);',
    'ctx.store.schemaVersion = 3;',
  ],
  [
    'inventory-copy',
    'dispatch-ledger.js',
    "body.action === 'inventory' ? { ok: true, journalId: body.journalId } : answer",
    'answer',
  ],
  ['adoption-authority', 'dispatch-attempts.js', 'if (!validation?.ok)', 'if (false)'],
  [
    'receipt-rehearsal',
    'toolcalls-relay.js',
    'const settled = !tc.REHEARSAL && ctx.dispatchLedger?.receipt',
    'const settled = ctx.dispatchLedger?.receipt',
  ],
  ['resend', 'dispatch-attempts.js', "if (attempt.state !== 'issued' || intent.state !== 'issued')", 'if (false)'],
  [
    'consume-answer-replay',
    'dispatch-ledger.js',
    "...(body.action === 'consume' ? { dispatch: false, possiblySent: true } : {})",
    "...(body.action === 'consume' ? { dispatch: true, possiblySent: false } : {})",
  ],
  [
    'receipt-gate',
    'dispatch-attempts.js',
    'function receipt(board, who, ticket, args, callId) {',
    'function receipt(board, who, ticket, args, callId) { ownership.acting(who, board, who.epoch);',
  ],
  ['alias', 'dispatch-attempts.js', 'item.instructionHash === ticket.hash &&', 'false &&'],
  ['gap', 'dispatch-calls.js', '!pending && body.complete && previousComplete', '!pending && body.complete'],
  [
    'queue',
    'dispatch-calls.js',
    'if (entry && !terminal.has(entry.disposition) && !canApply(board, who, call))',
    'if (false)',
  ],
  [
    'off',
    'dispatch-ledger.js',
    'if (!requested(board)) return { enabled: false };',
    'if (false) return { enabled: false };',
  ],
  [
    'target',
    'dispatch-ledger.js',
    "['consumed', 'unknown', 'conflict'].includes(value.state)",
    "['impossible'].includes(value.state)",
  ],
];
function run(directory) {
  const files = fs
    .readdirSync(path.join(directory, 'tests'))
    .filter(name => name.startsWith('dispatch-') && name.endsWith('.test.js'));
  const result = spawnSync(
    process.execPath,
    ['--test', '--test-reporter=tap', ...files.map(name => path.join(directory, 'tests', name))],
    { env, encoding: 'utf8', timeout: 90000, maxBuffer: 4 * 1024 * 1024 },
  );
  if (result.error) throw result.error;
  return { status: result.status, output: result.stdout + result.stderr };
}
assert.equal(run(source).status, 0, 'unmodified dispatch acceptance passes');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-dispatch-mutations-'));
try {
  for (const [name, fileName, old, replacement] of cases) {
    const folder = path.join(scratch, name);
    const copy = path.join(folder, 'server');
    fs.cpSync(source, copy, { recursive: true });
    for (const directory of ['tests', 'operator-kit/scripts'])
      fs.cpSync(path.join(source, '..', directory), path.join(folder, directory), { recursive: true });
    const file = path.join(copy, fileName);
    const text = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
    assert.equal(text.split(old).length, 2, 'unique real-code anchor: ' + name);
    fs.writeFileSync(file, text.replace(old, replacement));
    const result = run(copy);
    assert.notEqual(result.status, 0, 'real-code counterexample escaped: ' + name);
    assert.match(result.output, /not ok/);
    assert.doesNotMatch(result.output, /Cannot find module|SyntaxError/);
    console.log('caught dispatch counterexample: ' + name);
  }
} finally {
  fs.rmSync(scratch, { recursive: true, force: true });
}
assert.equal(run(source).status, 0, 'restored dispatch acceptance passes');
console.log('restored dispatch ledger passes');
