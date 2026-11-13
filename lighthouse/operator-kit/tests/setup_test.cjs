'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { testPort } = require('../../tests/sandbox.cjs');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { init } = require('../../setup/host.cjs');
const { setup } = require('../../setup/operator.cjs');
const { doctor } = require('../../setup/doctor.cjs');
const { read, writePrivate, assertPrivate } = require('../../setup/common.cjs');
const registryCLI = require('../../server/registry-cli');
const root = path.resolve(__dirname, '../../..');
const cli = path.join(root, 'lighthouse/lighthouse.cjs');

test('GuidedOperatorBindGrantAndPrivateStorage', { timeout: 120000 }, async t => {
  const ctx = await require('../../server/tests/registry-http-fixture.cjs').httpFixture(t);
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-guided-bind-'));
  t.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
  const home = path.join(scratch, 'operator home');
  const options = { home, host: ctx.endpoint, trust: true };
  await setup({ ...options, prepare: true });
  const request = read(path.join(home, 'installation-request.json'));
  fs.unlinkSync(path.join(home, 'installation-request.json'));
  await setup({ ...options, prepare: true });
  assert.deepEqual(
    read(path.join(home, 'installation-request.json')),
    request,
    'interrupted request publication retains the same installation proof',
  );
  const marker = read(path.join(home, 'SETUP-PENDING.json'), true);
  const grantFile = path.join(scratch, 'grant.json');
  ctx.enrollment.issue(
    ctx.admin,
    {
      ...request,
      scope: {
        action: 'bind',
        boardId: 'alpha',
        principal: 'installed-operator',
        role: 'operator',
        protocol: 'tools',
        installationId: request.installationId,
      },
    },
    value => writePrivate(grantFile, value),
  );
  const result = await setup({ ...options, 'grant-file': grantFile });
  assert.ok(
    result.checks.every(item => item.status === 'ok'),
    JSON.stringify(result),
  );
  const cfg = read(path.join(home, 'config.json'));
  assert.deepEqual(cfg.adapters, { collector: false, firstmate: false, steward: false, watchers: false });
  assert.equal(cfg.credentialFile, 'credential.json');
  assertPrivate(path.join(home, 'credential.json'));
  const prepared = read(path.join(home, 'prepared.json'), true);
  ctx.privateOutput([prepared.credential, prepared.proof, read(grantFile, true).grant]);
  assert.ok(!JSON.stringify(result).includes(prepared.credential));
  writePrivate(path.join(home, 'SETUP-PENDING.json'), marker);
  assert.ok(
    (await setup({ ...options, 'grant-file': grantFile })).checks.every(item => item.status === 'ok'),
    'interrupted completion publication can be retried',
  );
  const preserved = ['config.json', 'binding.json', 'credential.json', '.mcp.json'];
  const before = preserved.map(name => fs.readFileSync(path.join(home, name)));
  fs.appendFileSync(path.join(home, 'setup-runtime.cjs'), '\n// outdated local runtime\n');
  const updated = spawnSync(
    process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash',
    [path.join(home, 'shift.sh'), 'update'],
    { cwd: home, env: process.env, encoding: 'utf8' },
  );
  assert.equal(updated.status, 0, updated.stdout + updated.stderr);
  assert.match(updated.stdout, /reconnect with \/mcp/);
  preserved.forEach((name, index) => assert.deepEqual(fs.readFileSync(path.join(home, name)), before[index]));
  const noticeFile = path.join(home, 'MCP-RECONNECT.json');
  const notice = JSON.stringify({ target: read(path.join(home, 'KIT-MANIFEST.json')).mcpVersion });
  fs.writeFileSync(noticeFile, notice);
  assert.ok(
    (await doctor(home)).checks.every(item => item.status === 'ok'),
    'updated kit verifies',
  );
  assert.equal(fs.readFileSync(noticeFile, 'utf8'), notice, 'doctor cannot acknowledge an MCP reconnect');
});

