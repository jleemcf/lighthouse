'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { adapter, fixture, ticket, journal } = require('../../verification/relay/adapter.cjs');
const storage = require('../scripts/dispatch-storage.cjs');
const { client } = require('../scripts/dispatch-client.cjs');
const session = { sessionId: 'session-first', epoch: 1 };

test('fresh optional journals and a transient lock are not missing evidence', context => {
  const home = fixture(context);
  assert.equal(storage.inventory(home, 'tools').complete, true);
  fs.writeFileSync(path.join(home, 'relay-results.jsonl'), JSON.stringify({ id: 'old', state: 'recorded' }) + '\n');
  fs.writeFileSync(path.join(home, 'calls-outbox.jsonl.lock'), 'synthetic');
  assert.equal(storage.inventory(home, 'tools').complete, true);
  fs.unlinkSync(path.join(home, 'relay-results.jsonl'));
  assert.equal(storage.inventory(home, 'tools').complete, false);
});

test('inventory runs under the journal lock and unchanged drains do not post again', async context => {
  const home = fixture(context);
  const call = { id: crypto.randomUUID(), tool: 'board_post', args: { text: 'Queued' } };
  fs.writeFileSync(path.join(home, 'calls-outbox.jsonl'), JSON.stringify(call) + '\n');
  let posts = 0;
  let locks = 0;
  let terminal = false;
  const make = () =>
    client({
      home,
      board: 'tools',
      session: { ...session },
      locked: async fn => {
        locks++;
        return fn();
      },
      request: async (method, route, body) => {
        if (route.endsWith('/ownership')) return { status: 200, body: { ok: true } };
        if (method === 'GET')
          return {
            status: 200,
            body: {
              enabled: true,
              calls: terminal ? [{ ...call, hash: storage.callHash(call), disposition: 'acknowledged' }] : [],
            },
          };
        assert.equal(body.action, 'inventory');
        posts++;
        return { status: 200, body: { ok: true, calls: [] } };
      },
    });
  const dispatch = make();
  for (let i = 0; i < 5; i++) await dispatch.drain([call]);
  assert.equal(posts, 1);
  await make().drain([call]);
  assert.equal(posts, 1);
  assert.ok(locks >= 6);
  terminal = true;
  await dispatch.drain([call]);
  assert.deepEqual(storage.lines(home, 'calls-outbox.jsonl'), []);
});

test('configured but inactive ledger preserves the legacy ordinary queue drain', async context => {
  const home = fixture(context);
  fs.writeFileSync(
    path.join(home, 'calls-outbox.jsonl'),
    JSON.stringify({
      id: 'queued-before-activation',
      tool: 'board_status',
      args: {},
    }) + '\n',
  );
  const mcp = adapter(home, {
    session,
    ledger: async () => ({ status: 200, body: { enabled: false, available: true } }),
  });
  await mcp.drain();
  assert.equal(mcp.requests.filter(call => call.id === 'queued-before-activation').length, 1);
});

test('activation during legacy drain keeps review-required calls out of the dead letter queue', async context => {
  const home = fixture(context);
  let statusReads = 0;
  const call = { id: 'activation-race', tool: 'board_status', args: {} };
  fs.writeFileSync(path.join(home, 'calls-outbox.jsonl'), JSON.stringify(call) + '\n');
  const mcp = adapter(home, {
    session,
    ledger: async () => ({ status: 200, body: { enabled: statusReads > 0, available: true } }),
    call: async () => {
      statusReads++;
      return {
        status: 409,
        body: {
          error: 'queued intent requires explicit current-authority review and adoption',
        },
      };
    },
  });
  await mcp.drain();
  assert.equal(storage.lines(home, 'calls-outbox.jsonl').length, 1);
  assert.equal(storage.lines(home, 'calls-dead.jsonl').length, 0);
});

test('activation race with a lost status answer retains the original queued call', async context => {
  const home = fixture(context);
  let failed = false;
  fs.writeFileSync(
    path.join(home, 'calls-outbox.jsonl'),
    JSON.stringify({ id: 'lost-activation-status', tool: 'board_status', args: {} }) + '\n',
  );
  const mcp = adapter(home, {
    session,
    ledger: async () => (failed ? { status: 0 } : { status: 200, body: { enabled: false, available: true } }),
    call: async () => {
      failed = true;
      return { status: 409, body: { error: 'queued intent requires review and adoption' } };
    },
  });
  await mcp.drain();
  assert.equal(storage.lines(home, 'calls-outbox.jsonl').length, 1);
  assert.equal(storage.lines(home, 'calls-dead.jsonl').length, 0);
});

