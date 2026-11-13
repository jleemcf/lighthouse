'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { dispatchFixture } = require('./dispatch-fixture');
const { input } = require('./handoff-fixture');
const { callHash } = require('../dispatch-ledger');

for (const variant of ['call', 'gap', 'relay', 'prior']) {
  test('inventory retains transfer holds while importing a later ' + variant + ' blocker', context => {
    const f = dispatchFixture(context);
    const call = { id: crypto.randomUUID(), tool: 'board_post', args: { text: 'Original write' } };
    call.hash = callHash(call);
    if (variant === 'prior') f.send('inventory', { journalId: f.journalId, complete: true, calls: [call], relays: [] });
    f.prepare();
    const checkpoint = input();
    checkpoint.queue.value = [{ id: call.id, state: 'queued' }];
    f.save(checkpoint);
    f.seal(true);
    f.accept();
    f.pickup();
    f.ctx.store.calls ||= {};
    f.ctx.store.calls['tools|beta|' + call.id] = { ok: true, summary: 'Original committed write' };
    const later = { id: crypto.randomUUID(), tool: 'board_post', args: { text: 'Still pending' } };
    later.hash = callHash(later);
    const result = f.send(
      'inventory',
      {
        journalId: crypto.randomUUID(),
        complete: variant !== 'gap',
        gaps: variant === 'gap' ? ['Imported journal evidence unavailable'] : [],
        calls: variant === 'call' || variant === 'prior' ? [call, later] : [call],
        relays: variant === 'relay' ? [{ id: crypto.randomUUID(), state: 'outcome-unknown' }] : [],
      },
      f.second,
    );
    assert.equal(result.calls[0].disposition, 'acknowledged');
    const pending = f.ctx.handoff.status('tools', f.second).pending;
    assert.ok(pending.effectBlockers.length > 0);
    assert.deepEqual(f.ctx.handoff.current('tools').heldTargets, ['firstmate', 'steward']);
    assert.equal(f.ctx.handoff.paused('tools', 'steward'), true);
  });
}
