'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');
const { childRpc } = require('./child-rpc.cjs');

function fixture(context, mode) {
  const child = spawn(process.execPath, [path.join(__dirname, 'fixtures', 'child-rpc.cjs'), mode], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  context.after(() => child.kill());
  if (mode === 'signal') child.stderr.once('data', () => child.kill('SIGTERM'));
  return { child, rpc: childRpc(child) };
}

async function bounded(promise) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((resolve, reject) => {
        timer = setTimeout(() => reject(new Error('RPC did not settle within 2 seconds')), 2000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

test('child RPC still resolves fragmented replies and concurrent calls', { timeout: 5000 }, async context => {
  const { child, rpc } = fixture(context, 'reply');
  const results = await bounded(Promise.all([rpc('first', { value: 1 }), rpc('second', { value: 2 })]));
  assert.deepEqual(
    results.map(message => message.result),
    [{ value: 1 }, { value: 2 }],
  );
  child.stdin.end();
});

for (const [mode, code, signal] of [
  ['exit', 23, null],
  ['clean-exit', 0, null],
  ['signal', null, 'SIGTERM'],
]) {
  test('child RPC rejects every pending call on ' + mode, { timeout: 5000 }, async context => {
    const { child, rpc } = fixture(context, mode);
    const calls = [rpc('first'), rpc('second')];
    const results = await bounded(Promise.allSettled(calls));
    for (const result of results) {
      assert.equal(result.status, 'rejected');
      assert.equal(result.reason.exitCode, code);
      assert.equal(result.reason.signalCode, signal);
      assert.match(result.reason.message, new RegExp('exit code: ' + code + ', signal: ' + signal));
    }
    await assert.rejects(bounded(rpc('after shutdown')), error => error === results[0].reason);
  });
}

for (const pipe of ['stdin', 'stdout']) {
  test('child RPC rejects pending calls when ' + pipe + ' closes', { timeout: 5000 }, async context => {
    const { child, rpc } = fixture(context, 'wait');
    const calls = [rpc('first'), rpc('second')];
    if (pipe === 'stdin') child.stdin.end();
    else child.stdout.destroy();
    const results = await bounded(Promise.allSettled(calls));
    for (const result of results) {
      assert.equal(result.status, 'rejected');
      assert.equal(result.reason.exitCode, null);
      assert.equal(result.reason.signalCode, null);
      assert.match(result.reason.message, new RegExp(pipe + '.*exit code: null, signal: null.*exit not observed'));
    }
    assert.equal(child.exitCode, null, 'pipe closure rejects while child stays alive');
    await assert.rejects(bounded(rpc('after pipe closure')), error => error === results[0].reason);
  });
}
