'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { ownershipFixture } = require('./ownership-fixture');

for (const point of ['written', 'flushed', 'renamed', 'committed']) {
  test(
    'ownership persistence: crash at ' + point + ' recovers one whole epoch with its audit and operation',
    context => {
      const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ownership-crash-'));
      context.after(() => fs.rmSync(home, { recursive: true, force: true }));
      const file = path.join(home, 'store.json');
      const value = epoch => ({ epoch, audit: [epoch], operations: { acquired: epoch } });
      fs.writeFileSync(file, JSON.stringify(value(1)));
      const script =
        'const {durableStore}=require(process.argv[1]);' +
        'durableStore(process.argv[2],point=>{if(point===process.argv[3])process.exit(19)}).write(' +
        JSON.stringify(value(2)) +
        ')';
      const child = spawnSync(process.execPath, ['-e', script, require.resolve('../durable-store'), file, point], {
        encoding: 'utf8',
        env: { ...process.env, TYPESAFE_API_KEY: '' },
      });
      assert.equal(child.status, 19, child.stderr);
      const recovered = JSON.parse(fs.readFileSync(file));
      assert.deepEqual(recovered, value(['renamed', 'committed'].includes(point) ? 2 : 1));
      require('../durable-store').durableStore(file).write(value(3));
      assert.deepEqual(JSON.parse(fs.readFileSync(file)), value(3));
    },
  );
}

test('ownership persistence: failed disk write rolls back memory and fails closed until restart', context => {
  let fault = false;
  const { ctx, register, acquire, control, nominate } = ownershipFixture(context, point => {
    if (fault && point === 'flushed') throw new Error('injected write failure');
  });
  const first = register('session-first');
  acquire(first);
  const second = register('session-second');
  const nominationId = nominate(second.sessionId);
  fault = true;
  assert.throws(() => control({ action: 'acquire', nominationId, expectedEpoch: 1 }, second), /injected/);
  assert.equal(ctx.ownership.record('tools').epoch, 1);
  assert.equal(JSON.parse(fs.readFileSync(ctx.STORE)).sessionOwnership.boards.tools.epoch, 1);
  assert.throws(() => control({ action: 'acquire', nominationId, expectedEpoch: 1 }, second), /unavailable/);
  assert.throws(() => ctx.saveNow(), /restart/);
});

test('ownership persistence: lost acknowledgement is resolved by the saved operation after a cold reload', context => {
  const { ctx, register, acquire } = ownershipFixture(context);
  const first = register('session-first');
  const body = acquire(first);
  const next = { cfg: ctx.cfg, CONFIG_PATH: ctx.CONFIG_PATH };
  Object.assign(next, require('../store')(next));
  Object.assign(next, require('../web')(next));
  next.ownership = require('../ownership')(next);
  const retry = next.ownership.control('tools', first, body);
  assert.equal(retry.duplicate, true);
  assert.equal(retry.ownership.epoch, 1);
  assert.equal(next.ownership.record('tools').epoch, 1);
  next.saveNow();
});

test('ownership persistence: a rejected fenced write does not cancel an earlier legacy save', async context => {
  const { ctx } = ownershipFixture(context);
  ctx.store.boards.lines.pending = 'legacy work';
  ctx.save();
  let checks = 0;
  assert.throws(
    () =>
      ctx.transact(
        () => {
          if (++checks === 2) throw new Error('expired');
        },
        () => {
          ctx.store.boards.tools.name = 'not committed';
        },
      ),
    /expired/,
  );
  await new Promise(resolve => setTimeout(resolve, 220));
  assert.equal(JSON.parse(fs.readFileSync(ctx.STORE)).boards.lines.pending, 'legacy work');
});
