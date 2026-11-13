'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { sharedFiles } = require('../../scripts/shared-files.cjs');
const { scan } = require('../../scripts/check-private.cjs');
const root = path.resolve(__dirname, '../..');
const fs = require('node:fs');
const os = require('node:os');
const { dryExport } = require('../../scripts/dry-export.cjs');
const { gitArgs } = require('../../scripts/git-args.cjs');
test('the explicit shared inventory excludes the private overlay', () => {
  const files = sharedFiles(root);
  assert.ok(files.length > 100);
  assert.ok(files.every(file => !file.startsWith('private/')));
});
test('the shared tree passes generic and any configured private checks', () => {
  const result = scan(root);
  assert.deepEqual(result.violations, []);
});
test('dry export is plain shared source and refuses populated or repository destinations', context => {
  if (!fs.existsSync(path.join(root, '.git'))) return context.skip('Committed export requires Git history');
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-export-'));
  context.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
  const output = path.join(scratch, 'shared');
  const exported = dryExport(root, output);
  assert.equal(fs.existsSync(path.join(output, 'private')), false);
  assert.equal(fs.existsSync(path.join(output, '.git')), false);
  assert.equal(sharedFiles(output).length, exported.files);
  if (fs.existsSync(path.join(root, '.git'))) {
    const committed = require('node:child_process').execFileSync('git', [...gitArgs(root), 'show', 'HEAD:README.md']);
    assert.deepEqual(fs.readFileSync(path.join(output, 'README.md')), committed);
  }
  assert.throws(() => dryExport(root, output), /empty/);
  assert.throws(() => dryExport(root, path.join(root, 'never-written')), /outside (?:both )?repositories/);
});
