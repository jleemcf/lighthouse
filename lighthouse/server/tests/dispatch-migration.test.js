'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const fixture = require('./ownership-http-fixture');
const { callHash } = require('../dispatch-ledger');

async function setup(context, initial = {}) {
  const f = await fixture(context, false, {
    dispatchLedgerEnabled: true,
    betaAccess: { beta2: 'operator' },
    initial,
  });
  const endpoint = '/api/boards/beta/dispatch-ledger';
  const ledger = (action, body = {}, credential = f.first, epoch = 1) =>
    f.request('POST', endpoint, { operationId: crypto.randomUUID(), action, ...body }, credential, epoch);
  const view = async (credential = f.first, epoch = 1) => {
    const result = (await f.request('GET', endpoint, null, credential, epoch)).body;
    if (result.enabled) return result;
    const saved = JSON.parse(fs.readFileSync(path.join(f.directory, 'store.json'), 'utf8'));
    return { ...result, calls: Object.values(saved.dispatchLedger?.boards.beta?.calls || {}) };
  };
  const post = (call, credential = f.first, epoch = 1) =>
    f.request('POST', '/api/boards/beta/calls', { calls: [call] }, credential, epoch);
  const journalId = crypto.randomUUID();
  const activation = (action, body = {}, credential = f.first) =>
    f.request(
      'POST',
      '/api/boards/beta/activation',
      { operationId: crypto.randomUUID(), action, ...body },
      credential,
      1,
    );
  const inventory = calls => activation('inventory', { journalId, complete: true, calls, relays: [] });
  await inventory([]);
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
  const activate = async () => {
    const status = (await f.request('GET', '/api/boards/beta/activation', null, 'CAPTAIN')).body;
    const result = await activation(
      'activate',
      {
        expectedEpoch: 1,
        readiness: status.readiness,
        confirmAllWriters: true,
        processIds: [f.processId],
      },
      'CAPTAIN',
    );
    assert.equal(result.status, 200, result.raw);
  };
  return { ...f, ledger, view, post, inventory, activate };
}
function queued(id = crypto.randomUUID()) {
  const call = {
    id,
    tool: 'board_post',
    args: { card: 'beta-work', kind: 'status', text: 'Exactly once during migration' },
    originSessionId: 'session-first',
    originEpoch: 1,
  };
  return { ...call, hash: callHash(call) };
}

test('preactivation legacy drain is permanently acknowledged before a different principal adopts', async context => {
  const f = await setup(context);
  const call = queued();
  await f.inventory([call]);
  const drained = await f.post({ ...call, queued: true });
  assert.equal(drained.body.results[0].ok, true, drained.raw);
  assert.equal((await f.view()).calls[0].disposition, 'acknowledged');
  await f.activate();
  assert.equal((await f.view()).calls[0].disposition, 'acknowledged');
  const credential = crypto.randomBytes(32).toString('base64url');
  await f.control({
    action: 'register',
    sessionId: 'session-third',
    installationId: 'install-test',
    principal: 'beta2',
    credential,
    scope: 'operator',
  });
  await f.acquire('session-third', credential, 1);
  const reviewed = await f.ledger(
    'review-call',
    { callId: call.id, hash: call.hash, disposition: 'adopted', reason: 'Review the original call' },
    credential,
    2,
  );
  assert.equal(reviewed.body.call.disposition, 'acknowledged');
  const repeat = await f.post({ ...call, queued: true }, credential, 2);
  assert.equal(repeat.body.results[0].duplicate, true, repeat.raw);
  assert.equal((await f.view(credential, 2)).calls[0].disposition, 'acknowledged');
});

test('activation and duplicate cache paths settle existing inventoried legacy commits', async context => {
  for (const duplicateBeforeActivation of [false, true]) {
    const call = queued();
    const committed = { board: 'beta', by: 'beta', tool: call.tool, ok: true, summary: 'Original commit' };
    const pending = { ...call, board: 'beta', originPrincipal: 'beta', disposition: 'unacknowledged', history: [] };
    const f = await setup(context, {
      calls: { ['beta|beta|' + call.id]: committed },
      dispatchLedger: {
        version: 1,
        boards: {
          beta: {
            ready: false,
            calls: { [call.id]: pending },
            intents: {},
            attempts: {},
            inventories: {},
            operations: {},
            history: [],
          },
        },
      },
    });
    assert.equal((await f.view()).calls[0].disposition, 'unacknowledged');
    if (duplicateBeforeActivation) {
      const cached = await f.post({ ...call, queued: true });
      assert.equal(cached.body.results[0].duplicate, true, cached.raw);
      assert.equal((await f.view()).calls[0].disposition, 'acknowledged');
    }
    await f.activate();
    assert.equal((await f.view()).calls[0].disposition, 'acknowledged');
    const repeat = await f.post({ ...call, queued: true });
    assert.equal(repeat.body.results[0].duplicate, true, repeat.raw);
    assert.equal((await f.view()).calls[0].disposition, 'acknowledged');
  }
});

test('an uninventoried legacy cache hit is permanently settled after activation', async context => {
  const call = queued();
  const f = await setup(context, {
    calls: {
      ['beta|beta|' + call.id]: { board: 'beta', by: 'beta', tool: call.tool, ok: true, summary: 'Original commit' },
    },
  });
  await f.activate();
  assert.equal((await f.view()).calls.length, 0);
  const cached = await f.post(call);
  assert.equal(cached.body.results[0].duplicate, true, cached.raw);
  assert.equal((await f.view()).calls[0].disposition, 'acknowledged');
});

