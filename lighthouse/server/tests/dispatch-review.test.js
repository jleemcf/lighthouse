'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { dispatchFixture } = require('./dispatch-fixture');

test('settled sequential deliveries allow fresh work and a clean handoff seal', context => {
  const f = dispatchFixture(context);
  for (const text of ['First instruction', 'Second instruction']) {
    const ticket = f.issue(text);
    assert.equal(f.consume(ticket).dispatch, true);
    f.ctx.transact(
      () => {},
      () => {
        assert.equal(
          f.ctx.dispatchLedger.receipt(
            'tools',
            f.first,
            f.ctx.store.tickets[ticket.id],
            { delivered: true },
            crypto.randomUUID(),
          ).ok,
          true,
        );
      },
    );
  }
  f.prepare();
  f.save();
  assert.doesNotThrow(() => f.seal());
  assert.deepEqual(f.ctx.handoff.current('tools').heldTargets, []);
});

test('late positive settlement releases both transfer holds after all effects settle', context => {
  const f = dispatchFixture(context);
  const ticket = f.issue();
  f.consume(ticket);
  f.prepare();
  f.save();
  f.seal(true);
  f.accept();
  f.pickup();
  f.ctx.transact(
    () => {},
    () => {
      f.ctx.dispatchLedger.receipt(
        'tools',
        f.first,
        f.ctx.store.tickets[ticket.id],
        { delivered: true },
        crypto.randomUUID(),
      );
    },
  );
  assert.deepEqual(f.ctx.handoff.current('tools').heldTargets, []);
});

test('recorded legacy acknowledgement survives pruned tickets while unknown still holds', context => {
  const f = dispatchFixture(context);
  f.send('inventory', {
    journalId: f.journalId,
    complete: true,
    calls: [],
    relays: [{ id: 'relay-result-pruned-ticket', ticket: 'pruned-ticket', state: 'recorded' }],
  });
  assert.doesNotThrow(() => f.issue('New instruction'));
  f.send('inventory', {
    journalId: f.journalId,
    complete: true,
    calls: [],
    relays: [{ id: 'relay-result-unresolved-ticket', ticket: 'unresolved-ticket', state: 'unknown' }],
  });
  assert.throws(() => f.issue('Further instruction'), /possibly running/);
});

test('inventory receipts store a compact replay result instead of full call copies', context => {
  const f = dispatchFixture(context);
  const call = { id: crypto.randomUUID(), tool: 'board_post', args: { text: 'Queued' } };
  call.hash = require('../dispatch-ledger').callHash(call);
  const operationId = crypto.randomUUID();
  const input = { operationId, journalId: f.journalId, complete: true, calls: [call], relays: [] };
  assert.equal(f.send('inventory', input).calls.length, 1);
  const saved = f.ctx.dispatchLedger.record('tools');
  assert.equal(saved.operations[operationId].result.calls, undefined);
  f.send('review-call', { callId: call.id, hash: call.hash, disposition: 'superseded', reason: 'Stale' });
  assert.equal(f.send('inventory', input).calls[0].disposition, 'superseded');
});

test('activating ownership on another board never downgrades ledger schema protection', context => {
  const f = dispatchFixture(context);
  f.ctx.cfg.boards.other = { protocol: 'tools', access: { captain: 'owner', operator: 'operator' } };
  f.ctx.store.boards.other = { messages: [], shift: { state: 'off' } };
  const send = body => f.control(body, f.captain, 'other');
  const credential = crypto.randomBytes(32).toString('base64url');
  send({
    action: 'register',
    sessionId: 'session-other',
    installationId: 'install-other',
    credential,
    principal: 'operator',
    scope: 'operator',
  });
  const who = f.ctx.ownership.authenticate(credential);
  const nominationId = crypto.randomUUID();
  send({ action: 'nominate', sessionId: who.sessionId, expectedEpoch: 0, nominationId, expiresAt: Date.now() + 60000 });
  f.control({ action: 'acquire', expectedEpoch: 0, nominationId }, who, 'other');
  who.epoch = 1;
  const processId = crypto.randomUUID();
  f.control({ action: 'attach', processId, protocol: 'session-epochs-v1' }, who, 'other');
  send({ action: 'activate', confirmAllWriters: true, processIds: [processId] });
  assert.equal(f.ctx.store.schemaVersion, 4);
});
