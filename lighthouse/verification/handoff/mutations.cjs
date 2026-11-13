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
  {
    name: 'no-fence',
    file: 'ownership.js',
    old: "function acting(who, board, epoch, scope = 'operator') {",
    replacement: "function acting(who, board, epoch, scope = 'operator') { return;",
  },
  {
    name: 'arrival-only',
    file: 'store.js',
    old: '      authorize();\n      for (const guard',
    replacement: '      for (const guard',
  },
  { name: 'nondurable', file: 'store.js', old: '      disk.write(compatibility.write(store));', replacement: '' },
  { name: 'split-audit', file: 'ownership-control.js', old: 'data().audit.push(', replacement: '[].push(' },
  {
    name: 'stale-nomination',
    file: 'ownership-control.js',
    old: "nomination.status !== 'pending' ||",
    replacement: '',
  },
  {
    name: 'shift-reset',
    file: 'ownership-control.js',
    old: '    owner.epoch++;',
    replacement: "    owner.epoch++; ctx.store.boards[board].shift.since += 'reset';",
  },
  {
    name: 'legacy-bypass',
    file: 'ownership.js',
    old: "function acting(who, board, epoch, scope = 'operator') {",
    replacement: "function acting(who, board, epoch, scope = 'operator') { if (!who?.sessionId) return;",
    suite: 'ownership-ingress.test.js',
  },
  {
    name: 'unbound-session-upload',
    file: 'mutation-routes.js',
    old: [
      "    if (p === '/api/attachments' && (who?.board || req.headers['x-lighthouse-board']))",
      "      return [who?.board || req.headers['x-lighthouse-board']];",
      "    if (p === '/api/attachments' && !who?.sessionId) return [];",
    ].join('\n'),
    replacement: [
      "    if (p === '/api/attachments')",
      "      return req.headers['x-lighthouse-board'] ? [req.headers['x-lighthouse-board']] : [];",
    ].join('\n'),
    suite: 'ownership-ingress.test.js',
  },
  {
    name: 'redirected-session-upload',
    file: 'mutation-routes.js',
    old: "      return [who?.board || req.headers['x-lighthouse-board']];",
    replacement: "      return [req.headers['x-lighthouse-board'] || who?.board];",
    suite: 'ownership-ingress.test.js',
  },
];
function run(directory, suite = 'ownership.test.js') {
  const result = spawnSync(process.execPath, ['--test', '--test-reporter=tap', path.join(directory, 'tests', suite)], {
    env,
    encoding: 'utf8',
    timeout: 90000,
  });
  if (result.error) throw result.error;
  return { status: result.status, output: result.stdout + result.stderr };
}
assert.equal(run(source).status, 0, 'unmodified acceptance must pass');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-handoff-mutations-'));
try {
  for (const variant of cases) {
    const folder = path.join(scratch, variant.name);
    fs.mkdirSync(path.join(folder, 'tests'), { recursive: true });
    fs.copyFileSync(path.join(source, '../tests/sandbox.cjs'), path.join(folder, 'tests/sandbox.cjs'));
    const copy = path.join(folder, 'server');
    fs.cpSync(source, copy, { recursive: true });
    const file = path.join(copy, variant.file);
    const text = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
    assert.equal(text.split(variant.old).length, 2, 'exact mutation anchor: ' + variant.name);
    fs.writeFileSync(file, text.replace(variant.old, variant.replacement));
    const result = run(copy, variant.suite);
    assert.notEqual(result.status, 0, 'real-code mutation escaped: ' + variant.name);
    assert.match(result.output, /not ok/);
    assert.doesNotMatch(result.output, /Cannot find module|SyntaxError/);
    console.log('caught real-code mutation: ' + variant.name);
  }
} finally {
  fs.rmSync(scratch, { recursive: true, force: true });
}
assert.equal(run(source).status, 0, 'restored acceptance must pass');
console.log('restored handoff identity passes');
