'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { cardFixture } = require('./card-fixture');

test('ClosedCardsHaveNoOpenAsks: authorized legacy PATCH agrees with board_close', async context => {
  const { request, call, open, ask } = await cardFixture(context);
  await open('export');
  const decision = await ask('export');
  assert.equal((await request('PATCH', '/api/cards/t-export', { status: 'done' })).status, 403);
  const refused = await request('PATCH', '/api/cards/t-export', { status: 'done' }, 'LEGACY');
  assert.equal(refused.status, 409);
  const close = await call('board_close', { card: 'export', outcome: 'Delivered' });
  assert.equal(close.ok, false);
  assert.ok(close.reason.includes('export'));
  assert.ok(close.reason.includes(decision.sid));
  assert.ok(close.reason.includes('board_withdraw'));
  const card = (await request('GET', '/api/cards/t-export')).body.card;
  assert.equal(card.status, 'waiting');
  assert.equal(card.decisions.filter(decision => !decision.resolvedAt).length, 1);
});

test('ClosedCardsHaveNoOpenAsks: legacy PUT cannot discard an open obligation', async context => {
  const { request, open, ask } = await cardFixture(context);
  await open('replace');
  await ask('replace');
  for (const body of [{ status: 'done' }, { status: 'done', decisions: [] }]) {
    const refused = await request('PUT', '/api/cards/t-replace', body, 'LEGACY');
    assert.equal(refused.status, 409);
  }
  const card = (await request('GET', '/api/cards/t-replace')).body.card;
  assert.equal(card.status, 'waiting');
  assert.equal(card.decisions.filter(decision => !decision.resolvedAt).length, 1);
});

test('card routes: captain settlement and withdrawal allow guarded legacy closure', async context => {
  const { request, call, open, ask } = await cardFixture(context);
  await open('settle');
  await ask('settle');
  assert.equal((await request('POST', '/api/cards/t-settle/resolve', {}, 'CAPTAIN')).body.settled, 1);
  const closed = await request('PATCH', '/api/cards/t-settle', { status: 'done' }, 'LEGACY');
  assert.equal(closed.status, 200);
  assert.equal(closed.body.status, 'done');
  assert.equal((await request('PATCH', '/api/cards/t-settle', { needsAction: true }, 'LEGACY')).status, 409);
  await open('withdraw');
  const decision = await ask('withdraw');
  assert.equal((await call('board_withdraw', { ask_id: decision.sid, reason: 'No longer required' })).ok, true);
  assert.equal((await call('board_close', { card: 'withdraw', outcome: 'Withdrawn' })).ok, true);
});

test('card routes: last-ask settlement and withdrawal clear a hidden legacy flag', async context => {
  const { request, call, open, ask } = await cardFixture(context);
  for (const task of ['handled', 'withdrawn']) {
    await open(task);
    const decision = await ask(task);
    await request('PATCH', '/api/cards/t-' + task, { needsAction: true }, 'LEGACY');
    if (task === 'handled')
      await request('POST', '/api/cards/t-' + task + '/resolve', { decision: decision.id }, 'CAPTAIN');
    else await call('board_withdraw', { ask_id: decision.sid, reason: 'No longer required' });
    const card = (await request('GET', '/api/cards/t-' + task)).body.card;
    assert.equal(card.needsAction, false);
    assert.equal(card.status, 'inflight');
    assert.equal((await call('board_close', { card: task, outcome: 'Delivered' })).ok, true);
  }
});

