'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { dispatchFixture } = require('./dispatch-fixture');
const makeRequests = require('../toolcalls-request');

test('cache pruning retains ledger tickets, evidence capabilities and call deduplication', context => {
  const f = dispatchFixture(context);
  const ticket = f.issue();
  f.consume(ticket);
  const call = {
    id: crypto.randomUUID(),
    tool: 'board_post',
    args: { text: 'Already committed' },
    originSessionId: f.first.sessionId,
    originEpoch: 1,
  };
  f.ctx.transact(
    () => {},
    () => f.ctx.dispatchLedger.rememberCall('tools', f.first, call, { ok: true, summary: 'Committed once' }),
  );
  f.ctx.store.calls ||= {};
  f.ctx.store.calls['tools|operator|' + call.id] = { t: '2000-01-01T00:00:00Z', ok: true };
  const savedTicket = f.ctx.store.tickets[ticket.id];
  savedTicket.t = '2000-01-01T00:00:00Z';
  savedTicket.used = true;
  const requests = makeRequests({
    ctx: { cfg: f.ctx.cfg, store: () => f.ctx.store, roleOn: f.ctx.roleOn, saveNow: f.ctx.saveNow },
    cfg: f.ctx.cfg,
    now: f.ctx.now,
    tms: value => Date.parse(value) || 0,
    T: { board_status: () => ({ ok: true, summary: 'Read' }) },
    receipt: () => '',
    q: String,
  });
  assert.equal(
    requests.handleCalls('tools', f.first, { calls: [{ id: crypto.randomUUID(), tool: 'board_status', args: {} }] })
      .status,
    200,
  );
  assert.equal(f.ctx.store.calls['tools|operator|' + call.id], undefined);
  assert.ok(f.ctx.store.tickets[ticket.id]);
  assert.doesNotThrow(() => f.ctx.ownership.evidence(f.first, 'tools', 1, ticket.id, ticket.evidenceCapability));
  assert.equal(f.ctx.dispatchLedger.previousCall('tools', call).summary, 'Committed once');
});
