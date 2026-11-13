'use strict';
require('../../tests/sandbox.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const lf = String.fromCharCode(10);
const source = fs
  .readFileSync(path.join(__dirname, '../scripts/shift.sh'), 'utf8')
  .split(String.fromCharCode(13))
  .join('');
const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash';

for (const action of ['start', 'stop']) {
  for (const refusal of [false, true]) {
    test('shift command records its own edge: ' + action + ', refused=' + refusal, context => {
      const home = fs.mkdtempSync(path.join(os.tmpdir(), 'shift-command-'));
      context.after(() => fs.rmSync(home, { recursive: true, force: true }));
      const begin = source.indexOf('  ' + action + ')');
      const end = source.indexOf(lf + (action === 'start' ? '  outbox)' : '  kill-watchers)'), begin);
      assert.ok(begin > 0 && end > begin);
      const script = [
        'HERE="$PWD"',
        'kill_watchers() { :; }; swap_new() { :; }; clock() { echo synthetic; }',
        'outbox_alive() { :; }; rules() { :; }',
        'outbox() { echo "$1" >> helpers; }; steward() { echo "$1" >> helpers; }',
        'node() { if [ "$2" = shift ]; then echo "$3" >> edges; return "$REFUSED"; fi; }',
        'case "$1" in',
        source.slice(begin, end),
        'esac',
      ].join(lf);
      const result = spawnSync(bash, ['-c', script, 'fixture', action], {
        cwd: home,
        env: { ...process.env, REFUSED: refusal ? '1' : '0' },
        encoding: 'utf8',
      });
      assert.equal(result.status, refusal ? 1 : 0, result.stderr);
      assert.equal(fs.readFileSync(path.join(home, 'edges'), 'utf8').trim(), action === 'start' ? 'start' : 'end');
      if (refusal && action === 'start') assert.equal(fs.existsSync(path.join(home, 'helpers')), false);
      else assert.equal(fs.readFileSync(path.join(home, 'helpers'), 'utf8').trim(), action + lf + action);
      if (action === 'stop') assert.ok(fs.existsSync(path.join(home, 'shift-stopped.txt')));
    });
  }
}
