'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const source = path.resolve(__dirname, '../..');
const env = { ...process.env };
delete env.TYPESAFE_API_KEY;
const cases = [
  [
    'legacy-receipt-origin',
    'lighthouse-mcp.cjs',
    '...(item.originSessionId ? { originSessionId: item.originSessionId, originEpoch: item.originEpoch } : {}),',
    '...(item.intent?.ledgerVersion ? { originSessionId: item.originSessionId, originEpoch: item.originEpoch } : {}),',
  ],
  ['acknowledged-history', 'dispatch-storage.cjs', "      .filter(item => item.state !== 'recorded')", ''],
  [
    'activation-deadletter',
    'lighthouse-mcp.cjs',
    'if ((await HANDOFF.paused()) || view.enabled || view.unknown) break;',
    'if (await HANDOFF.paused()) break;',
  ],
  ['optional-missing', 'dispatch-storage.cjs', "if (error.code === 'ENOENT') return [];", 'if (false) return [];'],
  ['inactive-drain', 'dispatch-client.cjs', 'return view.unknown === true;', 'return view.unknown || view.available;'],
  ['local-suppression', 'lighthouse-mcp.cjs', 'tk.ledgerVersion !== 1 &&', 'true &&'],
  ['inventory-dedup', 'dispatch-client.cjs', 'if (onlyChanged && unchanged)', 'if (false)'],
  ['queue-prune', 'dispatch-client.cjs', 'storage.pruneCalls(home, view.calls || []);', ''],
];
function run(directory) {
  const files = ['dispatch-review_test.cjs', 'dispatch-transfer_test.cjs', 'dispatch_test.cjs'];
  const result = spawnSync(
    process.execPath,
    [
      '--require',
      path.join(source, 'tests/sandbox.cjs'),
      '--test',
      '--test-reporter=tap',
      ...files.map(name => path.join(directory, 'operator-kit/tests', name)),
    ],
    { env, encoding: 'utf8', timeout: 90000, maxBuffer: 4 * 1024 * 1024 },
  );
  if (result.error) throw result.error;
  return { status: result.status, output: result.stdout + result.stderr };
}
assert.equal(run(source).status, 0, 'unmodified kit acceptance passes');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-dispatch-kit-mutations-'));
try {
  for (const [name, fileName, old, replacement] of cases) {
    const folder = path.join(scratch, name);
    for (const directory of ['operator-kit/scripts', 'operator-kit/tests', 'verification/relay', 'server', 'tests'])
      fs.cpSync(path.join(source, directory), path.join(folder, directory), { recursive: true });
    const file = path.join(folder, 'operator-kit/scripts', fileName);
    const text = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
    assert.equal(text.split(old).length, 2, 'unique real-code anchor: ' + name);
    let changed = text.replace(old, replacement);
    if (name === 'local-suppression')
      changed = changed.replace(
        "item.state = 'reconciled';\n          item.reconciledByIntent",
        "item.state = 'outcome-unknown';\n          item.reconciledByIntent",
      );
    fs.writeFileSync(file, changed);
    const result = run(folder);
    assert.notEqual(result.status, 0, 'real-code counterexample escaped: ' + name);
    assert.match(result.output, /not ok/);
    assert.doesNotMatch(result.output, /Cannot find module|SyntaxError/);
    console.log('caught dispatch kit counterexample: ' + name);
  }
} finally {
  fs.rmSync(scratch, { recursive: true, force: true });
}
assert.equal(run(source).status, 0, 'restored kit acceptance passes');
console.log('restored dispatch kit passes');
