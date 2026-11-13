'use strict';
require('../../tests/sandbox.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { applyProfile } = require('../../../scripts/apply-profile.cjs');
const kit = path.resolve(__dirname, '..');

test('PolicyApplyPreservesRunningBytesForEqualContent', t => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-policy-bytes-'));
  t.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
  const repositoryBytes = Buffer.from('{\n  "rulings": []\n}\n');
  const runningBytes = Buffer.from(repositoryBytes.toString().replace(/\n/g, '\r\n'));
  fs.writeFileSync(path.join(scratch, 'rulings.json'), runningBytes);
  fs.writeFileSync(path.join(scratch, 'source.json'), repositoryBytes);
  const config = path.join(scratch, 'config.json');
  fs.writeFileSync(config, '{}');
  const profile = path.join(scratch, 'profile.json');
  fs.writeFileSync(
    profile,
    JSON.stringify({
      server: {},
      policy: { file: 'source.json', sha256: crypto.createHash('sha256').update(repositoryBytes).digest('hex') },
    }),
  );
  applyProfile(config, profile);
  assert.deepEqual(fs.readFileSync(path.join(scratch, 'profile-policies.json')), runningBytes);
  assert.equal(readConfig(config).rulingsFile, 'profile-policies.json');
  fs.copyFileSync(config + '.pre-profile.1', config);
  applyProfile(config, profile);
  assert.deepEqual(fs.readFileSync(path.join(scratch, 'profile-policies.json')), runningBytes);
  assert.equal(readConfig(config).rulingsFile, 'profile-policies.json');
  fs.writeFileSync(path.join(scratch, 'rulings.json'), '{"rulings":[{"text":"different"}]}');
  fs.unlinkSync(path.join(scratch, 'profile-policies.json'));
  fs.writeFileSync(config, '{}');
  applyProfile(config, profile);
  assert.deepEqual(fs.readFileSync(path.join(scratch, 'profile-policies.json')), repositoryBytes);
});
function readConfig(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

test('SetupRefusesUntrustedHostsAndPopulatedHomesBeforeWrites', async t => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-setup-refusal-'));
  t.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
  const home = path.join(scratch, 'existing');
  fs.mkdirSync(home);
  fs.writeFileSync(path.join(home, 'config.json'), '{"preserve":true}');
  const setup = require('../../setup/operator.cjs').setup;
  const snapshot = fs.readFileSync(path.join(home, 'config.json'));
  const options = { home, host: 'http://127.0.0.1:7711' };
  await assert.rejects(setup(options), /trust/);
  await assert.rejects(setup({ ...options, trust: true }), /Existing home refused/);
  assert.deepEqual(fs.readdirSync(home), ['config.json']);
  assert.deepEqual(fs.readFileSync(path.join(home, 'config.json')), snapshot);
});

test('EmptyOwnerLabelFallbackMatchesCollectorAndUsage', t => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-owner-fallback-'));
  t.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
  for (const name of ['collector.py', 'collector_usage.py', 'helper_generation.py'])
    fs.copyFileSync(path.join(kit, 'scripts', name), path.join(scratch, name));
  fs.writeFileSync(path.join(scratch, 'config.json'), '{"ownerName":""}');
  const result = spawnSync(
    process.platform === 'win32' ? 'python' : 'python3',
    [
      '-c',
      'import collector,collector_usage; assert collector.owner_label == collector_usage.owner_name == "the captain"',
    ],
    {
      cwd: scratch,
      encoding: 'utf8',
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
    },
  );
  assert.equal(result.status, 0, result.stderr);
});

test('ShiftStartPrecedesMonitorArmingInEveryBrief', () => {
  for (const name of ['OPERATOR-BRIEF.md', 'OPERATOR-BRIEF-TOOLS.md', 'WATCH-BRIEF.md', 'README.md']) {
    const text = fs.readFileSync(path.join(kit, name), 'utf8');
    assert.match(text, /Run `bash shift\.sh start` before arming Monitors/);
    assert.match(text, /exit 127/);
  }
  const source = fs.readFileSync(path.join(kit, 'scripts/shift.sh'), 'utf8');
  assert.match(source, /start\)\s+kill_watchers; swap_new/);
});

test('DoctorProbeLeavesNoHeartbeatOrLoadedReceipt', async t => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-doctor-probe-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const requests = [];
  const server = require('node:http').createServer((request, response) => {
    requests.push(request.method + ' ' + request.url);
    response.end('{}');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  for (const name of [
    'lighthouse-mcp.cjs',
    'kit-version.cjs',
    'shift-session.cjs',
    'session-identity.cjs',
    'handoff.cjs',
    'dispatch-client.cjs',
    'dispatch-storage.cjs',
    'mcp-setup.cjs',
    'toolcalls-spec.json',
  ])
    fs.copyFileSync(path.join(kit, 'scripts', name), path.join(home, name));
  fs.writeFileSync(
    path.join(home, 'config.json'),
    JSON.stringify({
      server: 'http://127.0.0.1:' + server.address().port,
      board: 'fixture',
      protocol: 'tools',
    }),
  );
  fs.writeFileSync(path.join(home, 'LH-TOKEN.txt'), 'synthetic-probe-credential');
  const { probe } = require('../scripts/setup-runtime.cjs');
  assert.equal(await probe(process.execPath, [path.join(home, 'lighthouse-mcp.cjs')], home), true);
  assert.deepEqual(requests, [], 'doctor must not announce tool-server presence');
  const receipts = path.join(home, 'mcp-loaded');
  assert.deepEqual(fs.existsSync(receipts) ? fs.readdirSync(receipts) : [], [], 'probe leaves no session receipt');
});
