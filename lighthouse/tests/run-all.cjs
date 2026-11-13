'use strict';
require('./sandbox.cjs');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.join(__dirname, '..');
const preload = path.join(__dirname, 'sandbox.cjs');
const python = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
let failed = false;

function files(directory, suffix) {
  return fs
    .readdirSync(path.join(root, directory))
    .filter(name => name.endsWith(suffix))
    .sort();
}

function run(label, executable, args, cwd = root) {
  const result = spawnSync(executable, args, {
    cwd,
    env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONDONTWRITEBYTECODE: '1' },
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  const output = (result.stdout || '') + (result.stderr || '');
  if (result.status !== 0) {
    failed = true;
    console.log('FAIL  ' + label);
    console.log(result.error ? result.error.message : output);
    return;
  }
  const totals = [...output.matchAll(/^# (pass|fail|cancelled|skipped|todo) (\d+)$/gm)];
  const summary = totals.length
    ? totals.map(match => `${match[2]} ${match[1]}`).join(', ')
    : output.trim().split('\n').pop();
  console.log(`ok    ${label} (${summary})`);
}

function nodeSuite(label, directory, names) {
  run(
    label,
    process.execPath,
    [
      '--require',
      preload,
      '--test',
      '--test-reporter=tap',
      ...(directory === 'server' ? ['--test-concurrency=1'] : []),
      ...names,
    ],
    path.join(root, directory),
  );
}

nodeSuite('files and harness', 'tests', files('tests', '.test.cjs'));
nodeSuite(
  'server',
  'server',
  files('server/tests', '.test.js').map(name => 'tests/' + name),
);
nodeSuite(
  'board scene',
  'board',
  files('board/tests', '.test.cjs').map(name => 'tests/' + name),
);
for (const name of files('operator-kit/tests', '_test.cjs'))
  nodeSuite('kit ' + path.basename(name, '.cjs'), 'operator-kit/tests', [name]);
for (const name of files('operator-kit/tests', '_test.py'))
  run('kit ' + path.basename(name, '.py'), python, [path.join(root, 'operator-kit/tests', name)]);
process.exitCode = failed ? 1 : 0;
