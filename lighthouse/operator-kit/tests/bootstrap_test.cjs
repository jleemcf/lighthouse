'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { childRpc } = require('../../tests/child-rpc.cjs');
const { fixture, env } = require('../../verification/update/bootstrap-replay.cjs');

for (const fault of ['staging', 'before-install', 'install-partial', 'activation', 'copy']) {
  test('bootstrap interruption and recovery: ' + fault, t => {
    const setup = fixture();
    t.after(setup.cleanup);
    const original = fs.readFileSync(path.join(setup.home, 'lighthouse-mcp.cjs'));
    const result = setup.run(fault);
    assert.notEqual(result.status, 0, result.stdout + result.stderr);
    assert.doesNotMatch(result.stdout, /Update complete/);
    if (fault === 'staging') assert.match(result.stderr, /bootstrap snapshot staging failed/);
    if (['staging', 'before-install'].includes(fault)) {
      assert.deepEqual(fs.readFileSync(path.join(setup.home, 'lighthouse-mcp.cjs')), original);
      assert.equal(fs.existsSync(path.join(setup.home, 'KIT-MANIFEST.json')), false);
    } else assert.ok(fs.existsSync(path.join(setup.home, 'MCP-RECONNECT.json')));
    if (fault === 'activation') assert.match(result.stdout, /run: bash shift.sh update/);
    const recovered = setup.run();
    assert.equal(recovered.status, 0, recovered.stdout + recovered.stderr);
    assert.match(recovered.stdout, /Lighthouse tools changed: reconnect/);
  });
}

test('bootstrap refuses a kit older than the supported migration floor', t => {
  const setup = fixture('ceb65aa');
  t.after(setup.cleanup);
  const original = fs.readFileSync(path.join(setup.home, 'shift.sh'));
  const result = setup.run();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /bootstrap unsupported kit: requires b4942b9 or later/);
  assert.deepEqual(fs.readFileSync(path.join(setup.home, 'shift.sh')), original);
});

test('bootstrap names installer staging failures without exposing its diagnostics', t => {
  const setup = fixture();
  t.after(setup.cleanup);
  fs.writeFileSync(path.join(setup.source, 'scripts/needs-value.txt'), '__MISSING_VALUE__ synthetic-private-value');
  const result = setup.run();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /bootstrap updater staging failed; check required configuration/);
  assert.doesNotMatch(
    result.stderr + result.stdout,
    /__MISSING_VALUE__|missing values|synthetic-private-value|unsupported kit/,
  );
  assert.equal(fs.existsSync(path.join(setup.home, 'KIT-MANIFEST.json')), false);
});

function session(home) {
  const child = spawn(process.execPath, [path.join(home, 'lighthouse-mcp.cjs')], { env, stdio: 'pipe' });
  const rpc = childRpc(child);
  return {
    child,
    async request(method, params = {}) {
      return (await rpc(method, params)).result;
    },
  };
}

for (const changedFile of ['toolcalls-spec.json', 'shift-session.cjs', 'session-identity.cjs', 'dispatch-client.cjs']) {
  test('changed dependency requires reconnect: ' + changedFile, async t => {
    const setup = fixture();
    t.after(setup.cleanup);
    assert.equal(setup.run().status, 0);
    const old = session(setup.home);
    t.after(() => old.child.kill());
    const initialized = await old.request('initialize');
    const before = initialized.serverInfo.version;
    const helperPath = path.join(setup.source, 'scripts', changedFile);
    fs.appendFileSync(helperPath, '\n');
    assert.equal(setup.run().status, 0);
    assert.ok(fs.existsSync(path.join(setup.home, 'MCP-RECONNECT.json')));
    const oldStatus = await old.request('tools/call', { name: 'board_kit_status' });
    assert.match(oldStatus.content[0].text, /Reconnect required: yes/);
    assert.match(oldStatus.content[0].text, new RegExp('This MCP: ' + before.split('+')[1]));
    const fresh = session(setup.home);
    t.after(() => fresh.child.kill());
    const after = await fresh.request('initialize');
    assert.notEqual(after.serverInfo.version, before);
    const target = JSON.parse(fs.readFileSync(path.join(setup.home, 'KIT-MANIFEST.json'))).mcpVersion;
    assert.equal(after.serverInfo.version.split('+')[1], target);
    assert.ok(fs.existsSync(path.join(setup.home, 'MCP-RECONNECT.json')), 'old session still connected');
    const closed = new Promise(resolve => old.child.once('exit', resolve));
    old.child.stdin.end();
    await closed;
    const status = await fresh.request('tools/call', { name: 'board_kit_status' });
    assert.match(status.content[0].text, /Repository: /);
    assert.match(status.content[0].text, /Installed Windows: [a-f0-9]/);
    assert.match(status.content[0].text, /Installed WSL: /);
    assert.match(status.content[0].text, /Loaded MCP: [a-f0-9]{64}/);
    assert.match(status.content[0].text, new RegExp('Target MCP: ' + target));
    assert.match(status.content[0].text, /Reconnect required: no reported mismatch/);
    assert.equal(fs.existsSync(path.join(setup.home, 'MCP-RECONNECT.json')), false);
    fresh.child.stdin.end();
    await new Promise(resolve => fresh.child.once('exit', resolve));
  });
}
