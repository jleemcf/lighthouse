'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { gitArgs } = require('./git-args.cjs');
const inventory = require('./export-inventory.json');
function exclusionReason(file) {
  for (const [entry, reason] of Object.entries(inventory.exclude))
    if (entry.endsWith('/') ? file.startsWith(entry) : file === entry) return reason;
  const ledgers = inventory.privateVerificationDocs;
  if (file.startsWith(ledgers.prefix) && file.endsWith('.md') && !ledgers.keep.includes(path.posix.basename(file)))
    return ledgers.reason;
  return null;
}
function classify(file) {
  const reason = exclusionReason(file);
  if (reason) return reason;
  if (!inventory.include.some(entry => (entry.endsWith('/') ? file.startsWith(entry) : file === entry)))
    throw new Error('File missing from the shared export inventory');
  return null;
}
function sharedFiles(root) {
  function walk(relative) {
    const full = path.join(root, relative);
    if (!fs.existsSync(full)) return [];
    if (!fs.lstatSync(full).isDirectory()) return [relative];
    return fs
      .readdirSync(full)
      .flatMap(name => walk(relative + name + (fs.lstatSync(path.join(full, name)).isDirectory() ? '/' : '')));
  }
  const files = fs.existsSync(path.join(root, '.git'))
    ? execFileSync('git', [...gitArgs(root), 'ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
        encoding: 'utf8',
        maxBuffer: 16 * 1024 * 1024,
      })
        .split('\0')
        .filter(Boolean)
    : fs
        .readdirSync(root)
        .filter(name => name !== '.git')
        .flatMap(name => {
          if (['node_modules', '__pycache__'].includes(name)) return [];
          return walk(name + (fs.lstatSync(path.join(root, name)).isDirectory() ? '/' : ''));
        });
  return [...new Set(files)]
    .filter(file => fs.existsSync(path.join(root, file)))
    .filter(file => {
      if (classify(file)) return false;
      if (fs.lstatSync(path.join(root, file)).isSymbolicLink()) throw new Error('Shared symlinks are not supported');
      return true;
    })
    .sort();
}
module.exports = { sharedFiles, classify, exclusionReason };
