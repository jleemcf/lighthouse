'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { runUpdate } = require('../../verification/update/replay.cjs');

for (const layout of ['old', 'current']) {
  for (const fault of [
    'updater-temp',
    'updater-copy',
    'pull',
    'installer',
    'installer-partial',
    'paths',
    'activation',
    'windows-verify',
    'wsl-launch',
    'mkdir',
    'copy',
    'chmod',
    'twin-verify',
    'outbox-status',
    'outbox-stop',
    'outbox-start',
    'outbox-alive',
    'steward-status',
    'steward-stop',
    'steward-start',
  ]) {
    test(`fail-closed ${layout} layout: ${fault}`, t => {
      const result = runUpdate({ fault, layout });
      t.after(result.cleanup);
      assert.notEqual(result.status, 0, result.stdout + result.stderr);
      assert.match(result.stderr, /Update incomplete/);
      assert.doesNotMatch(result.stdout, /Update complete|WSL half refreshed/);
      assert.doesNotMatch(result.stdout + result.stderr, /synthetic-private-value/);
      if (['updater-temp', 'updater-copy', 'pull', 'paths', 'installer'].includes(fault)) {
        assert.equal(fs.readFileSync(path.join(result.home, 'lighthouse-mcp.cjs'), 'utf8'), result.previous);
        assert.equal(fs.readFileSync(path.join(result.home, 'twin/lh-probe.sh'), 'utf8'), result.previousTwin);
      }
      if (fault === 'installer-partial') assert.match(result.stderr, /may be partial; WSL unchanged/);
      if (fault === 'activation') assert.match(result.stdout, /still pending: lighthouse-mcp.cjs is open/);
      if (['copy', 'chmod', 'outbox-alive', 'steward-start'].includes(fault)) {
        assert.match(result.stdout, /Lighthouse tools changed: reconnect/);
      }
    });
  }
  test(`SuccessRequiresInstallation and SuccessRequiresMatchingCopies: ${layout}`, t => {
    const result = runUpdate({ layout });
    t.after(result.cleanup);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /Update complete/);
  });
}
