'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { runScenario } = require('../../scripts/run-scenario.cjs');

function alive(pid) {
  try {
    process.kill(pid, 0);
    if (process.platform === 'linux') return !/\)\sZ\s/.test(fs.readFileSync('/proc/' + pid + '/stat', 'utf8'));
    return true;
  } catch {
    return false;
  }
}

async function until(check, message) {
  const deadline = Date.now() + 5000;
  while (!check()) {
    assert.ok(Date.now() < deadline, message);
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

function fixture(context, source) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-release-deadline-'));
  const scripts = path.join(root, 'scripts');
  fs.mkdirSync(scripts);
  fs.writeFileSync(path.join(scripts, 'ci-check.cjs'), source);
  const pids = () =>
    fs
      .readdirSync(scripts)
      .filter(name => name.endsWith('.pid'))
      .map(name => Number(fs.readFileSync(path.join(scripts, name), 'utf8')))
      .filter(pid => pid > 0);
  let stopped = false;
  const waitForDeath = async () => {
    await until(() => pids().every(pid => !alive(pid)), 'owned fixture processes did not terminate');
    stopped = true;
  };
  context.after(async () => {
    if (!stopped) {
      for (const pid of pids().filter(alive)) {
        try {
          process.kill(pid, 'SIGKILL');
        } catch {}
      }
      await waitForDeath();
    }
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10 });
  });
  return { root, pids, waitForDeath, options: { cwd: root, env: process.env, stdio: 'ignore', timeout: 5000 } };
}

const treeSource = [
  "const fs = require('node:fs');",
  "const path = require('node:path');",
  "const { spawn } = require('node:child_process');",
  'const depth = Number(process.argv[2] || 0);',
  "fs.writeFileSync(path.join(__dirname, depth + '.pid'), String(process.pid));",
  "const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash';",
  'const command = [\'"$1" "$2" 1\', \'fixture\', process.execPath, __filename];',
  "if (!depth) spawn(bash, ['-c', ...command], { stdio: 'ignore' });",
  "else if (depth < 2) spawn(process.execPath, [__filename, String(depth + 1)], { stdio: 'ignore' });",
  'setTimeout(() => {}, 30000);',
].join('\n');

test('release deadline stops its child and grandchildren without killing an unrelated process', async context => {
  const unrelated = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  context.after(() => {
    unrelated.kill('SIGKILL');
    unrelated.unref();
  });
  const owned = fixture(context, treeSource);
  const started = Date.now();
  const running = runScenario(owned.options);
  await until(() => owned.pids().length === 3, 'fixture did not start its three owned processes');
  context.diagnostic('Fixture readiness: ' + (Date.now() - started) + 'ms');
  const result = await running;
  const remaining = owned.pids().filter(alive);
  context.diagnostic('Owned fixture processes still running at completion: ' + remaining.length);
  assert.equal(alive(unrelated.pid), true, 'unrelated process must survive');
  await owned.waitForDeath();
  assert.equal(result.status, null);
  assert.equal(result.error.code, 'ETIMEDOUT');
  assert.match(result.error.message, /timed out after 5000ms/);
});

test(
  'release interruption stops the isolated POSIX scenario group',
  { skip: process.platform === 'win32' },
  async context => {
    let runner;
    context.after(() => {
      runner?.kill('SIGKILL');
      runner?.unref();
    });
    const owned = fixture(context, treeSource);
    const runnerPath = path.join(owned.root, 'runner.cjs');
    const resultPath = path.join(owned.root, 'result.json');
    const supervisor = require.resolve('../../scripts/run-scenario.cjs');
    fs.writeFileSync(
      runnerPath,
      [
        'const { runScenario } = require(' + JSON.stringify(supervisor) + ');',
        'runScenario(' + JSON.stringify({ cwd: owned.root, stdio: 'ignore', timeout: 60000 }) + ').then(result => {',
        'require("node:fs").writeFileSync(' + JSON.stringify(resultPath) + ',',
        'JSON.stringify({ status: result.status, error: result.error?.message }));',
        '});',
      ].join('\n'),
    );
    runner = spawn(process.execPath, [runnerPath], { detached: true, stdio: 'ignore' });
    const closed = new Promise(resolve => runner.once('close', resolve));
    await until(() => owned.pids().length === 3, 'fixture did not start its three owned processes');
    process.kill(-runner.pid, 'SIGINT');
    await until(() => runner.exitCode !== null || runner.signalCode !== null, 'interrupted runner did not exit');
    await closed;
    await owned.waitForDeath();
    const result = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
    assert.equal(result.status, null);
    assert.match(result.error, /Scenario interrupted by SIGINT/);
  },
);

test('release deadline preserves both success and ordinary test failure', async context => {
  for (const status of [0, 7]) {
    const owned = fixture(context, 'process.exit(' + status + ');');
    const result = await runScenario(owned.options);
    assert.equal(result.status, status);
    assert.equal(result.error, undefined);
  }
});
