'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { adapter, fixture, ticket, journal } = require('../../verification/relay/adapter.cjs');
const storage = require('../scripts/dispatch-storage.cjs');
const transfer = require('../scripts/dispatch-transfer.cjs');

const session = { sessionId: 'session-first', epoch: 1 };
const permission = {
  ...ticket,
  intentId: 'intent-synthetic',
  attemptId: 'attempt-synthetic',
  permissionId: 'permission-synthetic',
  ledgerVersion: 1,
  evidenceCapability: 'synthetic-private-evidence',
};
function board(home, lose = false) {
  let consumed = false;
  return async (method, body) => {
    if (method === 'GET') return { status: 200, body: { enabled: true, available: true } };
    assert.equal(body.action, 'consume');
    assert.equal(journal(home)[0].state, 'permission-requested');
    if (consumed) return { status: 200, body: { ok: true, dispatch: false, possiblySent: true } };
    consumed = true;
    return lose
      ? { status: 0, error: 'lost consume answer' }
      : {
          status: 200,
          body: {
            ok: true,
            dispatch: true,
            attemptId: permission.attemptId,
            permissionId: permission.permissionId,
          },
        };
  };
}
test('external route observes durable local consume and only a first positive board grant', async context => {
  const home = fixture(context);
  const client = adapter(home, {
    session,
    ticket: permission,
    ledger: board(home),
    send: () => {
      const item = journal(home)[0];
      assert.equal(item.state, 'sending');
      assert.equal(item.boardAcknowledged, true);
      assert.equal(item.permissionId, permission.permissionId);
      return { status: 0, stdout: 'synthetic delivery' };
    },
  });
  assert.equal((await client.relay({ source: 'm1' })).isError, false);
  assert.equal(client.sends.length, 1);
  assert.equal(journal(home)[0].state, 'recorded');
});

test('lost consume answer stays possibly sent; restart and an empty home never invoke the route', async context => {
  const home = fixture(context);
  const ledger = board(home, true);
  const client = adapter(home, { session, ticket: permission, ledger });
  assert.equal((await client.relay({ source: 'm1' })).isError, true);
  assert.equal(client.sends.length, 0);
  assert.equal(journal(home)[0].state, 'outcome-unknown');
  const restarted = adapter(home, { session, ticket: permission, ledger });
  await restarted.drain();
  assert.equal((await restarted.relay({ source: 'm1' })).isError, true);
  const other = fixture(context);
  const emptyHome = adapter(other, {
    session,
    ticket: permission,
    ledger: async method =>
      method === 'GET'
        ? { status: 200, body: { enabled: true, available: true } }
        : { status: 200, body: { ok: true, dispatch: false, possiblySent: true } },
  });
  assert.equal((await emptyHome.relay({ source: 'm1' })).isError, true);
  assert.equal(emptyHome.sends.length, 0);
  assert.equal(restarted.sends.length, 0);
});

for (const state of ['authorized', 'sending', 'permission-requested', 'permission-consumed', 'outcome-unknown']) {
  test('interrupted journal ' + state + ' never dispatches after restart', async context => {
    const home = fixture(context);
    fs.writeFileSync(
      path.join(home, 'relay-results.jsonl'),
      JSON.stringify({
        id: 'relay-result-synthetic-ticket',
        state,
        intent: {
          id: permission.intentId,
          ticket: permission.id,
          to: permission.to,
          hash: permission.hash,
          ledgerVersion: 1,
          attemptId: permission.attemptId,
        },
      }) + '\n',
    );
    const client = adapter(home, {
      session,
      ticket: permission,
      ledger: async () => ({ status: 200, body: { enabled: true, available: true } }),
    });
    await client.drain();
    assert.equal(journal(home)[0].state, 'outcome-unknown');
    assert.equal(client.sends.length, 0);
  });
}

test('queued commands on an enabled ledger are inventoried, never automatically replayed', async context => {
  const home = fixture(context);
  const call = {
    id: crypto.randomUUID(),
    tool: 'board_shift',
    args: { action: 'end' },
    originSessionId: 'session-old',
    originEpoch: 1,
  };
  fs.writeFileSync(path.join(home, 'calls-outbox.jsonl'), JSON.stringify(call) + '\n');
  fs.writeFileSync(path.join(home, 'relay-results.jsonl'), '');
  let inventory;
  const client = adapter(home, {
    session,
    ledger: async (method, body) => {
      if (method === 'GET') return { status: 200, body: { enabled: true, available: true } };
      inventory = body;
      return { status: 200, body: { ok: true } };
    },
  });
  await client.drain();
  assert.equal(inventory.calls[0].id, call.id);
  assert.equal(inventory.calls[0].hash, storage.callHash(call));
  assert.equal(client.requests.filter(item => item.tool === 'board_shift').length, 0);
  assert.equal(storage.lines(home, 'calls-outbox.jsonl').length, 1);
});

test('crash after consumption but before starting the route never resumes a saved grant', async context => {
  const home = fixture(context);
  const sends = [];
  const ledger = board(home);
  const fault = {
    ...fs,
    mkdirSync: (file, ...args) => {
      if (String(file).endsWith(path.sep + 'inbox')) throw new Error('synthetic process loss before route');
      return fs.mkdirSync(file, ...args);
    },
  };
  const client = adapter(home, { session, ticket: permission, ledger, sends, fs: fault });
  await assert.rejects(client.relay({ source: 'm1' }), /synthetic process loss/);
  assert.equal(journal(home)[0].state, 'permission-consumed');
  const restart = adapter(home, { session, ticket: permission, ledger, sends });
  await restart.drain();
  assert.equal(journal(home)[0].state, 'outcome-unknown');
  assert.equal(sends.length, 0);
});
