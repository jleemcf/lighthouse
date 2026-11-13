'use strict';
require('../../tests/sandbox.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { acquire } = require('../registry-lease');
const { openFiles, processOwner, writePrivate } = require('../registry-files');

function fixture(context) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-registry-lease-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test('runtime lease refuses an active owner and names safe manual recovery', context => {
  const file = path.join(fixture(context), 'runtime.lock');
  const release = acquire(file);
  assert.throws(
    () => acquire(file),
    error => {
      assert.ok(error.message.includes(file));
      assert.match(error.message, /stop all board writers, verify their exit/);
      return true;
    },
  );
  release();
  release();
  const again = acquire(file);
  again();
  fs.writeFileSync(file + '.recovery', '');
  assert.throws(() => acquire(file), /recovery requires local repair/);
});

test(
  'Linux runtime and writer leases reclaim reused live PIDs by boot and start identity',
  { skip: process.platform !== 'linux' },
  context => {
    const root = fixture(context);
    const owner = processOwner();
    assert.ok(owner.stamp);
    const file = path.join(root, 'runtime.lock');
    fs.writeFileSync(file, JSON.stringify({ ...owner, stamp: owner.stamp + '-previous-process' }));
    const release = acquire(file);
    assert.deepEqual(JSON.parse(fs.readFileSync(file)), owner);
    release();
    const files = openFiles(path.join(root, 'registry'));
    const lock = path.join(files.directory, 'writer.lock');
    writePrivate(lock, owner, true);
    assert.throws(() => files.transact(() => {}), /registry is busy/);
    fs.unlinkSync(lock);
    writePrivate(lock, { ...owner, stamp: owner.stamp + '-previous-boot' }, true);
    files.transact(state => Object.assign(state, { metadata: { format: 1 }, credentials: { format: 1 } }));
    assert.equal(files.current().metadata.format, 1);
    assert.ok(!fs.existsSync(lock));
  },
);
