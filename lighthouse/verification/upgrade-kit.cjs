'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { run } = require('../server/tests/deploy-fixture.cjs');
const { write } = require('./upgrade-fixture.cjs');
const repository = path.resolve(__dirname, '../..');
const kit = path.join(repository, 'lighthouse/operator-kit');

async function updateOperators(root, endpoint) {
  const hooks = path.join(root, 'fixture-hooks.sh');
  fs.writeFileSync(
    hooks,
    [
      'unset WSL_DISTRO_NAME',
      'grep() { if [[ "$*" == *microsoft* ]]; then return 1; fi; command grep "$@"; }',
      'cygpath() { echo "$2"; }',
      'powershell() { echo stopped; }',
      'python() { command python3 "$@"; }',
      'wsl() { shift 4; bash "$@"; }',
    ].join(String.fromCharCode(10)),
  );
  const results = [];
  for (const [index, board] of ['harbor', 'studio', 'ledger'].entries()) {
    const home = path.join(root, 'operator-' + board);
    const twin = path.join(root, 'twin-' + board);
    const cfg = Object.fromEntries(
      Object.keys(JSON.parse(fs.readFileSync(path.join(kit, 'config.example.json')))).map(key => [key, 'fixture']),
    );
    Object.assign(cfg, {
      __BOARD_ID__: board,
      __MACHINE_NAME__: 'fixture-' + board,
      __BOARD_SERVER__: endpoint,
      __OPERATOR_WSL_DIR__: twin,
      protocol: index === 2 ? 'lines' : 'tools',
    });
    const input = path.join(root, board + '-input.json');
    write(input, cfg);
    const install = await run('python3', [
      path.join(kit, 'install.py'),
      '--config',
      input,
      '--out',
      home,
      '--repository',
      repository,
      '--release',
      '1'.repeat(40),
    ]);
    assert.equal(install.code, 0, 'fixture legacy installation succeeds');
    fs.cpSync(path.join(home, 'wsl'), twin, { recursive: true });
    const selected = path.join(home, 'config.json');
    const original = fs.readFileSync(selected);
    const token = Buffer.from('synthetic-rehearsal-operator-' + board);
    fs.writeFileSync(path.join(home, 'LH-TOKEN.txt'), token, { mode: 0o600 });
    const update = await run('bash', [path.join(home, 'shift.sh'), 'update'], {
      env: {
        BASH_ENV: hooks,
        KIT_UPDATE_DRIVER: '1',
        SHIFT_HOME: home,
        KIT_UPDATE_SOURCE: repository,
        KIT_UPDATE_REPOSITORY: repository,
        KIT_UPDATE_RELEASE: '2'.repeat(40),
      },
    });
    assert.equal(update.code, 0, 'fixture update succeeds: ' + update.output);
    assert.match(update.output, /Update complete/);
    assert.ok(original.equals(fs.readFileSync(selected)), 'installed configuration bytes survive update');
    assert.ok(token.equals(fs.readFileSync(path.join(home, 'LH-TOKEN.txt'))), 'existing credential survives update');
    for (const name of ['binding.json', 'credential.json', 'SETUP-COMPLETE.json', 'prepared.json'])
      assert.equal(fs.existsSync(path.join(home, name)), false, 'existing homes never enter enrollment');
    results.push({ board, protocol: cfg.protocol, configurationPreserved: true, credentialPreserved: true });
  }
  return results;
}
module.exports = { updateOperators };
