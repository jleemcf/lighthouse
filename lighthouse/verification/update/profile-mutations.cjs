'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { fixture } = require('./bootstrap-replay.cjs');

for (const broken of [false, true, false]) {
  const setup = fixture();
  try {
    const installed = JSON.parse(fs.readFileSync(path.join(setup.home, 'config.json'), 'utf8'));
    const machine = path.resolve(setup.source, '../../private/machines/fixture');
    fs.mkdirSync(machine, { recursive: true });
    fs.writeFileSync(
      path.join(machine, 'operator-config.json'),
      JSON.stringify({
        ...installed,
        __BOARD_SERVER__: 'http://127.0.0.1:19999',
        newProfileSetting: 'selected',
      }),
    );
    if (broken) {
      const file = path.join(setup.source, 'install.py');
      const source = fs.readFileSync(file, 'utf8');
      const anchor = 'if v != k: cfg[k] = v';
      assert.equal(source.split(anchor).length, 2, 'preservation mutation anchor');
      fs.writeFileSync(file, source.replace(anchor, 'if False: cfg[k] = v'));
    }
    const result = setup.run();
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const current = JSON.parse(fs.readFileSync(path.join(setup.home, 'config.json'), 'utf8'));
    assert.equal(current.newProfileSetting, 'selected');
    const retained = () =>
      assert.equal(
        current.__BOARD_SERVER__,
        installed.__BOARD_SERVER__,
        'FilledValuesSurviveUpdate: a machine default must not replace a filled installed address',
      );
    if (broken) assert.throws(retained, /FilledValuesSurviveUpdate/);
    else retained();
    console.log('FilledValuesSurviveUpdate: ' + (broken ? 'overwrite mutation caught' : 'retained values pass'));
  } finally {
    setup.cleanup();
  }
}
