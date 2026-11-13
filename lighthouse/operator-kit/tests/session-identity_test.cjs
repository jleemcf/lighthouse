'use strict';
require('../../tests/sandbox.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { identity, attachment, queuedCall, relayEntry } = require('../scripts/session-identity.cjs');
const { watch } = require('../scripts/shift-session.cjs');
const { protect } = require('../../server/registry-files');
const { wait } = require('../../server/tests/helpers');

test('logical identity: no home inference; explicit reconnect retains identity', context => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-session-'));
  const file = path.join(home, 'session.json');
  fs.writeFileSync(
    file,
    JSON.stringify({ sessionId: 'session-logical', credential: crypto.randomBytes(32).toString('base64url') }),
    { mode: 0o600 },
  );
  protect(home, true);
  protect(file);
  context.after(() => fs.rmSync(home, { recursive: true, force: true }));
  assert.equal(identity({ HOME: home, USERPROFILE: home }), null);
  assert.throws(() => identity({ LH_OPERATOR_SESSION_ID: 'session-logical' }), /explicit/);
  const env = { LH_OPERATOR_SESSION_ID: 'session-logical', LH_SESSION_CREDENTIAL_FILE: file, LH_SESSION_EPOCH: '7' };
  const first = identity(env);
  const reconnect = identity(env);
  assert.equal(first.sessionId, reconnect.sessionId);
  assert.equal(first.credential, reconnect.credential);
  assert.notEqual(first.processId, reconnect.processId);
  assert.equal(first.headers['X-Lighthouse-Epoch'], '7');
  assert.throws(() => identity({ ...env, LH_OPERATOR_SESSION_ID: 'session-unrelated' }), /binding/);
  assert.throws(() => identity({ ...env, LH_SESSION_EPOCH: '07' }), /exact/);
});

test('logical identity: each tool process attaches once before heartbeats; attach failure retries', async context => {
  const requests = [];
  let attempts = 0;
  const session = { sessionId: 'session-logical', processId: 'process-logical', epoch: 7 };
  const request = async (...args) => {
    requests.push(args);
    return { status: args[1].endsWith('/ownership') && ++attempts === 1 ? 409 : 200 };
  };
  const stop = watch({ request, board: 'tools', shadow: () => false, identity: session, intervalMs: 20 });
  context.after(stop);
  await wait(95);
  stop();
  assert.equal(requests.filter(args => args[1].endsWith('/ownership')).length, 2);
  const beats = requests.filter(args => args[1].endsWith('/heartbeat'));
  assert.ok(beats.length >= 2);
  assert.ok(beats.every(args => args[2].session === session.sessionId && args[2].processId === session.processId));
  await assert.rejects(
    attachment(session, async () => ({ status: 403 }), 'tools'),
    /explicit session/,
  );
});

test('logical identity: outbox provenance and ticket capability are retained before any external send', () => {
  const session = { sessionId: 'session-logical', epoch: 7 };
  const call = queuedCall(session, 'call-test', 'board_post', { text: 'Work' });
  assert.equal(call.originSessionId, session.sessionId);
  assert.equal(call.originEpoch, 7);
  assert.equal(queuedCall(null, 'call-legacy', 'board_post').originSessionId, undefined);
  const entry = relayEntry(session, 'relay-result', {
    id: 'ticket-test',
    to: 'firstmate',
    hash: 'fixture-hash',
    evidenceCapability: 'synthetic-ticket-capability',
  });
  assert.equal(entry.state, 'authorized');
  assert.equal(entry.evidenceCapability, 'synthetic-ticket-capability');
  assert.equal(entry.originSessionId, session.sessionId);
  assert.equal(entry.originEpoch, 7);
});
