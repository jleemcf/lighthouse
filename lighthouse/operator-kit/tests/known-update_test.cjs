'use strict';
require('../../tests/sandbox.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { runUpdate } = require('../../verification/update/replay.cjs');
const { fixture, historical } = require('../../verification/update/bootstrap-replay.cjs');

test('update: ChangedToolsRequireReconnectNotice [scout flow: update]', async context => {
  for (const revision of historical ? ['b4942b9', '5cd7cf3', '30056e2', 'f0312bf'] : ['supported public fixture']) {
    await context.test('one-time migration from ' + revision, child => {
      const setup = fixture(revision);
      child.after(setup.cleanup);
      const old = fs.readFileSync(path.join(setup.home, 'shift.sh'), 'utf8');
      assert.doesNotMatch(old, /KIT_UPDATE_DRIVER/);
      const result = setup.run();
      assert.equal(result.status, 0, result.stdout + result.stderr);
      assert.match(result.stdout, /Updater bootstrap v1: running the fetched release/);
      assert.match(result.stdout, /Update complete/);
      assert.match(result.stdout, /Lighthouse tools changed: reconnect/);
      const target = JSON.parse(fs.readFileSync(path.join(setup.home, 'KIT-MANIFEST.json')));
      const twin = JSON.parse(fs.readFileSync(path.join(setup.twin, 'KIT-MANIFEST.json')));
      assert.equal(twin.release, target.release);
      assert.equal(target.bootstrap, 1);
      const repeat = setup.run();
      assert.equal(repeat.status, 0, repeat.stdout + repeat.stderr);
      assert.match(repeat.stdout, /Lighthouse tools changed: reconnect/);
      assert.ok(fs.existsSync(path.join(setup.home, 'MCP-RECONNECT.json')));
    });
  }
});

test('update: SuccessRequiresInstallation [scout flow: update]', context => {
  const result = runUpdate({ fault: 'installer' });
  context.after(result.cleanup);
  assert.ifError(result.error);
  assert.equal(result.signal, null);
  assert.match(result.stderr, /Update incomplete: installer/);
  assert.equal(fs.readFileSync(path.join(result.home, 'lighthouse-mcp.cjs'), 'utf8'), result.previous);
  assert.notEqual(result.status, 0, 'a failed installer must fail the update');
});

test('update: SuccessRequiresMatchingCopies [scout flow: update]', context => {
  const result = runUpdate({ fault: 'copy' });
  context.after(result.cleanup);
  assert.ifError(result.error);
  assert.equal(result.signal, null);
  assert.match(result.stderr, /Update incomplete: WSL copy or verification/);
  assert.notEqual(fs.readFileSync(path.join(result.home, 'lighthouse-mcp.cjs'), 'utf8'), result.previous);
  assert.equal(fs.readFileSync(path.join(result.home, 'twin/lh-probe.sh'), 'utf8'), result.previousTwin);
  assert.notEqual(result.status, 0, 'a failed twin copy must fail the update');
});
