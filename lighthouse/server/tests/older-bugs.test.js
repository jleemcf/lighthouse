'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const makeCrm = require('../crm');
const makeEvents = require('../events');
const makeGrammar = require('../grammar');

test('a CRM reply change keeps the card board, including hyphens', async t => {
  const service = http.createServer((request, response) => {
    request.resume();
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end('{}');
  });
  await new Promise(resolve => service.listen(0, '127.0.0.1', resolve));
  t.after(() => service.close());
  const card = { id: 'sales-east-crm-q-7', board: 'sales-east' };
  const store = {
    boards: { sales: {}, 'sales-east': {} },
    cards: { [card.id]: card },
    crm: { outbox: [] },
  };
  let changed;
  const changeReceived = new Promise(resolve => (changed = resolve));
  const changes = [];
  const crm = makeCrm({
    cfg: { crm: { base: 'http://127.0.0.1:' + service.address().port, board: 'unused', pollSec: 3600 } },
    CONFIG_PATH: path.join(os.tmpdir(), 'lighthouse-crm-test', 'config.json'),
    store,
    now: () => '2026-11-06T12:00:00Z',
    newId: () => 'reply-7',
    change: (...args) => {
      changes.push(args);
      changed();
    },
    save: () => {},
    pushLog: () => {},
  });
  crm.crmSend('reply', '7', card.id, { kind: 'answer', text: 'Ready.' });
  await changeReceived;
  assert.deepEqual(changes, [['card', card.id, 'crm', 'sales-east']]);
  assert.deepEqual(store.crm.outbox, []);
});

test('SHIFT off before the first shift records an off shift without throwing', () => {
  const board = { activity: [] };
  const store = { boards: { test: board }, comments: {} };
  const timestamp = '2026-11-06T12:00:00Z';
  const changes = [];
  const ctx = {
    cfg: {},
    store,
    now: () => timestamp,
    change: (...args) => changes.push(args),
    pushActivity: (record, text, time) => record.activity.push({ text, time }),
  };
  Object.assign(ctx, makeGrammar(ctx));
  const { applyEvent } = makeEvents(ctx);
  assert.deepEqual(applyEvent('test', { label: 'SHIFT', text: 'shift ended.' }, 'operator'), { ok: true });
  assert.equal(board.shift.state, 'off');
  assert.equal(board.shift.operator, 'operator');
  assert.equal(board.shift.endedAt, timestamp);
  assert.equal(board.shift.lastSeen, timestamp);
  assert.equal(board.shift.since, undefined);
  assert.deepEqual(changes, [['board', 'test', 'operator', 'test']]);
  assert.equal(board.activity.length, 1);
});