test(
  'FreshHostCreateGrantDoctorAndShift',
  {
    skip: process.platform !== 'linux' || !fs.existsSync(path.join(root, '.git')),
    timeout: 120000,
  },
  async t => {
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-fresh-'));
    const home = path.join(scratch, 'board home');
    const operator = path.join(scratch, 'operator home');
    const port = await testPort();
    const origin = 'http://127.0.0.1:' + port;
    const manager = action =>
      spawnSync('bash', [path.join(home, 'board.sh'), action], {
        env: process.env,
        encoding: 'utf8',
        timeout: 30000,
      });
    t.after(() => {
      try {
        if (fs.existsSync(path.join(home, 'board.pid')))
          assert.equal(manager('stop').status, 0, 'scratch manager stopped');
      } finally {
        fs.rmSync(scratch, { recursive: true, force: true });
      }
    });
    const initialization = spawnSync(process.execPath, [cli, 'init', '--home', home, '--port', String(port)], {
      cwd: __dirname,
      env: process.env,
      encoding: 'utf8',
    });
    assert.equal(initialization.status, 0, initialization.stdout + initialization.stderr);
    const initialized = JSON.parse(initialization.stdout);
    assert.equal(initialized.schema, 2);
    assert.equal(fs.existsSync(path.join(home, 'store.json.registry-migration.json')), false);
    const cfg = path.join(home, 'config.json');
    const started = manager('start');
    assert.equal(started.status, 0, started.stdout + started.stderr);
    let reachable = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      try {
        await fetch(origin);
        reachable = true;
        break;
      } catch {}
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.ok(reachable, 'scratch board started');
    const preparedResult = await setup({ home: operator, host: origin, trust: true, prepare: true });
    assert.equal(preparedResult.prepared, true);
    const prepared = read(path.join(operator, 'prepared.json'), true);
    const request = read(path.join(operator, 'installation-request.json'));
    const grantInput = path.join(scratch, 'grant-input.json');
    const grantFile = path.join(scratch, 'grant.json');
    writePrivate(grantInput, {
      ...request,
      scope: {
        action: 'create',
        principal: 'new-operator',
        role: 'operator',
        protocol: 'tools',
        installationId: request.installationId,
      },
      board: { name: 'Scratch board', protocol: 'tools', access: { owner: 'owner' } },
    });
    await registryCLI.run([
      'grant',
      '--config',
      cfg,
      '--credential-file',
      path.join(home, 'admin.json'),
      '--input',
      grantInput,
      '--output',
      grantFile,
    ]);
    const grant = read(grantFile, true);
    // Commit once and discard the reply: setup must recover the same board with the original installation proof.
    await require('../../setup/common.cjs').request(origin, '/api/enrollment/consume', '', {
      ...prepared,
      grant: grant.grant,
      scope: grant.scope,
    });
    const result = await setup({ home: operator, host: origin, trust: true, 'grant-file': grantFile });
    assert.ok(
      result.checks.every(item => item.status === 'ok'),
      JSON.stringify(result),
    );
    const hostReport = await doctor(home);
    assert.ok(
      hostReport.checks.every(item => item.status === 'ok'),
      JSON.stringify(hostReport),
    );
    assertPrivate(path.join(operator, 'credential.json'));
    assert.equal(fs.existsSync(path.join(operator, 'LH-TOKEN.txt')), false);
    const secrets = [prepared.proof, prepared.credential, grant.grant, read(path.join(home, 'admin.json')).credential];
    const printed =
      JSON.stringify([initialized, preparedResult, result, hostReport]) +
      started.stdout +
      fs.readFileSync(path.join(home, 'board.log'), 'utf8');
    for (const secret of secrets) {
      assert.ok(!printed.includes(secret), 'redacted results and server logs');
      for (const name of fs.readdirSync(operator).filter(name => /\.(cjs|sh|ps1)$/.test(name)))
        assert.ok(!fs.readFileSync(path.join(operator, name), 'utf8').includes(secret), 'secret absent from scripts');
    }
    for (const action of ['start', 'stop']) {
      const child = spawn('bash', [path.join(operator, 'shift.sh'), action], {
        cwd: operator,
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let output = '';
      child.stdout.on('data', data => {
        output += data;
      });
      child.stderr.on('data', data => {
        output += data;
      });
      const status = await new Promise(resolve => child.once('exit', resolve));
      assert.equal(status, 0, output);
      for (const secret of secrets) assert.ok(!output.includes(secret), 'shift output redacted');
    }
    const before = fs.readFileSync(cfg);
    await assert.rejects(init({ home, port }), /Existing home refused/);
    assert.deepEqual(fs.readFileSync(cfg), before);
    await assert.rejects(setup({ home: operator, host: origin, trust: true }), /Existing home refused/);
    const binding = read(path.join(operator, 'binding.json'));
    assert.equal(binding.boardId, grant.scope.boardId);
    const selection = read(path.join(home, 'store.json.registry/current.json'));
    const metadata = read(path.join(home, 'store.json.registry', selection.generation + '.json'));
    assert.equal(Object.keys(metadata.boards).length, 1, 'lost response retries create only one board');
  },
);

test('SetupSecretsNeverEnterDiagnosticsOrArguments', () => {
  for (const args of [
    ['operator', 'setup', '--token', 'synthetic-secret'],
    ['operator', 'setup', '--host', 'https://synthetic-secret@example.invalid', '--trust'],
  ]) {
    const result = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.ok(!(result.stdout + result.stderr).includes('synthetic-secret'));
  }
});

test('ExistingUpdateArmIsUnchanged', t => {
  const history = process.env.KIT_TEST_HISTORY
    ? ['--git-dir', process.env.KIT_TEST_HISTORY]
    : require('../../setup/host.cjs').gitArgs();
  const baseline = spawnSync('git', [...history, 'show', 'b85827f:lighthouse/operator-kit/scripts/shift.sh'], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, MSYS_NO_PATHCONV: '1' },
  });
  if (baseline.status !== 0) return t.skip('historical fixture requires private Git history');
  const current = fs.readFileSync(path.join(root, 'lighthouse/operator-kit/scripts/shift.sh'), 'utf8');
  const arm = source => source.replace(/\r/g, '').split('  update)')[1].split('  claim)')[0];
  assert.equal(arm(current), arm(baseline.stdout));
});
