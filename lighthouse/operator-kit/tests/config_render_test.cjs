'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');
const { bash, python, env } = require('../../verification/update/bootstrap-replay.cjs');
const kit = path.resolve(__dirname, '..');

function setup(context) {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-render-'));
  context.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
  const source = path.join(scratch, 'kit');
  fs.cpSync(kit, source, { recursive: true });
  const config = Object.fromEntries(
    Object.keys(JSON.parse(fs.readFileSync(path.join(kit, 'config.example.json')))).map(key => [key, 'fixture']),
  );
  const home = path.join(scratch, 'home');
  return {
    source,
    config,
    home,
    install() {
      const file = path.join(scratch, 'config.json');
      fs.writeFileSync(file, JSON.stringify(config));
      return spawnSync(python, [path.join(source, 'install.py'), '--config', file, '--out', home], {
        env,
        encoding: 'utf8',
        timeout: 60000,
      });
    },
  };
}

function runShell(fixture, code) {
  const script = path.join(fixture.source, 'render-check.sh');
  fs.writeFileSync(script, code);
  return spawnSync(bash, [script], { env, encoding: 'utf8' });
}

test('apostrophes, backslashes and spaces remain literal in installed paths', context => {
  const fixture = setup(context);
  const directory = "C:\\Users\\O'Brien\\operator home";
  fixture.config.__OPERATOR_TRANSCRIPT_DIR__ = directory;
  fixture.config.__WINDOWS_USER__ = "O'Brien";
  fixture.config.__FM_HOME__ = "/home/O'Brien/first mate";
  fixture.config.__OPERATOR_WSL_DIR__ = "/home/O'Brien/operator home";
  const installed = fixture.install();
  assert.equal(installed.status, 0, installed.stderr);
  const mcp = path.join(fixture.home, 'lighthouse-mcp.cjs');
  const syntax = spawnSync(process.execPath, ['--check', mcp], { env, encoding: 'utf8' });
  assert.equal(syntax.status, 0, syntax.stderr);
  const line = fs
    .readFileSync(mcp, 'utf8')
    .split('\n')
    .find(text => text.startsWith('const TRANSCRIPTS ='));
  const value = vm.runInNewContext(line + '\nTRANSCRIPTS', { process: { env: {} }, CFG: {} });
  assert.equal(value, directory);
  const shell = fs
    .readFileSync(path.join(fixture.home, 'wsl/fm-send.sh'), 'utf8')
    .split('\n')
    .find(text => text.startsWith('FM_HOME='));
  const output = runShell(fixture, shell.split('; D=')[0] + '; printf "%s" "$FM_HOME"');
  assert.equal(output.status, 0, output.stderr);
  assert.equal(output.stdout, fixture.config.__FM_HOME__);
  const collector = fs.readFileSync(path.join(fixture.home, 'Start-Collector.ps1'), 'utf8');
  assert.ok(collector.includes("$transcripts = '" + directory.replaceAll("'", "''") + "'"));
});

test('ordinary configuration keeps the legacy rendered bytes', context => {
  const fixture = setup(context);
  const installed = fixture.install();
  assert.equal(installed.status, 0, installed.stderr);
  for (const name of fs.readdirSync(path.join(fixture.source, 'scripts'))) {
    let expected = fs.readFileSync(path.join(fixture.source, 'scripts', name), 'utf8').replaceAll('\r\n', '\n');
    for (const [key, value] of Object.entries(fixture.config)) expected = expected.replaceAll(key, value);
    const sub = ['lh-probe.sh', 'lh-pending.py', 'record-check.py', 'record-check.sh', 'fm-send.sh'].includes(name)
      ? 'wsl'
      : '';
    let actual = fs.readFileSync(path.join(fixture.home, sub, name), 'utf8');
    if (name === 'lighthouse-mcp.cjs')
      actual = actual.replace(/const KIT_SOURCE = '[a-f0-9]{64}'/, "const KIT_SOURCE = 'kit-mcp-source-v1'");
    if (name === 'kit-version.cjs')
      actual = actual.replace(/const HELPER_SOURCE = '[a-f0-9]{64}'/, "const HELPER_SOURCE = 'kit-helper-source-v1'");
    assert.equal(actual, expected, name);
  }
});

