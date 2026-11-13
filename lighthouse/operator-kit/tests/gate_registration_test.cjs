'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../scripts/gate.cjs'), 'utf8').replace(/\r/g, '');
const registration = source.slice(
  source.indexOf('async function registerGate() {'),
  source.indexOf('const STARTED_AT'),
);

function fixture(code, persistent = false, revoke = false) {
  let registry = { 11: { source: 'mixed' }, 12: { source: 'fmwatch' } };
  let previousAlive = true;
  let temporary;
  let attempts = 0;
  let clock = 0;
  const announcements = [];
  const removed = [];
  const lease = {
    check(fresh) {
      assert.equal(fresh, true);
      if (revoke && attempts) throw new Error('lease revoked');
    },
  };
  const disk = {
    writeFileSync(file, text) {
      temporary = JSON.parse(text);
    },
    renameSync() {
      if (temporary[20]) {
        attempts++;
        if (persistent || attempts === 1) {
          registry[13] = { source: 'route' };
          throw Object.assign(new Error('fixture publication failure'), { code });
        }
        assert.ok(temporary[13], 'retry must re-read another source registered during contention');
      }
      registry = temporary;
      temporary = undefined;
    },
    rmSync(file) {
      removed.push(file);
      temporary = undefined;
    },
  };
  const writeJson = (file, value) => {
    lease.check(true);
    try {
      disk.writeFileSync(file + '.tmp', JSON.stringify(value));
      disk.renameSync();
      if (value[11]?.stopRequestedBy === 20) {
        previousAlive = false;
        delete registry[11];
      }
      return true;
    } catch {
      return false;
    }
  };
  const run = new Function(
    'readJson',
    'REGF',
    'HOME',
    'alive',
    'process',
    'SOURCE_KEY',
    'writeJson',
    'log',
    'lease',
    'fs',
    'Date',
    'setTimeout',
    registration + '\nreturn registerGate();',
  );
  return {
    run: () =>
      run(
        () => structuredClone(registry),
        'gate-pids.json',
        'fixture',
        identity => identity !== 11 || previousAlive,
        { pid: 20, ppid: 10 },
        'mixed',
        writeJson,
        event => {
          assert.ok(registry[20], 'takeover cannot be announced before its registration is published');
          announcements.push(event);
        },
        lease,
        disk,
        class extends Date {
          static now() {
            return clock;
          }
        },
        (resolve, milliseconds) => {
          clock += milliseconds;
          resolve();
        },
      ),
    registry: () => registry,
    attempts: () => attempts,
    clock: () => clock,
    announcements,
    removed,
  };
}

test('replacement publishes before announcing and re-reads after transient sharing failures', async () => {
  for (const code of ['EPERM', 'EACCES', 'EBUSY']) {
    const state = fixture(code);
    await state.run();
    assert.equal(state.attempts(), 2);
    assert.deepEqual(Object.keys(state.registry()), ['12', '13', '20']);
    assert.equal(state.announcements.length, 1);
  }
});

test('replacement fails closed on permanent publication failures', async () => {
  for (const code of ['EPERM', 'EACCES', 'EBUSY', 'EIO']) {
    const state = fixture(code, true);
    await assert.rejects(state.run(), /fixture publication failure/);
    assert.ok(!state.registry()[20]);
    assert.equal(state.announcements.length, 0);
    assert.equal(state.clock(), code === 'EIO' ? 0 : 500);
    assert.deepEqual(state.removed, ['gate-pids.json.20.tmp']);
    if (code === 'EIO') assert.equal(state.attempts(), 1);
  }
});

test('replacement checks its lease again before retrying publication', async () => {
  const state = fixture('EPERM', false, true);
  await assert.rejects(state.run(), /lease revoked/);
  assert.equal(state.attempts(), 1);
  assert.ok(!state.registry()[20]);
  assert.equal(state.announcements.length, 0);
});
