'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const makeOutbox = require('../scripts/steward-outbox.cjs');

function fixture(t, send) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-steward-outbox-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'pending-result.json');
  let clock = 0;
  const options = { directory, server: 'http://127.0.0.1:12345', board: 'test', send, now: () => clock };
  return {
    create: changes => makeOutbox({ ...options, ...changes }),
    saved: () => JSON.parse(fs.readFileSync(file, 'utf8')),
    exists: () => fs.existsSync(file),
    advance: time => (clock = time),
  };
}

test('completed answers survive repeated outages and restarts with capped backoff until acknowledged', async t => {
  let calls = 0;
  let available = false;
  const body = { request: 'a1', oneLine: 'Paid for once' };
  const store = fixture(t, async (method, route, sent) => {
    calls++;
    assert.equal(method, 'POST');
    assert.equal(route, '/api/steward/result');
    assert.deepEqual(sent, body);
    return available ? { status: 200, body: { ok: true, request: 'a1', duplicate: true } } : { status: 503 };
  });
  let outbox = store.create();
  outbox.enqueue(body);
  let previousDelay = 0;
  for (let attempt = 0; attempt < 9; attempt++) {
    assert.equal((await outbox.flush()).pending, true);
    const saved = store.saved();
    const delay = saved.notBefore - (attempt ? previousDelay : 0);
    assert.equal(delay, Math.min(15 * 60000, 15000 * 2 ** attempt));
    assert.equal((await outbox.flush()).deferred, true);
    assert.equal(calls, attempt + 1, 'backoff does not post early');
    previousDelay = saved.notBefore;
    store.advance(saved.notBefore);
    outbox = store.create();
  }
  available = true;
  assert.equal((await outbox.flush()).delivered, true);
  assert.equal(calls, 10);
  assert.equal(store.exists(), false);
});

test('a completed diagram is saved before upload and its accepted upload is reused after restart', async t => {
  let uploads = 0;
  let available = false;
  let uploadAvailable = false;
  const svg = '<svg></svg>';
  const store = fixture(t, async (method, route, body) => {
    if (route === '/api/steward/diagram') {
      uploads++;
      assert.equal(body.toString('utf8'), svg);
      return uploadAvailable ? { status: 201, body: { id: 'drawing' } } : { status: 503 };
    }
    assert.equal(body.diagram, 'drawing');
    return available ? { status: 200, body: { ok: true, request: 'a2' } } : { status: 503 };
  });
  store.create().enqueue({ request: 'a2' }, svg);
  assert.equal(store.saved().svg, svg);
  await store.create().flush();
  assert.equal(store.saved().svg, svg);
  store.advance(store.saved().notBefore);
  uploadAvailable = true;
  await store.create().flush();
  assert.equal(store.saved().body.diagram, 'drawing');
  assert.equal(store.saved().svg, svg, 'keep the drawing until the whole answer is acknowledged');
  store.advance(store.saved().notBefore);
  available = true;
  assert.equal((await store.create().flush()).delivered, true);
  assert.equal(uploads, 2, 'the acknowledged upload is not repeated');
});

test('an expired upload is recreated from the saved SVG without discarding the completed answer', async t => {
  let uploads = 0;
  let available = false;
  const svg = '<svg></svg>';
  const store = fixture(t, async (method, route, body) => {
    if (route === '/api/steward/diagram') {
      assert.equal(body.toString('utf8'), svg);
      return { status: 201, body: { id: 'drawing-' + ++uploads } };
    }
    assert.equal(body.text, 'Preserve this paid answer');
    if (!available) return { status: 503 };
    if (body.diagram === 'drawing-1')
      return { status: 422, body: { error: 'the explainer needs its SVG diagram, uploaded first' } };
    assert.equal(body.diagram, 'drawing-2');
    return { status: 200, body: { ok: true, request: body.request } };
  });
  store.create().enqueue({ request: 'expired', text: 'Preserve this paid answer' }, svg);
  await store.create().flush();
  store.advance(2 * 86400000);
  available = true;
  assert.equal((await store.create().flush()).pending, true, 'an expired upload is not a final answer refusal');
  assert.equal(store.saved().body.diagram, undefined);
  assert.equal(store.saved().svg, svg);
  store.advance(store.saved().notBefore);
  assert.equal((await store.create().flush()).delivered, true);
  assert.equal(uploads, 2);
  assert.equal(store.exists(), false);
});

test('only a matching board acknowledgement clears an answer and another answer cannot overwrite it', async t => {
  let reply = { status: 200, body: { ok: false, request: 'a3' } };
  const store = fixture(t, async () => reply);
  const outbox = store.create();
  outbox.enqueue({ request: 'a3', text: 'Keep this answer' });
  assert.throws(() => outbox.enqueue({ request: 'another' }), /awaits acceptance/);
  for (const response of [reply, { status: 403 }, { status: 200, body: { ok: true, request: 'another' } }]) {
    reply = response;
    assert.equal((await outbox.flush()).pending, true);
    assert.equal(store.saved().body.text, 'Keep this answer');
    store.advance(store.saved().notBefore);
  }
});

test('changing board configuration never posts an existing saved answer to the new board', async t => {
  let calls = 0;
  const store = fixture(t, async () => {
    calls++;
    return { status: 200 };
  });
  store.create().enqueue({ request: 'a4' });
  const result = await store.create({ board: 'another' }).flush();
  assert.equal(result.pending, true);
  assert.equal(calls, 0);
  assert.equal(store.exists(), true);
});

test('a permanent result refusal ends delivery instead of blocking the next job or repeating alerts', async t => {
  let calls = 0;
  let status = 422;
  const store = fixture(t, async () => {
    calls++;
    return { status, body: { error: 'refused' } };
  });
  const outbox = store.create();
  for (const refused of [400, 404, 409, 413, 415, 422]) {
    status = refused;
    outbox.enqueue({ request: 'refused-' + status });
    const reply = await outbox.flush();
    assert.equal(reply.pending, false);
    assert.equal(reply.refused, true);
    assert.equal(reply.status, status);
    assert.equal(store.exists(), false);
    assert.deepEqual(await outbox.flush(), { pending: false });
  }
  assert.equal(calls, 6, 'each refused answer is posted once');
});

test('a refused diagram reports a durable failure while temporary refusals keep the saved answer', async t => {
  let status = 413;
  let resultStatus = 503;
  const posted = [];
  const store = fixture(t, async (method, route, body) => {
    if (route === '/api/steward/diagram') return { status };
    posted.push(body);
    return { status: resultStatus, body: { ok: true, request: body.request } };
  });
  store.create().enqueue({ request: 'diagram' }, '<svg></svg>');
  assert.equal((await store.create().flush()).pending, true);
  assert.equal(store.saved().svg, undefined);
  assert.equal(store.saved().body.failed, true);
  assert.match(store.saved().body.detail, /diagram was refused.*413/);
  store.advance(store.saved().notBefore);
  resultStatus = 200;
  assert.equal((await store.create().flush()).delivered, true);
  assert.deepEqual(posted[0], posted[1], 'the failure report also survives a restart');
  for (const temporary of [0, 403, 429, 500, 503]) {
    status = temporary;
    const outbox = store.create();
    outbox.enqueue({ request: 'temporary-' + status }, '<svg></svg>');
    assert.equal((await outbox.flush()).pending, true);
    assert.equal(store.saved().svg, '<svg></svg>');
    store.advance(store.saved().notBefore);
    status = 415;
    await outbox.flush();
    assert.equal(store.exists(), false);
  }
});
