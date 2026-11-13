'use strict';
const fs = require('node:fs');
const path = require('node:path');

function gitArgs(root) {
  const repository = path.resolve(root);
  const dot = path.join(repository, '.git');
  if (process.platform === 'linux' && fs.existsSync(dot) && fs.lstatSync(dot).isFile()) {
    const value = fs
      .readFileSync(dot, 'utf8')
      .trim()
      .replace(/^gitdir: /, '');
    if (/^[A-Za-z]:[\\/]/.test(value)) {
      const mounted = '/mnt/' + value[0].toLowerCase() + value.slice(2).replace(/\\/g, '/');
      return ['-C', repository, '--git-dir', mounted, '--work-tree', repository];
    }
  }
  return ['-C', repository];
}

module.exports = { gitArgs };
