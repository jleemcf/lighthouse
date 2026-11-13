'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { dispatchFixture } = require('./dispatch-fixture');
const { callHash } = require('../dispatch-ledger');

test('ordinary queue retains original identity, hash, origin and explicit dispositions', context => {
  const f = dispatchFixture(context);
  const call = {
    id: crypto.randomUUID(),
    tool: 'board_shift',
    args: { action: 'end' },
    originSessionId: f.first.sessionId,
    originEpoch: 1,
    client_at: '2026-01-01T00:00:00Z',
  };
  const publish = calls => f.send('inventory', { journalId: f.journalId, complete: true, calls, relays: [] });
  publish([{ ...call, hash: callHash(call) }]);
  let entry = f.ctx.dispatchLedger.record('tools').calls[call.id];
  assert.equal(entry.disposition, 'unacknowledged');
  f.prepare();
  f.save();
  f.seal(true);
  f.accept();
  f.pickup();
  assert.equal(f.ctx.dispatchLedger.canApply('tools', f.second, call), false);
  f.send(
    'review-call',
    { callId: call.id, hash: callHash(call), disposition: 'superseded', reason: 'Old shift end is no longer valid' },
    f.second,
  );
  entry = f.ctx.dispatchLedger.record('tools').calls[call.id];
  assert.equal(entry.disposition, 'superseded');
  assert.equal(entry.originSessionId, f.first.sessionId);
  assert.equal(entry.originEpoch, 1);
  assert.equal(entry.hash, callHash(call));
  assert.equal(f.ctx.dispatchLedger.canApply('tools', f.second, call), false);
  assert.throws(
    () =>
      f.send(
        'review-call',
        { callId: call.id, hash: 'changed', disposition: 'adopted', reason: 'wrong body' },
        f.second,
      ),
    /exact original/,
  );
});

test('successor adoption authorizes only the reviewed body and current epoch; committed calls deduplicate', context => {
  const f = dispatchFixture(context);
  const call = {
    id: crypto.randomUUID(),
    tool: 'board_post',
    args: { kind: 'status', text: 'Still current' },
    originSessionId: f.first.sessionId,
    originEpoch: 1,
  };
  f.send('inventory', {
    journalId: f.journalId,
    complete: true,
    calls: [{ ...call, hash: callHash(call) }],
    relays: [],
  });
  f.prepare();
  f.save();
  f.seal(true);
  f.accept();
  f.pickup();
  f.send(
    'review-call',
    { callId: call.id, hash: callHash(call), disposition: 'adopted', reason: 'Reviewed against live state' },
    f.second,
  );
  assert.equal(f.ctx.dispatchLedger.canApply('tools', f.second, call), true);
  assert.equal(f.ctx.dispatchLedger.canApply('tools', f.first, call), false);
  assert.equal(f.ctx.dispatchLedger.canApply('tools', f.second, { ...call, args: {} }), false);
  const result = { ok: true, summary: 'Applied once' };
  f.ctx.transact(
    () => f.ctx.ownership.acting(f.second, 'tools', 2),
    () => f.ctx.dispatchLedger.rememberCall('tools', f.second, call, result),
  );
  assert.deepEqual(f.ctx.dispatchLedger.previousCall('tools', call), result);
  assert.equal(f.ctx.dispatchLedger.record('tools').calls[call.id].disposition, 'acknowledged');
  assert.throws(() => f.ctx.dispatchLedger.previousCall('tools', { ...call, args: {} }), /different body/);
});

test('import gaps and unknown legacy journals remain visible; empty successor inventory cannot clear them', context => {
  const f = dispatchFixture(context);
  const id = crypto.randomUUID();
  f.send('inventory', {
    journalId: id,
    complete: false,
    gaps: ['old disk unavailable'],
    calls: [],
    relays: [{ id: 'relay-result-legacy', state: 'authorized', target: 'firstmate' }],
  });
  f.send('inventory', { journalId: f.journalId, complete: true, calls: [], relays: [] });
  f.send('inventory', { journalId: id, complete: true, calls: [], relays: [] });
  assert.throws(() => f.issue(), /import gap/);
  const view = f.ctx.dispatchLedger.status('tools');
  assert.equal(view.intents[0].state, 'unknown');
  assert.ok(view.inventories.some(item => item.id === id && !item.complete));
  assert.ok(f.ctx.handoff.status('tools').pending.effectBlockers.some(item => item.startsWith('import-gap:')));
  f.send('resolve-gap', { journalId: id, independent: true, evidence: 'owner checked inventory' }, f.captain);
  assert.throws(() => f.issue(), /possibly running/);
});

test('ledger and readiness off leave existing boards and their durable store unchanged', context => {
  const { handoffFixture } = require('./handoff-fixture');
  const f = handoffFixture(context);
  f.ctx.dispatchLedger = require('../dispatch-ledger')(f.ctx);
  f.ctx.cfg.boards.tools.dispatchLedgerEnabled = false;
  const before = structuredClone(f.ctx.store);
  assert.deepEqual(f.ctx.dispatchLedger.status('tools'), { enabled: false });
  assert.equal(f.ctx.dispatchLedger.previousCall('tools', { id: 'new-call' }), null);
  assert.equal(f.ctx.dispatchLedger.canApply('tools', f.first, { id: 'new-call' }), false);
  assert.deepEqual(f.ctx.dispatchLedger.issue('tools', f.first, {}, 'new-intent'), {});
  assert.throws(
    () =>
      f.ctx.dispatchLedger.control('tools', f.first, {
        action: 'inventory',
        operationId: crypto.randomUUID(),
        journalId: crypto.randomUUID(),
        complete: true,
        calls: [],
        relays: [],
      }),
    /disabled/,
  );
  assert.deepEqual(f.ctx.store, before);
});
