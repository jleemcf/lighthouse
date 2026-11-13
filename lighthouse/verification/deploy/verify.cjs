'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');

if (process.platform !== 'linux') throw new Error('run this verification in Linux/WSL; do not accept skipped tests');
const source = path.resolve(__dirname, '../../server');
const env = { ...process.env };
delete env.TYPESAFE_API_KEY;
const focused = 'RunningVersionMatchesDisk|FailedDeployPreservesRunnableRelease|ReplacementHasBackup';

function tests(directory, pattern) {
  const args = ['--test'];
  if (pattern) args.push('--test-name-pattern=' + pattern);
  args.push(path.join(directory, 'tests', 'deployment.test.js'));
  args.push(path.join(directory, 'tests', 'known-deploy.test.js'));
  const result = spawnSync(process.execPath, args, { env, encoding: 'utf8', timeout: 480000 });
  if (result.error) throw result.error;
  process.stdout.write(result.stdout + result.stderr);
  return result;
}

function mutate(directory, old, replacement) {
  const file = path.join(directory, 'board-release.js');
  const content = fs.readFileSync(file, 'utf8');
  assert.equal(content.split(old).length, 2, 'mutation anchor must occur exactly once');
  fs.writeFileSync(file, content.replace(old, replacement));
}

if (!process.argv.includes('--mutate')) {
  process.exitCode = tests(source).status;
} else {
  assert.equal(tests(source, focused).status, 0, 'unmodified invariants must pass first');
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-deploy-mutations-'));
  try {
    fs.mkdirSync(path.join(scratch, 'tests'));
    fs.copyFileSync(path.join(source, '../tests/sandbox.cjs'), path.join(scratch, 'tests/sandbox.cjs'));
    for (const variant of ['overwrite', 'snapshot']) {
      const copy = path.join(scratch, variant);
      fs.cpSync(source, copy, {
        recursive: true,
        filter: file => !/^(config\.json|store\.json.*|board\.(log|pid)|vapid\.json)$/.test(path.basename(file)),
      });
      if (variant === 'overwrite') {
        mutate(
          copy,
          'copyRelease(source, directory);',
          'copyRelease(source, directory);\n' +
            '      fs.copyFileSync(path.join(source, "server.js"), path.join(home, "server.js"));',
        );
        const result = tests(copy, 'RunningVersionMatchesDisk|FailedDeployPreservesRunnableRelease');
        assert.notEqual(result.status, 0, 'overwriting active code must break both regression tests');
        assert.match(result.stdout + result.stderr, /const broken = ;/);
      } else {
        const anchor = "fs.copyFileSync(settings.storeFile, path.join(record.backup, 'store.json'));";
        mutate(copy, anchor, 'undefined;');
        const result = tests(copy, 'ReplacementHasBackup');
        assert.notEqual(result.status, 0, 'omitting the store backup must break its regression test');
        assert.match(result.stdout + result.stderr, /ENOENT.*store\.json/);
      }
      console.log('caught real-code mutation: ' + variant);
    }
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
  assert.equal(tests(source, focused).status, 0, 'unmodified invariants must still pass after mutation');
}
