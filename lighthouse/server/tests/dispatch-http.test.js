'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fixture = require('./ownership-http-fixture');
const { callHash } = require('../dispatch-ledger');

async function setup(context) {
  const f = await fixture(context, true, { dispatchLedgerEnabled: true, handoffEnabled: true });
  const endpoint = '/api/boards/beta/dispatch-ledger';
  const ledger = (action, body = {}, credential = f.first, epoch = 1) =>
    f.request('POST', endpoint, { operationId: crypto.randomUUID(), action, ...body }, credential, epoch);
  const journalId = crypto.randomUUID();
  assert.equal((await ledger('inventory', { journalId, complete: true, calls: [], relays: [] })).status, 200);
  assert.equal(
    (
      await f.control(
        {
          action: 'attach',
          processId: f.processId,
          protocol: 'session-epochs-v1',
          capabilities: ['dispatch-ledger-v1'],
          journalId,
        },
        f.first,
        1,
      )
    ).status,
    200,
  );
  assert.equal(
    (await ledger('activate', { confirmAllWriters: true, processIds: [f.processId] }, 'CAPTAIN')).status,
    409,
  );
  const call = (tool, args, extra = {}, credential = f.first, epoch = 1) =>
    f.request(
      'POST',
      '/api/boards/beta/calls',
      { calls: [{ id: crypto.randomUUID(), tool, args, ...extra }] },
      credential,
      epoch,
    );
  await call('board_status', {});
  const issue = async () => {
    const state = await f.request('GET', '/api/comments?board=beta', null, f.first, 1);
    const source = state.body.comments.find(item => item.id === 'message-test').sid;
    return call('board_relay', { source, to: 'firstmate', dispatchProtocol: 'dispatch-ledger-v1' });
  };
  return { ...f, endpoint, ledger, call, issue, journalId };
}

test('two homes racing consume produce one route grant; another id cannot bypass suppression', async context => {
  const f = await setup(context);
  const issued = await f.issue();
  assert.equal(issued.body.results[0].ok, true, issued.raw);
  const tk = issued.body.ticket;
  const body = { intentId: tk.intentId, attemptId: tk.attemptId, permissionId: tk.permissionId };
  const results = await Promise.all([f.ledger('consume', body), f.ledger('consume', body)]);
  assert.equal(results.filter(item => item.body.dispatch === true).length, 1);
  const repeat = await f.issue();
  assert.equal(repeat.body.results[0].ok, false);
  assert.match(repeat.body.results[0].reason, /possibly running/);
  assert.equal((await f.ledger('consume', body, f.second, 1)).status, 409);
  const view = await f.request('GET', f.endpoint, null, f.first, 1);
  assert.equal(view.body.attempts[0].state, 'consumed');
  assert.ok(!JSON.stringify(view.body).includes('evidenceCapability'));
});

test('ordinary HTTP calls keep body hashes, dispositions and permanent cross-session deduplication', async context => {
  const f = await setup(context);
  const id = crypto.randomUUID();
  const args = { card: 'beta-work', kind: 'status', text: 'Once only' };
  const first = await f.call('board_post', args, { id, originSessionId: 'session-first', originEpoch: 1 });
  assert.equal(first.body.results[0].ok, true, first.raw);
  const again = await f.call('board_post', args, {
    id,
    queued: true,
    originSessionId: 'session-first',
    originEpoch: 1,
  });
  assert.equal(again.body.results[0].duplicate, true);
  assert.equal((await f.call('board_post', { ...args, text: 'Changed' }, { id })).status, 409);
  const view = (await f.request('GET', f.endpoint, null, f.first, 1)).body;
  assert.equal(view.calls[0].disposition, 'acknowledged');
  assert.equal(view.calls[0].hash, callHash({ tool: 'board_post', args }));
});

test('inventoried commands require explicit review even if a caller removes the queued marker', async context => {
  const f = await setup(context);
  const call = {
    id: crypto.randomUUID(),
    tool: 'board_post',
    args: {
      card: 'beta-work',
      kind: 'status',
      text: 'Review before applying',
    },
    originSessionId: 'session-first',
    originEpoch: 1,
  };
  assert.equal(
    (
      await f.ledger('inventory', {
        journalId: f.journalId,
        complete: true,
        relays: [],
        calls: [{ ...call, hash: callHash(call) }],
      })
    ).status,
    200,
  );
  assert.equal((await f.call(call.tool, call.args, { id: call.id })).status, 409);
  const reviewed = await f.ledger('review-call', {
    callId: call.id,
    hash: callHash(call),
    disposition: 'adopted',
    reason: 'Checked against live records',
  });
  assert.equal(reviewed.status, 200, reviewed.raw);
  assert.equal((await f.call(call.tool, call.args, { ...call, queued: true })).body.results[0].ok, true);
  assert.equal((await f.call(call.tool, call.args, { ...call, queued: true })).body.results[0].duplicate, true);
});

test('relay adoption revalidates current source authority before replacing an unspent attempt', async context => {
  const f = await setup(context);
  const ticket = (await f.issue()).body.ticket;
  const adopted = await f.ledger('adopt-intent', {
    intentId: ticket.intentId,
    attemptId: ticket.attemptId,
    reason: 'Reviewed the current exact owner instruction',
  });
  assert.equal(adopted.status, 200, adopted.raw);
  assert.notEqual(adopted.body.ticket.permissionId, ticket.permissionId);
  assert.equal(
    (
      await f.ledger('consume', {
        intentId: ticket.intentId,
        attemptId: ticket.attemptId,
        permissionId: ticket.permissionId,
      })
    ).body.dispatch,
    false,
  );
  await f.request(
    'POST',
    '/api/comments',
    { board: 'beta', text: 'New direction; review this before proceeding' },
    'OWNER',
  );
  const refused = await f.ledger('adopt-intent', {
    intentId: ticket.intentId,
    attemptId: adopted.body.ticket.attemptId,
    reason: 'Do not ignore new direction',
  });
  assert.equal(refused.status, 409, refused.raw);
  assert.match(refused.body.error, /source authorization changed/);
});

test('imported scoped receipts settle without granting acting rights', async context => {
  const f = await setup(context);
  const tk = (await f.issue()).body.ticket;
  await f.ledger('consume', { intentId: tk.intentId, attemptId: tk.attemptId, permissionId: tk.permissionId });
  const args = {
    ticket: tk.id,
    delivered: true,
    evidenceCapability: tk.evidenceCapability,
    originSessionId: 'session-first',
    originEpoch: 1,
  };
  const before = (await f.request('GET', f.endpoint, null, f.first, 1)).body;
  await f.call('_relay_result', { ...args, dry_run: true }, { id: 'receipt-rehearsal' });
  assert.deepEqual((await f.request('GET', f.endpoint, null, f.first, 1)).body, before);
  const receipt = await f.call('_relay_result', args, { id: 'receipt-original' }, f.second, 1);
  assert.equal(receipt.body.results[0].ok, true, receipt.raw);
  const conflict = await f.call(
    '_relay_result',
    { ...args, delivered: false },
    { id: 'receipt-conflict' },
    f.second,
    1,
  );
  assert.equal(conflict.body.results[0].ok, false);
  assert.match(conflict.body.results[0].reason, /conflicting receipt/);
  assert.equal((await f.call('board_post', { text: 'stale' }, {}, f.second, 1)).status, 409);
  const forged = await f.call(
    '_relay_result',
    { ...args, evidenceCapability: 'unrelated-capability' },
    {},
    f.second,
    1,
  );
  assert.equal(forged.status, 403);
});
