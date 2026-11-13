'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { gitArgs } = require('./git-args.cjs');
const { classify } = require('./shared-files.cjs');
const { scan } = require('./check-private.cjs');

function scratchTarget(destination, protectedRoots = []) {
  const absolute = path.resolve(destination);
  let ancestor = absolute;
  while (!fs.existsSync(ancestor)) ancestor = path.dirname(ancestor);
  const target = path.resolve(fs.realpathSync(ancestor), path.relative(ancestor, absolute));
  for (let folder = target; ; folder = path.dirname(folder)) {
    if (fs.existsSync(path.join(folder, '.git'))) throw new Error('Use a scratch destination outside repositories');
    if (folder === path.dirname(folder)) break;
  }
  for (const root of protectedRoots) {
    const relative = path.relative(fs.realpathSync(root), target);
    if (!relative || (!relative.startsWith('..' + path.sep) && !path.isAbsolute(relative)))
      throw new Error('Use a scratch destination outside repositories');
  }
  if (fs.existsSync(target) && (!fs.statSync(target).isDirectory() || fs.readdirSync(target).length))
    throw new Error('The scratch export destination must be empty');
  return target;
}

function exportPublic(root, destination, revision = 'HEAD', options = {}) {
  const target = scratchTarget(destination, [root, options.reference].filter(Boolean));
  const git = (args, input) =>
    execFileSync('git', [...gitArgs(root), ...args], {
      maxBuffer: 32 * 1024 * 1024,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, MSYS_NO_PATHCONV: '1' },
      input,
    });
  const commit = git(['rev-parse', '--verify', '--end-of-options', revision + '^{commit}'])
    .toString()
    .trim();
  const rows = git(['ls-tree', '-rz', commit]).toString().split('\0').filter(Boolean);
  const included = [];
  const excluded = new Map();
  for (const row of rows) {
    const tab = row.indexOf('\t');
    const [mode, type, object] = row.slice(0, tab).split(' ');
    const file = row.slice(tab + 1);
    const reason = classify(file);
    if (reason) {
      excluded.set(file.startsWith('private/') ? 'private/' : file, reason);
      continue;
    }
    if (type !== 'blob' || !['100644', '100755'].includes(mode)) throw new Error('Unsupported shared file type');
    if (file.includes('\\') || file.split('/').some(part => !part || part === '..' || part.includes(':')))
      throw new Error('Unsupported shared path');
    included.push({ file, object, mode });
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const stage = fs.mkdtempSync(path.join(path.dirname(target), '.lh-export-'));
  try {
    const blobs = git(['cat-file', '--batch'], included.map(entry => entry.object).join('\n') + '\n');
    let cursor = 0;
    for (const { file, object, mode } of included) {
      const end = blobs.indexOf(10, cursor);
      const [actual, type, length] = blobs.subarray(cursor, end).toString().split(' ');
      const size = Number(length);
      if (end < cursor || actual !== object || type !== 'blob' || !Number.isSafeInteger(size) || size < 0)
        throw new Error('Committed blob could not be read');
      cursor = end + 1;
      const bytes = blobs.subarray(cursor, cursor + size);
      if (bytes.length !== size || blobs[cursor + size] !== 10) throw new Error('Committed blob is incomplete');
      cursor += size + 1;
      const output = path.join(stage, file);
      fs.mkdirSync(path.dirname(output), { recursive: true });
      fs.writeFileSync(output, bytes, { mode: mode === '100755' ? 0o755 : 0o644 });
      fs.utimesSync(output, 946684800, 946684800);
    }
    const exclusions = [...excluded].sort(([a], [b]) => a.localeCompare(b, 'en'));
    const privacy = scan(stage, {
      files: included.map(entry => entry.file),
      reportPaths: exclusions.map(([file]) => file),
      env: options.env || process.env,
    });
    if (privacy.violations.length) {
      const error = new Error('Export refused by privacy check');
      error.violations = privacy.violations;
      throw error;
    }
    if (fs.existsSync(target)) fs.rmdirSync(target);
    fs.renameSync(stage, target);
    return {
      commit,
      files: included.length,
      privacy: privacy.privateTerms ? 'generic and private checks passed' : 'generic checks passed',
      excluded: exclusions.map(([, reason], index) => ({ file: privacy.reportPaths[index], reason })),
    };
  } finally {
    fs.rmSync(stage, { recursive: true, force: true });
  }
}

module.exports = { exportPublic, scratchTarget };
if (require.main === module) {
  try {
    const args = process.argv.slice(2);
    const values = {};
    for (let i = 0; i < args.length; i += 2) {
      if (!['--out', '--ref'].includes(args[i]) || !args[i + 1] || values[args[i]])
        throw new Error('Invalid arguments');
      values[args[i]] = args[i + 1];
    }
    if (!values['--out'] || !values['--ref']) throw new Error('Use --ref COMMIT --out EMPTY_SCRATCH_DIRECTORY');
    console.log(JSON.stringify(exportPublic(path.resolve(__dirname, '..'), values['--out'], values['--ref']), null, 2));
  } catch (error) {
    for (const hit of error.violations || []) console.error(`${hit.file}:${hit.line}`);
    console.error('Public export failed; no completed export was written. Check revision, target and privacy inputs.');
    process.exitCode = 1;
  }
}
