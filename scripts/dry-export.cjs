'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { sharedFiles } = require('./shared-files.cjs');
const { gitArgs } = require('./git-args.cjs');
const { exportPublic } = require('./export-public.cjs');
function dryExport(root, destination, reference) {
  const result = exportPublic(root, destination, 'HEAD', { reference });
  const target = path.resolve(destination);
  const files = sharedFiles(target);
  const differences = [];
  if (reference) {
    const git = args => execFileSync('git', [...gitArgs(reference), ...args], { maxBuffer: 16 * 1024 * 1024 });
    const published = git(['ls-tree', '-r', '--name-only', '-z', 'origin/main']).toString().split('\0').filter(Boolean);
    const current = new Set(files);
    for (const file of published) {
      if (!current.has(file)) differences.push({ file, status: 'only-public' });
      else if (!fs.readFileSync(path.join(target, file)).equals(git(['show', 'origin/main:' + file])))
        differences.push({ file, status: 'different' });
    }
    const existing = new Set(published);
    for (const file of files) if (!existing.has(file)) differences.push({ file, status: 'only-shared' });
  }
  return { ...result, differences };
}
module.exports = { dryExport };
if (require.main === module) {
  try {
    const args = process.argv.slice(2);
    if (!args.includes('--out')) throw new Error('Use --out SCRATCH [--compare PUBLIC_REPOSITORY]');
    const compare = args.includes('--compare') ? args[args.indexOf('--compare') + 1] : null;
    console.log(
      JSON.stringify(dryExport(path.resolve(__dirname, '..'), args[args.indexOf('--out') + 1], compare), null, 2),
    );
  } catch (error) {
    for (const hit of error.violations || []) console.error(`${hit.file}:${hit.line}`);
    console.error('Dry export failed; check revision, target and privacy inputs');
    process.exitCode = 1;
  }
}