test('nested shell, Python, JSON and executable command values stay literal', context => {
  const fixture = setup(context);
  const value = 'O\'Brien\\folder with spaces"$HOME$(false)' + String.fromCharCode(96) + 'false';
  fixture.config.__FM_HOME__ = '/home/' + value;
  fixture.config.__OPERATOR_TRANSCRIPT_DIR__ = 'C:\\Users\\' + value;
  fixture.config.__OPERATOR_WSL_DIR__ = '/home/' + value;
  fixture.config.__FM_SEND__ = 'printf "%s" "{file}"; printf ' + "'quoted command'";
  fs.writeFileSync(path.join(fixture.source, 'scripts/fixture.json'), '{"path":"__OPERATOR_TRANSCRIPT_DIR__"}');
  const result = fixture.install();
  assert.equal(result.status, 0, result.stderr);
  const json = JSON.parse(fs.readFileSync(path.join(fixture.home, 'fixture.json')));
  assert.equal(json.path, fixture.config.__OPERATOR_TRANSCRIPT_DIR__);
  const probe = fs.readFileSync(path.join(fixture.home, 'wsl/lh-probe.sh'), 'utf8');
  const comparison = probe
    .split('\n')
    .find(line => line.includes('if a.get("cwd") == '))
    .match(/== (.*):/)[1];
  const unpacked = runShell(fixture, "python() { printf '%s' \"$2\"; }; python -c 'print(" + comparison + ")'");
  assert.equal(unpacked.status, 0, unpacked.stderr);
  const embedded = spawnSync(python, ['-c', unpacked.stdout], { env, encoding: 'utf8' });
  assert.equal(embedded.status, 0, embedded.stderr);
  assert.equal(embedded.stdout.trimEnd(), fixture.config.__FM_HOME__);
  const relay = fs.readFileSync(path.join(fixture.home, 'relay.sh'), 'utf8');
  const assignments = relay.split('\n').find(line => line.startsWith('FM_SEND='));
  const command = runShell(fixture, assignments + '; printf "%s" "$FM_SEND"');
  assert.equal(command.status, 0, command.stderr);
  assert.equal(command.stdout, fixture.config.__FM_SEND__);
  const sweep = fs.readFileSync(path.join(fixture.home, 'lighthouse-sweep.sh'), 'utf8');
  const poll = sweep.split('\n').find(line => line.trimStart().startsWith('P=$(timeout'));
  const nested = runShell(
    fixture,
    ['timeout() { shift; "$@"; }', 'wsl() { printf "%s" "$6"; }', poll, 'printf "%s" "$P"'].join('\n'),
  );
  assert.equal(nested.status, 0, nested.stderr);
  const argument = runShell(fixture, 'bash() { printf "%s" "$1"; }; ' + nested.stdout);
  assert.equal(argument.status, 0, argument.stderr);
  assert.equal(argument.stdout, fixture.config.__OPERATOR_WSL_DIR__ + '/lh-probe.sh');
});

for (const name of ['broken.js', 'broken.cjs', 'broken.sh', 'broken.json', 'broken.ps1']) {
  test('invalid generated ' + name + ' fails before any installation write', context => {
    if (
      name.endsWith('.ps1') &&
      process.platform !== 'win32' &&
      spawnSync('pwsh', ['-NoProfile', '-Command', 'exit 0'], { env }).error
    )
      return context.skip('no PowerShell');
    const fixture = setup(context);
    fs.mkdirSync(fixture.home);
    const sentinel = path.join(fixture.home, 'KIT-MANIFEST.json');
    fs.writeFileSync(sentinel, 'untouched');
    fs.writeFileSync(path.join(fixture.home, 'shift.sh.new'), 'pending and untouched');
    fs.writeFileSync(path.join(fixture.home, 'MCP-RECONNECT.json'), 'notice and untouched');
    const broken = name.endsWith('.ps1') ? 'function Broken {' : name.endsWith('.sh') ? 'if then' : '{ broken';
    fs.writeFileSync(path.join(fixture.source, 'scripts', name), broken);
    const result = fixture.install();
    assert.notEqual(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stderr, /validation.*failed|failed.*validation/i);
    assert.ok(result.stderr.includes(name));
    assert.deepEqual(fs.readdirSync(fixture.home).sort(), ['KIT-MANIFEST.json', 'MCP-RECONNECT.json', 'shift.sh.new']);
    assert.equal(fs.readFileSync(sentinel, 'utf8'), 'untouched');
    assert.equal(fs.readFileSync(path.join(fixture.home, 'shift.sh.new'), 'utf8'), 'pending and untouched');
    assert.equal(fs.readFileSync(path.join(fixture.home, 'MCP-RECONNECT.json'), 'utf8'), 'notice and untouched');
    for (const entry of fs.readdirSync(fixture.home)) fs.unlinkSync(path.join(fixture.home, entry));
    fs.rmdirSync(fixture.home);
    const fresh = fixture.install();
    assert.notEqual(fresh.status, 0, fresh.stdout + fresh.stderr);
    assert.ok(fresh.stderr.includes(name));
    assert.equal(fs.existsSync(fixture.home), false, 'a rejected fresh install must not create its home');
  });
}
