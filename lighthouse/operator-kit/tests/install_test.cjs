'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const childProcess = require('node:child_process');
const { bash, python, env } = require('../../verification/update/bootstrap-replay.cjs');
const kit = path.resolve(__dirname, '..');
const spawnSync = childProcess.spawnSync;

test('retired helpers are not installed or required and existing home copies remain unarmed', context => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-retired-install-'));
  context.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
  const home = path.join(scratch, 'operator');
  fs.mkdirSync(home);
  const obsolete = ['stwatch.cjs', 'lhwake.sh'];
  for (const name of obsolete) fs.writeFileSync(path.join(home, name), 'inert historical fixture\n');
  const config = Object.fromEntries(
    Object.keys(JSON.parse(fs.readFileSync(path.join(kit, 'config.example.json')))).map(key => [key, 'fixture']),
  );
  assert.equal(Object.hasOwn(config, '__STEWARD_THREAD_ID__'), false);
  assert.equal(Object.hasOwn(config, '__CODEX_EXE__'), false);
  const file = path.join(scratch, 'config.json');
  fs.writeFileSync(file, JSON.stringify(config));
  const result = spawnSync(python, [path.join(kit, 'install.py'), '--config', file, '--out', home], {
    env,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  const manifest = JSON.parse(fs.readFileSync(path.join(home, 'KIT-MANIFEST.json')));
  for (const name of obsolete) {
    assert.equal(Object.hasOwn(manifest.files, name), false);
    assert.equal(fs.readFileSync(path.join(home, name), 'utf8'), 'inert historical fixture\n');
  }
  assert.ok(Object.hasOwn(manifest.files, 'stwake.cjs'), 'the advice runner remains installed');
  const initialVersion = manifest.mcpVersion;
  for (const name of ['target-binding.cjs', 'helper-cursors.cjs', 'helper-generation.cjs']) {
    const reconnect = path.join(home, 'MCP-RECONNECT.json');
    fs.rmSync(reconnect, { force: true });
    fs.appendFileSync(path.join(home, name), '\n');
    const updated = spawnSync(python, [path.join(kit, 'install.py'), '--config', file, '--out', home], {
      env,
      encoding: 'utf8',
    });
    assert.equal(updated.status, 0, updated.stderr);
    assert.equal(JSON.parse(fs.readFileSync(reconnect, 'utf8')).target, initialVersion);
  }
});

for (const fault of ['none', 'mismatch']) {
  test('fresh install publishes a verified WSL version: ' + fault, context => {
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-install spaces-'));
    context.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
    const home = path.join(scratch, "operator's home");
    const twin = path.join(scratch, "operator's twin");
    const config = Object.fromEntries(
      Object.keys(JSON.parse(fs.readFileSync(path.join(kit, 'config.example.json')))).map(key => [key, 'fixture']),
    );
    config.__OPERATOR_WSL_DIR__ = twin.replace(/\\/g, '/');
    const configPath = path.join(scratch, 'config.json');
    fs.writeFileSync(configPath, JSON.stringify(config));
    const installed = spawnSync(python, [path.join(kit, 'install.py'), '--config', configPath, '--out', home], {
      env,
      encoding: 'utf8',
    });
    assert.equal(installed.status, 0, installed.stderr);
    const command = installed.stdout
      .split(/\r?\n/)
      .find(line => line.trimStart().startsWith('MSYS_NO_PATHCONV=1 wsl '));
    assert.ok(command, 'installer must print the verified fresh-install WSL command');
    const hooks = [
      'set -u',
      'wsl() {',
      '  [ "$3" = -e ] || return 40',
      '  shift 4; args=()',
      '  for arg in "$@"; do',
      process.platform === 'win32'
        ? '    if [[ "$arg" == /mnt/?/* ]]; then arg="$(cygpath -am "/${arg:5}")"; fi'
        : '    :',
      '    args+=("$arg"); done',
      '  python3() { command ' + python + ' "$@"; }; export -f python3',
      '  chmod() { command chmod "$@" || return;',
      fault === 'mismatch' ? '    printf corrupt > "$KIT_TEST_TWIN/lh-probe.sh"' : '    :',
      '  }; export -f chmod',
      '  bash "${args[@]}"',
      '}',
      command,
    ].join('\n');
    const script = path.join(scratch, 'install-wsl.sh');
    fs.writeFileSync(script, hooks);
    const copied = spawnSync(bash, [script], {
      env: { ...env, KIT_TEST_TWIN: twin.replace(/\\/g, '/') },
      encoding: 'utf8',
      timeout: 30000,
    });
    const receipt = path.join(twin, 'KIT-MANIFEST.json');
    if (fault === 'mismatch') {
      assert.notEqual(copied.status, 0, copied.stdout + copied.stderr);
      assert.match(copied.stderr, /Kit verification failed/);
      assert.equal(fs.existsSync(receipt), false, 'failed verification must not publish a receipt');
      return;
    }
    assert.equal(copied.status, 0, copied.stdout + copied.stderr);
    const manifest = JSON.parse(fs.readFileSync(path.join(home, 'KIT-MANIFEST.json')));
    assert.deepEqual(JSON.parse(fs.readFileSync(receipt)), manifest);
    context.mock.method(childProcess, 'spawnSync', (command, args, options) => {
      if (command !== 'wsl') return spawnSync(command, args, options);
      assert.deepEqual(args.slice(0, 4), ['-d', 'fixture', '-e', 'python3']);
      return spawnSync(python, [path.join(home, 'kit-state.py'), ...args.slice(5)], { ...options, env });
    });
    const status = require(path.join(home, 'kit-version.cjs')).status(home);
    assert.ok(status.includes('Installed Windows: ' + manifest.release), status);
    assert.ok(status.includes('Installed WSL: ' + manifest.release), status);
    assert.doesNotMatch(status, /Installed WSL: unknown/);
  });
}
