'use strict';
require('../../tests/sandbox.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '../../..');
const base = 'b85827f51138e287f03387c20a3efd6516d6b9a6';
const python = process.platform === 'win32' ? 'python' : 'python3';

function snapshot(home, prefix = '') {
  return Object.fromEntries(
    fs.readdirSync(path.join(home, prefix)).flatMap(name => {
      const relative = prefix ? prefix + '/' + name : name;
      return fs.statSync(path.join(home, relative)).isDirectory()
        ? Object.entries(snapshot(home, relative))
        : [[relative, fs.readFileSync(path.join(home, relative))]];
    }),
  );
}

test('LegacyInstalledUpdatePreservesSettingsAndOnlyChangesIntendedFiles', t => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-legacy-install-'));
  t.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
  const old = path.join(scratch, 'baseline');
  fs.mkdirSync(old);
  const history = process.env.KIT_TEST_HISTORY
    ? ['--git-dir', process.env.KIT_TEST_HISTORY]
    : require('../../setup/host.cjs').gitArgs();
  const archive = spawnSync('git', [...history, 'archive', base, 'lighthouse/operator-kit'], {
    cwd: root,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (archive.status !== 0) return t.skip('historical fixture requires Git history');
  const extracted = spawnSync('tar', ['-xf', '-'], { cwd: old, input: archive.stdout });
  assert.equal(extracted.status, 0, extracted.stderr?.toString());
  const kit = path.join(root, 'lighthouse/operator-kit');
  const cfg = Object.fromEntries(
    Object.keys(JSON.parse(fs.readFileSync(path.join(kit, 'config.example.json')))).map(key => [key, 'fixture']),
  );
  cfg.__BOARD_SERVER__ = 'http://127.0.0.1:17789';
  cfg.__WATCH_BOARDS__ = 'fixture';
  cfg.protocol = 'tools';
  const input = path.join(scratch, 'input.json');
  const home = path.join(scratch, 'operator home');
  fs.writeFileSync(input, JSON.stringify(cfg));
  const install = (source, config, keep = []) =>
    spawnSync(
      python,
      [
        path.join(source, 'install.py'),
        '--config',
        config,
        '--out',
        home,
        '--repository',
        root,
        '--release',
        base,
        ...keep,
      ],
      {
        encoding: 'utf8',
        env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1', PYTHONIOENCODING: 'utf-8' },
      },
    );
  const legacy = path.join(old, 'lighthouse/operator-kit');
  assert.equal(install(legacy, input).status, 0);
  const config = path.join(home, 'config.json');
  const token = Buffer.from('synthetic-legacy-token\r\n');
  fs.writeFileSync(path.join(home, 'LH-TOKEN.txt'), token);
  const baseline = install(legacy, config, ['--keep-from', config]);
  assert.equal(baseline.status, 0, baseline.stderr);
  const before = snapshot(home);
  const updated = install(kit, config, ['--keep-from', config]);
  assert.equal(updated.status, 0, updated.stderr);
  const after = snapshot(home);
  assert.deepEqual(after['config.json'], before['config.json']);
  assert.deepEqual(after['LH-TOKEN.txt'], token);
  for (const name of Object.keys(after))
    assert.doesNotMatch(name, /(^|\/)(binding\.json|credential\.json|\.mcp\.json|SETUP.*\.json|prepared\.json)$/);
  const changed = Object.keys(after)
    .filter(name => !before[name]?.equals(after[name]))
    .sort();
  assert.deepEqual(
    changed,
    [
      'HANDOFF-RECOVERY.md',
      'KIT-MANIFEST.json',
      'MCP-RECONNECT.json',
      'OPERATOR-BRIEF-TOOLS.md',
      'OPERATOR-BRIEF.md',
      'README.md',
      'RELAY-RECOVERY.md',
      'SETUP.md',
      'WATCH-BRIEF.md',
      'activation-client.cjs',
      'boardwatch.cjs',
      'collector.py',
      'collector_usage.py',
      'dispatch-client.cjs',
      'dispatch-storage.cjs',
      'dispatch-transfer.cjs',
      'fmwatch.cjs',
      'gate.cjs',
      'handoff.cjs',
      'helper-cursors.cjs',
      'helper-generation.cjs',
      'helper-runner.cjs',
      'helper_generation.py',
      'kit-version.cjs',
      'lighthouse-mcp.cjs',
      'mcp-setup.cjs',
      'monitor.cjs',
      'session-identity.cjs',
      'setup-runtime.cjs',
      'shift-session.cjs',
      'shift.sh',
      'target-binding.cjs',
      'watch-lease.cjs',
    ].sort(),
  );
  assert.deepEqual(
    Object.keys(before).filter(name => !Object.hasOwn(after, name)),
    [],
  );
  const addedRuntimeLine = updated.stdout
    .split(/\r?\n/)
    .filter(
      line =>
        ![
          'HANDOFF-RECOVERY.md',
          'activation-client.cjs',
          'helper-cursors.cjs',
          'helper-generation.cjs',
          'helper-runner.cjs',
          'helper_generation.py',
          'target-binding.cjs',
          'setup-runtime.cjs',
          'session-identity.cjs',
          'handoff.cjs',
          'dispatch-client.cjs',
          'dispatch-storage.cjs',
          'dispatch-transfer.cjs',
          'mcp-setup.cjs',
        ].some(name => line.endsWith(name)),
    )
    .join('\n');
  assert.equal(addedRuntimeLine, baseline.stdout.replace(/\r/g, ''), 'installer output adds intended runtime files');
});
