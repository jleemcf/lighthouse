'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { exportPublic } = require('./export-public.cjs');
const { runScenario } = require('./run-scenario.cjs');

async function run(root = path.resolve(__dirname, '..')) {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'lighthouse-clean-room-'));
  const exported = path.join(scratch, 'export');
  const env = { ...process.env };
  for (const key of Object.keys(env))
    if (
      /^(?:GIT_|GITHUB_|PRIVATE_TERMS|TYPESAFE_API_KEY|KIT_TEST_HISTORY|NODE_OPTIONS|NODE_TEST_CONTEXT|LH_)/i.test(key)
    )
      delete env[key];
  Object.assign(env, {
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: path.join(scratch, 'no-global-config'),
    GIT_AUTHOR_NAME: 'Release fixture',
    GIT_COMMITTER_NAME: 'Release fixture',
    GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
    GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
    GITHUB_EVENT_NAME: 'push',
    GITHUB_REF: 'refs/heads/main',
  });
  const command = (...args) => {
    const result = spawnSync('git', args, { cwd: exported, env, encoding: 'utf8' });
    assert.equal(result.status, 0, 'clean-room Git command failed');
    return result.stdout.trim();
  };
  const commit = message => {
    command('add', '-A');
    command('-c', 'commit.gpgsign=false', 'commit', '-q', '-m', message);
    return command('rev-parse', 'HEAD');
  };
  const workflow = async (label, before, pullRequest = false) => {
    const logPath = path.join(scratch, label + '.log');
    const log = fs.openSync(logPath, 'w');
    const started = Date.now();
    console.log('Clean room: ' + label + ' started; log: ' + logPath);
    let result;
    try {
      result = await runScenario({
        cwd: exported,
        env: {
          ...env,
          PUSH_BEFORE: before,
          PR_BASE: pullRequest ? before : '',
          GITHUB_EVENT_NAME: pullRequest ? 'pull_request' : 'push',
          PRIVATE_TERMS: pullRequest ? '' : ['Synthetic', 'Release', 'Canary'].join(''),
        },
        stdio: ['ignore', log, log],
        timeout: 33 * 60 * 1000,
      });
    } finally {
      fs.closeSync(log);
    }
    if (result.error || result.status !== 0) {
      const reason = result.error ? result.error.message : 'exit ' + result.status;
      throw new Error('Clean-room scenario failed: ' + label + '; ' + reason + '; log: ' + logPath);
    }
    const output = fs.readFileSync(logPath, 'utf8');
    for (const step of ['privacy', 'tests', 'page', 'rulings', 'generated-content'])
      assert.ok(output.includes('CI check: ' + step + ' -> pass'), label + ' completed ' + step);
    assert.ok(
      output.includes('Privacy check passed (' + (pullRequest ? 'generic checks)' : 'generic and private checks)')),
    );
    assert.match(output, /ok\s+server \([1-9]\d* pass, 0 fail/);
    console.log('Clean room: ' + label + ' -> pass (' + (Date.now() - started) / 1000 + 's)');
  };
  let passed = false;
  try {
    exportPublic(root, exported, 'HEAD', { env });
    assert.equal(fs.existsSync(path.join(exported, 'private')), false);
    assert.equal(fs.existsSync(path.join(exported, '.git')), false);
    command('init', '-q', '--initial-branch=main');
    const first = commit('Initial export fixture');
    assert.equal(command('rev-list', '--count', 'HEAD'), '1');
    await workflow('initial-push', '0'.repeat(40));
    fs.writeFileSync(path.join(exported, 'docs/delete-fixture.txt'), 'Synthetic deletion fixture\n');
    fs.writeFileSync(path.join(exported, 'docs/rename-fixture.txt'), 'Synthetic rename fixture\n');
    const later = commit('Later push fixture');
    await workflow('later-push', first);
    command('rm', 'docs/delete-fixture.txt');
    command('mv', 'docs/rename-fixture.txt', 'docs/renamed-fixture.txt');
    const changed = commit('Deletion and rename fixture');
    assert.match(command('diff', '--name-status', '-M', later, changed), /D\s+docs\/delete-fixture/);
    assert.match(command('diff', '--name-status', '-M', later, changed), /R100\s+docs\/rename-fixture/);
    await workflow('deletion-and-rename', later);
    command('checkout', '-q', '-b', 'fork-fixture');
    fs.appendFileSync(path.join(exported, 'README.md'), '\nSynthetic fork documentation fixture.\n');
    commit('Fork fixture');
    await workflow('fork-without-private-list', changed, true);
    passed = true;
  } finally {
    if (passed) fs.rmSync(scratch, { recursive: true, force: true });
    else console.error('Clean-room failure retained at ' + scratch);
  }
}
module.exports = { run };
