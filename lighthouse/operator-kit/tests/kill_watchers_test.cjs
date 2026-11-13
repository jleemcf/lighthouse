'use strict';
require('../../tests/sandbox.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const cleanup = path.join(__dirname, '../scripts/Kill-Watchers.ps1');

for (const orphans of [false, true]) {
  test(
    'kill-watchers covers kit shells and PID owners without touching other homes or private helpers; orphans=' +
      orphans,
    { skip: process.platform !== 'win32' },
    context => {
      const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kill-watchers-'));
      context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
      const home = path.join(directory, 'operator home');
      const other = path.join(directory, 'other home');
      fs.mkdirSync(home);
      const commands = [
        'bash.exe "' + home + '/route.sh"',
        'bash.exe -c "cd ' + home.replace(/\\/g, '/') + ' && bash route.sh"',
        'bash.exe "' + home + '/watch.sh"',
        'bash.exe "' + home + '/lighthouse-sweep.sh"',
        'node.exe "' + home + '/fmwatch.cjs"',
        'node.exe "' + home + '/stwatch.cjs"',
        'node.exe "' + home + '/boardwatch.cjs"',
        'node.exe "' + home + '/conductwatch.cjs"',
        'node.exe "' + home + '/gate.cjs"',
        'node.exe fmwatch.cjs',
        'node.exe boardwatch.cjs',
        'node.exe gate.cjs',
        'node.exe gate.cjs',
        'node.exe unrelated.cjs',
        'bash.exe "' + other + '/route.sh"',
        'bash.exe "' + other + '/watch.sh"',
        'node.exe "' + other + '/gate.cjs"',
        'bash.exe "' + home + '/disk-watch.sh"',
        'bash.exe "' + home + '/fm-context-watch.sh"',
        'node.exe "' + home + '/fleet-batch.cjs"',
        'node.exe "' + home + '/stwake.cjs"',
        'python.exe "' + home + '/collector.py"',
        'bash.exe "' + home + '/not-route.sh"',
        'bash.exe "' + home + '/route.sh.backup"',
        'powershell.exe -File "' + cleanup + '" -OperatorHome "' + home + '"',
      ];
      commands.push(
        'node.exe monitor.cjs --source fixture -- bash route.sh',
        'node.exe "' + home + '/monitor.cjs" --source route -- bash route.sh',
      );
      const fixture = commands.map((CommandLine, index) => ({ ProcessId: 10000 + index, CommandLine }));
      fs.writeFileSync(path.join(directory, 'processes.json'), JSON.stringify(fixture));
      fs.writeFileSync(path.join(home, 'fmwatch.cjs.pid'), '10009');
      fs.writeFileSync(path.join(home, 'boardwatch.cjs.pid'), '10010');
      fs.writeFileSync(path.join(home, 'stwatch.cjs.pid'), '10013');
      fs.writeFileSync(path.join(home, 'gate-pids.json'), JSON.stringify({ 10011: { source: 'fixture' } }));
      fs.writeFileSync(path.join(home, 'gate-heartbeat.json'), JSON.stringify({ pid: 10012 }));
      fs.writeFileSync(path.join(home, 'monitor-fixture.json'), JSON.stringify({ pid: 10000 + commands.length - 2 }));
      const harness = path.join(directory, 'cleanup-test.ps1');
      fs.writeFileSync(
        harness,
        [
          'param($Script, $HomePath, $Orphans)',
          '$ErrorActionPreference = "Stop"',
          'function Get-CimInstance {',
          '  Get-Content (Join-Path $PSScriptRoot "processes.json") -Raw | ConvertFrom-Json',
          '}',
          'function Stop-Process {',
          '  param([int]$Id, [switch]$Force, [string]$ErrorAction)',
          '  Add-Content (Join-Path $PSScriptRoot "stopped.txt") $Id',
          '}',
          '& $Script -OperatorHome $HomePath -OrphansOnly:($Orphans -eq "true")',
        ].join('\n'),
      );
      const result = spawnSync(
        'powershell.exe',
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', harness, cleanup, home, String(orphans)],
        { encoding: 'utf8' },
      );
      assert.equal(result.status, 0, result.stdout + result.stderr);
      const stopped = fs.readFileSync(path.join(directory, 'stopped.txt'), 'utf8').trim().split(/\s+/).map(Number);
      assert.deepEqual(
        stopped.sort((left, right) => left - right),
        fixture
          .slice(0, 13)
          .concat(fixture.slice(-2))
          .map(item => item.ProcessId),
      );
      assert.equal(new Set(stopped).size, stopped.length, 'each process is stopped only once');
    },
  );
}