test('new board authorization releases obsolete local unknown suppression only for a new intent', async context => {
  const home = fixture(context);
  const old = { ...ticket, ledgerVersion: 1, intentId: 'intent-old', attemptId: 'attempt-old' };
  fs.writeFileSync(
    path.join(home, 'relay-results.jsonl'),
    JSON.stringify({
      id: 'relay-result-old-ticket',
      state: 'outcome-unknown',
      intent: { id: old.intentId, attemptId: old.attemptId, ledgerVersion: 1, to: old.to, hash: old.hash },
    }) + '\n',
  );
  const next = {
    ...old,
    id: 'new-ticket',
    intentId: 'intent-new',
    attemptId: 'attempt-new',
    permissionId: 'permission-new',
  };
  const mcp = adapter(home, {
    session,
    ticket: next,
    ledger: async method =>
      method === 'GET'
        ? { status: 200, body: { enabled: true } }
        : {
            status: 200,
            body: { ok: true, dispatch: true, attemptId: next.attemptId, permissionId: next.permissionId },
          },
  });
  assert.equal((await mcp.relay({ source: 'm1' })).isError, false);
  assert.equal(mcp.sends.length, 1);
  assert.equal(journal(home)[0].state, 'reconciled');
});

test('imported pre-ledger receipts retain original session evidence after activation', async context => {
  const home = fixture(context);
  const item = {
    id: 'relay-result-pre-ledger',
    state: 'delivered-awaiting-record',
    intent: { ticket: 'ticket-pre-ledger', to: 'firstmate' },
    originSessionId: 'session-original',
    originEpoch: 1,
    args: { ticket: 'ticket-pre-ledger', delivered: true, evidenceCapability: 'synthetic-scoped-evidence' },
  };
  fs.writeFileSync(path.join(home, 'relay-results.jsonl'), JSON.stringify(item) + '\n');
  const mcp = adapter(home, {
    session: { sessionId: 'session-successor', epoch: 2 },
    ledger: async () => ({ status: 200, body: { enabled: true } }),
    receipt: async call => {
      if (call.args.originSessionId !== item.originSessionId || call.args.originEpoch !== item.originEpoch)
        return { status: 403, body: { error: 'ticket-bound evidence capability required' } };
      return {
        status: 200,
        body: {
          results: [{ ok: true, relay_receipt: { id: call.id, ticket: item.args.ticket, delivered: true } }],
        },
      };
    },
  });
  await mcp.drain();
  assert.equal(journal(home)[0].state, 'recorded');
  assert.equal(mcp.sends.length, 0);
  assert.equal(mcp.requests.length, 1);
});

test('acknowledged relay history leaves inventory capacity for unresolved evidence', async context => {
  const home = fixture(context);
  const recorded = Array.from({ length: 1001 }, (_, i) => ({ id: 'recorded-' + i, state: 'recorded' }));
  const unresolved = ['outcome-unknown', 'blocked', 'reconciled'].map(state => ({ id: state, state }));
  const relays = [...recorded, ...unresolved];
  fs.writeFileSync(path.join(home, 'relay-results.jsonl'), relays.map(item => JSON.stringify(item)).join('\n') + '\n');
  const call = { id: crypto.randomUUID(), tool: 'board_post', args: { text: 'New queued intent' } };
  fs.writeFileSync(path.join(home, 'calls-outbox.jsonl'), JSON.stringify(call) + '\n');
  const dispatch = client({
    home,
    board: 'tools',
    session: { ...session },
    request: async (method, route, body) => {
      if (route.endsWith('/ownership')) return { status: 200, body: { ok: true } };
      if (body.calls.length + body.relays.length > 1000)
        return { status: 400, body: { error: 'versioned complete inventory required' } };
      assert.equal(body.complete, true);
      assert.equal(body.calls[0].id, call.id);
      assert.deepEqual(
        body.relays.map(item => item.id),
        unresolved.map(item => item.id),
      );
      return { status: 200, body: { ok: true, calls: [] } };
    },
  });
  await dispatch.inventory();
  assert.deepEqual(storage.lines(home, 'relay-results.jsonl'), relays);
});
