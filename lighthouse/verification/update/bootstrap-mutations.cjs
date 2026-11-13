'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { fixture } = require('./bootstrap-replay.cjs');

function mutate(file, oldText, replacement) {
  const source = fs.readFileSync(file, 'utf8');
  assert.ok(source.includes(oldText), 'mutation must still map to the real implementation');
  fs.writeFileSync(file, source.replace(oldText, replacement));
}

for (const broken of [false, true]) {
  const setup = fixture('b4942b9');
  try {
    if (broken)
      mutate(
        path.join(setup.source, 'bootstrap.py'),
        '(stage / "shift.sh").as_posix(), "update"',
        '(home / "shift.sh").as_posix(), "update"',
      );
    const result = setup.run();
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(fs.existsSync(path.join(setup.home, 'KIT-MANIFEST.json')), !broken);
    console.log('FetchedUpdaterDrivesUpdate: ' + (broken ? 'old-body mutation rejected' : 'new body passes'));
  } finally {
    setup.cleanup();
  }
}

for (const broken of [false, true]) {
  const setup = fixture('b4942b9');
  try {
    if (broken) mutate(path.join(setup.source, 'install.py'), 'if changed:', 'if False:');
    const result = setup.run();
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(/Lighthouse tools changed: reconnect/.test(result.stdout), !broken);
    console.log(
      'ChangedToolsRequireReconnectNotice: ' + (broken ? 'missing-intent mutation rejected' : 'intent passes'),
    );
  } finally {
    setup.cleanup();
  }
}

for (const broken of [false, true]) {
  const setup = fixture();
  try {
    if (broken)
      mutate(
        path.join(setup.source, 'install.py'),
        'write_json(os.path.join(a.out, "MCP-RECONNECT.json"), {"target": mcp_version})',
        'write_json(os.path.join(a.out, "MCP-RECONNECT.json"), {"target": mcp_version})\n' +
          '        else:\n            os.remove(os.path.join(a.out, "MCP-RECONNECT.json"))',
      );
    const first = setup.run();
    assert.equal(first.status, 0, first.stdout + first.stderr);
    const rerun = setup.run();
    assert.equal(rerun.status, 0, rerun.stdout + rerun.stderr);
    assert.equal(fs.existsSync(path.join(setup.home, 'MCP-RECONNECT.json')), !broken);
    console.log('Persistent reconnect: ' + (broken ? 'unchanged-rerun mutation rejected' : 'rerun preserves intent'));
  } finally {
    setup.cleanup();
  }
}
