'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { handoffFixture, input } = require('./handoff-fixture');

for (const action of ['prepare', 'checkpoint', 'seal', 'read', 'accept', 'pickup', 'cancel'])
  for (const stage of ['written', 'flushed', 'renamed', 'committed'])
    test('handoff crash/retry at ' + action + '/' + stage, context => {
      const f = handoffFixture(context);
      if (action !== 'prepare') f.prepare();
      if (!['prepare', 'checkpoint'].includes(action)) f.save();
      if (['read', 'accept', 'pickup'].includes(action)) f.seal();
      let who = f.first;
      let extra = {};
      if (action === 'prepare') extra = { expectedEpoch: 1, successorSessionId: f.second.sessionId };
      if (action === 'checkpoint') extra = { checkpoint: input() };
      if (action === 'read') who = f.second;
      if (action === 'accept') {
        who = f.second;
        extra = { expectedEpoch: 1, readId: f.read().readId };
      }
      if (action === 'pickup') {
        f.accept();
        who = f.second;
        const read = f.read();
        extra = { readId: read.readId, revision: read.revision };
      }
      if (action === 'cancel')
        extra = { expectedEpoch: 1, pendingDigest: f.ctx.handoff.status('tools').pending.digest };
      const body = f.body(action, extra);
      const before = structuredClone(f.ctx.store.boards.tools.shift);
      f.ctx.saveNow();
      const child = spawnSync(process.execPath, [path.join(__dirname, 'handoff-crash-worker.cjs')], {
        input: JSON.stringify({ home: f.home, cfg: f.ctx.cfg, who, body, stage }),
        encoding: 'utf8',
        env: { ...process.env, TYPESAFE_API_KEY: '' },
      });
      assert.notEqual(child.status, 0, child.stderr);
      const persisted = JSON.parse(fs.readFileSync(path.join(f.home, 'store.json'), 'utf8'));
      require('../durable-store').restore(f.ctx.store, persisted);
      const result = f.ctx.handoff.control('tools', who, body);
      assert.equal(!!result.duplicate, ['renamed', 'committed'].includes(stage));
      const again = f.ctx.handoff.control('tools', who, body);
      assert.equal(again.duplicate, true);
      assert.equal(f.ctx.ownership.record('tools').epoch, ['accept', 'pickup'].includes(action) ? 2 : 1);
      assert.deepEqual(f.ctx.store.boards.tools.shift, before);
      assert.equal(f.ctx.ownership.data().audit.filter(item => item.operationId === body.operationId).length, 1);
      assert.throws(() => f.ctx.handoff.control('tools', who, { ...body, extra: true }), /different input/);
    });