test('owner delivered reconciliation marks the original source and conflicting late evidence holds', async context => {
  const f = await setup(context);
  await f.activate();
  await f.post({ id: crypto.randomUUID(), tool: 'board_status', args: {} });
  const source = (await f.request('GET', '/api/comments?board=beta', null, f.first, 1)).body.comments.find(
    item => item.id === 'message-test',
  ).sid;
  const relay = () =>
    f.post({
      id: crypto.randomUUID(),
      tool: 'board_relay',
      args: { source, to: 'firstmate', dispatchProtocol: 'dispatch-ledger-v1' },
    });
  const ticket = (await relay()).body.ticket;
  const intent = { intentId: ticket.intentId, attemptId: ticket.attemptId };
  await f.ledger('consume', { ...intent, permissionId: ticket.permissionId });
  await f.ledger(
    'reconcile',
    {
      ...intent,
      outcome: 'delivered',
      independent: true,
      quiesced: true,
      evidence: 'Independent route completion record',
      reason: 'Owner checked the record',
    },
    'CAPTAIN',
  );
  const message = (await f.request('GET', '/api/comments?board=beta', null, f.first, 1)).body.comments.find(
    item => item.id === 'message-test',
  );
  const audit = (await f.request('GET', '/api/comments?board=beta', null, f.first, 1)).body.comments.find(
    item => item.label === 'RELAYED',
  );
  assert.match(audit.text, /owner reconciliation/);
  assert.ok(message.relayedAt);
  assert.equal(message.handled, true);
  const repeat = await relay();
  assert.equal(repeat.body.results[0].ok, false, repeat.raw);
  assert.match(repeat.body.results[0].reason, /again/);
  const receipt = await f.post({
    id: 'relay-result-' + ticket.id,
    tool: '_relay_result',
    args: {
      ticket: ticket.id,
      delivered: false,
      evidenceCapability: ticket.evidenceCapability,
      originSessionId: 'session-first',
      originEpoch: 1,
    },
  });
  assert.equal(receipt.body.results[0].ok, false, receipt.raw);
  assert.equal((await f.view()).attempts[0].state, 'conflict');
});

async function successor(f) {
  const credential = crypto.randomBytes(32).toString('base64url');
  await f.control({
    action: 'register',
    sessionId: 'session-third',
    installationId: 'install-test',
    principal: 'beta2',
    credential,
    scope: 'operator',
  });
  await f.acquire('session-third', credential, 1);
  return credential;
}
test('legacy calls without sessions recover cross-principal commits at import and settlement', async context => {
  for (const retained of [false, true]) {
    const call = queued();
    delete call.originSessionId;
    delete call.originEpoch;
    const pending = {
      ...call,
      board: 'beta',
      originSessionId: null,
      originPrincipal: 'beta2',
      disposition: 'unacknowledged',
      history: [],
    };
    const f = await setup(context, {
      calls: {
        ['beta|beta|' + call.id]: {
          board: 'beta',
          by: 'beta',
          ok: true,
          ...(retained ? {} : { bodyHash: call.hash }),
          summary: 'Original legacy commit',
        },
      },
      ...(retained
        ? {
            dispatchLedger: {
              version: 1,
              boards: {
                beta: {
                  ready: false,
                  calls: { [call.id]: pending },
                  intents: {},
                  attempts: {},
                  inventories: {},
                  operations: {},
                  history: [],
                },
              },
            },
          }
        : {}),
    });
    await f.activate();
    const credential = await successor(f);
    const imported = await f.ledger(
      'inventory',
      { journalId: crypto.randomUUID(), complete: true, calls: [call], relays: [] },
      credential,
      2,
    );
    assert.equal(imported.status, 200, imported.raw);
    assert.equal(imported.body.calls[0].disposition, 'acknowledged');
    const review = await f.ledger(
      'review-call',
      { callId: call.id, hash: call.hash, disposition: 'adopted', reason: 'Review transferred legacy work' },
      credential,
      2,
    );
    assert.equal(review.body.call.disposition, 'acknowledged');
    const repeated = await f.post({ ...call, queued: true }, credential, 2);
    assert.equal(repeated.body.results[0].duplicate, true, repeated.raw);
    assert.equal(repeated.body.results[0].summary, 'Original legacy commit');
  }
});

test('ambiguous or mismatched legacy commit evidence stays held and cannot be adopted', async context => {
  for (const ambiguous of [false, true]) {
    const call = queued();
    delete call.originSessionId;
    const commit = { board: 'beta', by: 'beta', ok: true, bodyHash: ambiguous ? call.hash : 'other-body' };
    const f = await setup(context, {
      calls: {
        ['beta|beta|' + call.id]: commit,
        ...(ambiguous ? { ['beta|beta2|' + call.id]: { ...commit, by: 'beta2' } } : {}),
      },
    });
    await f.activate();
    const credential = await successor(f);
    const imported = await f.ledger(
      'inventory',
      { journalId: crypto.randomUUID(), complete: true, calls: [call], relays: [] },
      credential,
      2,
    );
    assert.equal(imported.status, 200, imported.raw);
    assert.equal(imported.body.calls[0].disposition, 'unacknowledged');
    const review = await f.ledger(
      'review-call',
      { callId: call.id, hash: call.hash, disposition: 'adopted', reason: 'Review transferred legacy work' },
      credential,
      2,
    );
    assert.equal(review.status, 409, review.raw);
    const repeated = await f.post({ ...call, queued: true }, credential, 2);
    assert.equal(repeated.status, 409, repeated.raw);
    const dismissed = await f.ledger(
      'review-call',
      {
        callId: call.id,
        hash: call.hash,
        disposition: 'superseded',
        reason: 'Owner arranged separate resolution of ambiguous evidence',
      },
      credential,
      2,
    );
    assert.equal(dismissed.body.call.disposition, 'superseded');
  }
});
