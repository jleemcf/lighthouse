'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { handoffFixture, input } = require('./handoff-fixture');
const { fromHome } = require('../../operator-kit/scripts/handoff.cjs');

test('checkpoint retry reuses its inventoried payload after a lost answer and reconnect', async context => {
  const f = handoffFixture(context);
  f.prepare();
  let now = Date.now();
  context.mock.method(Date, 'now', () => now);
  const sent = [];
  let loseAnswer = true;
  const request = async (method, route, body) => {
    sent.push(structuredClone(body));
    try {
      const result = f.ctx.handoff.control('tools', f.first, body);
      if (loseAnswer) {
        loseAnswer = false;
        return { status: 503, body: { error: 'fixture lost committed answer' } };
      }
      return { status: 200, body: result };
    } catch (error) {
      return { status: error.status || 409, body: { error: error.message } };
    }
  };
  const connect = () => fromHome({ session: f.first, board: 'tools', home: f.home, request });
  const args = f.body('checkpoint', { checkpoint: input() });
  assert.equal((await connect().call('board_checkpoint', args)).isError, true);
  const checkpointId = f.ctx.handoff.checkpoint('tools').id;
  now += 1000;
  const retried = await connect().call('board_checkpoint', args);
  assert.equal(retried.isError, undefined, retried.text);
  assert.equal(JSON.parse(retried.text).duplicate, true);
  assert.deepEqual(sent[0], sent[1]);
  assert.equal(f.ctx.handoff.checkpoint('tools').id, checkpointId);
  assert.equal(f.ctx.handoff.checkpoint('tools').queue.value.length, 0);
  fs.writeFileSync(path.join(f.home, 'calls-outbox.jsonl'), JSON.stringify({ id: 'arrived-after-save' }) + '\n');
  const changed = await connect().call('board_checkpoint', { ...args, reason: 'compaction' });
  assert.equal(changed.isError, true);
  assert.equal(sent.length, 2);
  const fresh = await connect().call('board_checkpoint', { ...args, operationId: 'new-checkpoint-operation' });
  assert.equal(fresh.isError, undefined, fresh.text);
  assert.equal(f.ctx.handoff.checkpoint('tools').queue.value[0].id, 'arrived-after-save');
});

test('handoff retry refuses changed journals before sending a stale inventory', async context => {
  const f = handoffFixture(context);
  f.prepare();
  let sends = 0;
  const request = async (method, route, body) => {
    sends += 1;
    if (sends === 1) return { status: 0, body: {} };
    return { status: 200, body: f.ctx.handoff.control('tools', f.first, body) };
  };
  const connect = () => fromHome({ session: f.first, board: 'tools', home: f.home, request });
  const args = f.body('checkpoint', { checkpoint: input() });
  assert.equal((await connect().call('board_checkpoint', args)).isError, true);
  fs.writeFileSync(path.join(f.home, 'calls-outbox.jsonl'), JSON.stringify({ id: 'queued-in-outage' }) + '\n');
  const retried = await connect().call('board_checkpoint', args);
  assert.equal(retried.isError, true, retried.text);
  assert.match(retried.text, /journals changed.*new operationId/);
  assert.equal(sends, 1);
  const fresh = await connect().call('board_checkpoint', { ...args, operationId: 'fresh-outage-checkpoint' });
  assert.equal(fresh.isError, undefined, fresh.text);
  assert.equal(f.ctx.handoff.checkpoint('tools').queue.value[0].id, 'queued-in-outage');
  assert.throws(() => f.seal(false), /clean seal blocked: queue:queued-in-outage/);
});
