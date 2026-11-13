'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'shift.sh'), 'utf8').replace(/\r/g, '');
const update = source.slice(source.indexOf('  update)\n'), source.indexOf('\n  claim)'));
const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash';

for (const changed of ['none', 'lighthouse-mcp.cjs', 'toolcalls-spec.json', 'other.txt', 'lighthouse-mcp.cjs.new'])
  test('update reconnect notice: ' + changed, t => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-update-'));
    t.after(() => fs.rmSync(home, { recursive: true, force: true }));
    fs.mkdirSync(path.join(home, 'repo'));
    fs.writeFileSync(path.join(home, 'REPO.txt'), 'fixture\n' + home.replace(/\\/g, '/') + '/repo\n');
    for (const file of ['lighthouse-mcp.cjs', 'toolcalls-spec.json']) fs.writeFileSync(path.join(home, file), 'old');
    const env = { ...process.env };
    delete env.TYPESAFE_API_KEY;
    const script = [
      'set -u',
      'HERE="$PWD"; SHIFT_HOME="$HERE"; MACHINE=fixture; DISTRO=unused; WSL_HOME=/unused; KIT_UPDATE_DRIVER=1',
      'git() { :; }',
      'python() { if [ "$changed" != none ]; then printf changed > "$HERE/$changed"; fi; }',
      'cygpath() { printf "%s\\n" "$2"; }',
      'wsl() { :; }',
      'outbox() { echo stopped; }',
      'steward() { echo stopped; }',
      'swap_new() { :; }',
      'changed="$1"',
      'case update in',
      update,
      'esac',
    ].join('\n');
    const replay = path.join(home, 'replay.sh');
    fs.writeFileSync(replay, script);
    const result = spawnSync(bash, [replay, changed], { cwd: home, env, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const notice = result.stdout.trim().split('\n').pop();
    if (changed === 'none' || changed === 'other.txt') assert.doesNotMatch(result.stdout, /reconnect/);
    else {
      assert.match(notice, /reconnect the lighthouse MCP server with \/mcp, or restart the session/);
      assert.match(notice, /running session keeps the old tools/);
    }
  });
