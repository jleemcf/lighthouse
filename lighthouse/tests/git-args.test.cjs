'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { gitArgs } = require('../../scripts/git-args.cjs');

test('Git arguments preserve ordinary checkouts and native worktree links', context => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-git-args spaces-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.deepEqual(gitArgs(root), ['-C', root]);
  fs.mkdirSync(path.join(root, '.git'));
  assert.deepEqual(gitArgs(root), ['-C', root]);
  fs.rmdirSync(path.join(root, '.git'));
  for (const value of ['../repository/.git/worktrees/linked', '/tmp/repository/.git/worktrees/linked']) {
    fs.writeFileSync(path.join(root, '.git'), 'gitdir: ' + value + '\n');
    assert.deepEqual(gitArgs(root), ['-C', root]);
  }
});

test('Git arguments anchor Windows worktree links at the checkout root in WSL', context => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-git-args spaces-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const separator of ['/', '\\']) {
    const linked = ['C:', 'fixture repository', '.git', 'worktrees', 'linked'].join(separator);
    fs.writeFileSync(path.join(root, '.git'), 'gitdir: ' + linked + '\r\n');
    assert.deepEqual(
      gitArgs(root),
      process.platform === 'linux'
        ? ['-C', root, '--git-dir', '/mnt/c/fixture repository/.git/worktrees/linked', '--work-tree', root]
        : ['-C', root],
    );
  }
});
