'use strict';
require('../../tests/sandbox.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn, spawnSync } = require('node:child_process');
const { once } = require('node:events');
const { test } = require('node:test');
const { source, copyCode } = require('./deploy-fixture.cjs');

async function failedDeploy(context) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-deploy-rule-'));
  const candidate = path.join(root, 'candidate');
  const active = path.join(root, 'active');
  for (const directory of [candidate, active]) copyCode(source, directory);
  for (const file of ['config.json', 'store.json']) fs.writeFileSync(path.join(active, file), '{}');
  const oldSource = [
    "const http = require('node:http');",
    "const server = http.createServer((request, response) => response.end('old-release'));",
    "server.listen(0, '127.0.0.1', () => console.log(server.address().port));",
  ].join('\n');
  fs.writeFileSync(path.join(active, 'server.js'), oldSource);
  const running = spawn(process.execPath, [path.join(active, 'server.js')], { env: process.env });
  context.after(async () => {
    if (running.exitCode === null && running.signalCode === null) {
      const exited = once(running, 'exit');
      running.kill();
      await exited;
    }
    fs.rmSync(root, { recursive: true, force: true });
  });
  const [data] = await once(running.stdout, 'data');
  const port = Number(String(data).trim());
  assert.ok(port > 0 && port !== 7700);
  fs.writeFileSync(path.join(active, 'config.json'), JSON.stringify({ port, bind: '127.0.0.1' }));
  const invalid = 'const broken = ;\n';
  fs.writeFileSync(path.join(candidate, 'server.js'), invalid);
  const result = spawnSync(process.execPath, [path.join(candidate, 'board-release.js'), 'deploy', candidate, active], {
    env: process.env,
    encoding: 'utf8',
  });
  assert.ifError(result.error);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /JavaScript syntax validation failed: server.js/, 'real candidate validation ran');
  const response = await new Promise((resolve, reject) => {
    http
      .get(`http://127.0.0.1:${port}/`, reply => {
        let text = '';
        reply.on('data', chunk => (text += chunk));
        reply.on('end', () => resolve(text));
      })
      .on('error', reject);
  });
  assert.equal(response, 'old-release', 'the prior process is still serving');
  const backup = fs.readdirSync(active).find(name => name.startsWith('backup-before-'));
  if (backup) assert.equal(fs.readFileSync(path.join(active, backup, 'server.js'), 'utf8'), oldSource);
  return { active, oldSource };
}

test('RunningVersionMatchesDisk: rejected syntax never overwrites the serving release', async context => {
  const { active, oldSource } = await failedDeploy(context);
  assert.equal(
    fs.readFileSync(path.join(active, 'server.js'), 'utf8'),
    oldSource,
    'a running release must keep its own active files until activation',
  );
});

test('FailedDeployPreservesRunnableRelease: rejected candidate leaves a runnable restart target', async context => {
  const { active } = await failedDeploy(context);
  const checked = spawnSync(process.execPath, ['--check', path.join(active, 'server.js')], { encoding: 'utf8' });
  assert.ifError(checked.error);
  assert.equal(checked.status, 0, 'failed validation must leave a runnable restart target');
});