test('card routes: STATUS guards real asks while TASK_FINISHED settles and closes', async context => {
  const { request } = await cardFixture(context);
  const line = row => request('POST', '/api/boards/lines/events', { rows: [row] }, 'LEGACY');
  await line({ label: 'TASK_CREATED', task: 'export', text: 'Build export', state: 'inflight' });
  await line({ label: 'ACTION', task: 'export', text: 'Choose an export format.' });
  assert.equal((await line({ label: 'STATUS', task: 'export', state: 'done', text: 'Ready.' })).status, 200);
  const waiting = (await request('GET', '/api/cards/lines-export')).body.card;
  assert.equal(waiting.status, 'waiting');
  assert.equal(waiting.decisions.filter(decision => !decision.resolvedAt).length, 1);
  await line({ label: 'TASK_FINISHED', task: 'export', text: 'Delivered.' });
  const finished = (await request('GET', '/api/cards/lines-export')).body.card;
  assert.equal(finished.status, 'done');
  assert.equal(finished.decisions.filter(decision => !decision.resolvedAt).length, 0);
});

test('card routes: leaving bare Waiting settles the board placeholder before closure', async context => {
  const { request } = await cardFixture(context);
  const line = row => request('POST', '/api/boards/lines/events', { rows: [row] }, 'LEGACY');
  for (const label of ['STATUS', 'TASK_FINISHED']) {
    const task = label.toLowerCase();
    await line({ label: 'STATUS', task, state: 'waiting', text: 'Waiting for review.' });
    await line({ label, task, state: 'done', text: 'Delivered.' });
    const card = (await request('GET', '/api/cards/lines-' + task)).body.card;
    assert.equal(card.status, 'done');
    assert.equal(card.decisions.filter(decision => !decision.resolvedAt).length, 0);
  }
});

test('card routes: a repeated ACTION moves its existing ask back to Waiting', async context => {
  const { request } = await cardFixture(context);
  const line = row => request('POST', '/api/boards/lines/events', { rows: [row] }, 'LEGACY');
  const action = { label: 'ACTION', task: 'repeat', decision: 'format', text: 'Choose a format.' };
  await line(action);
  await line({ label: 'STATUS', task: 'repeat', state: 'held', text: 'Waiting on a dependency.' });
  await line(action);
  const card = (await request('GET', '/api/cards/lines-repeat')).body.card;
  assert.equal(card.status, 'waiting');
  assert.equal(card.decisions.filter(decision => !decision.resolvedAt).length, 1);
});

test('card routes: legacy write counts contain only method counts on the board', async context => {
  const { request } = await cardFixture(context);
  await request('PUT', '/api/cards/t-audit', { board: 't', title: 'Private task text' }, 'LEGACY');
  await request('PATCH', '/api/cards/t-audit', { status: 'held' }, 'LEGACY');
  await request('PATCH', '/api/cards/t-audit', { status: 'invalid' }, 'LEGACY');
  const state = (await request('GET', '/api/state', undefined, 'CAPTAIN')).body;
  assert.deepEqual(state.boards.t.legacyCardWrites, { PUT: 1, PATCH: 2 });
});

test('card routes: CRM staff answer cannot close over a separate captain ask', async context => {
  const initialStore = {
    cards: {
      't-staff': {
        id: 't-staff',
        board: 't',
        title: 'Staff question',
        status: 'waiting',
        crm: { id: 'q1' },
        decisions: [{ id: 'ask1', ask: 'Choose a format.', resolvedAt: null }],
        log: [],
      },
    },
    comments: {
      staff1: {
        id: 'staff1',
        board: 't',
        cardId: 't-staff',
        by: 'staff:Requestor',
        via: 'crm',
        author: 'staff',
        kind: 'staff',
        text: 'Can you build the export?',
        handled: false,
      },
    },
  };
  const { request, call } = await cardFixture(context, initialStore);
  await call('board_status', {});
  const comments = (await request('GET', '/api/comments?cardId=t-staff')).body.comments;
  const staff = comments.find(comment => comment.id === 'staff1');
  const result = await call('board_reply', { card: 'staff', to: [staff.sid], text: 'The export is available.' });
  assert.equal(result.ok, true, result.reason);
  const card = (await request('GET', '/api/cards/t-staff')).body.card;
  assert.notEqual(card.status, 'done');
  assert.equal(card.decisions.filter(decision => !decision.resolvedAt).length, 1);
});
