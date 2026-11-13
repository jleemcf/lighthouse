'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { cardFixture } = require('./card-fixture');

test('completion events: tool, line and legacy closure carry the same explicit evidence', async context => {
  const { request, call, open, ask } = await cardFixture(context);
  await open('tool-finish');
  assert.equal((await call('board_close', { card: 'tool-finish', outcome: 'Export delivered.' })).ok, true);
  await request(
    'POST',
    '/api/boards/lines/events',
    {
      rows: [{ label: 'TASK_FINISHED', task: 'line-finish', text: 'Export delivered.' }],
    },
    'LEGACY',
  );
  await open('legacy-finish');
  await request('PATCH', '/api/cards/t-legacy-finish', { status: 'done' }, 'LEGACY');
  await request('PUT', '/api/cards/t-put-finish', { board: 't', status: 'done' }, 'LEGACY');
  await request(
    'POST',
    '/api/boards/lines/events',
    {
      rows: [{ label: 'STATUS', task: 'state-finish', state: 'done', text: 'Export delivered.' }],
    },
    'LEGACY',
  );
  for (const id of ['t-tool-finish', 'lines-line-finish', 't-legacy-finish', 't-put-finish', 'lines-state-finish']) {
    const card = (await request('GET', '/api/cards/' + id)).body.card;
    const events = card.log.filter(entry => entry.event === 'task_finished');
    assert.equal(events.length, 1, id);
    assert.ok(events[0].t);
  }
  await request('PATCH', '/api/cards/t-tool-finish', { status: 'inflight' }, 'LEGACY');
  await ask('tool-finish');
  const conduct = (await request('GET', '/api/boards/t/conduct')).body;
  assert.equal(conduct.signals.afterDone, 1);
  assert.equal(conduct.examples.afterDone[0].id, 't-tool-finish');
});

test('completion events: refused tool, legacy and line closes record no completion', async context => {
  const { request, call, open, ask } = await cardFixture(context);
  await open('blocked');
  await ask('blocked');
  assert.equal((await call('board_close', { card: 'blocked', outcome: 'Delivered.' })).ok, false);
  assert.equal((await request('PATCH', '/api/cards/t-blocked', { status: 'done' }, 'LEGACY')).status, 409);
  await request(
    'POST',
    '/api/boards/lines/events',
    {
      rows: [
        { label: 'ACTION', task: 'blocked', text: 'Choose a format.' },
        { label: 'STATUS', task: 'blocked', state: 'done', text: 'Delivered.' },
      ],
    },
    'LEGACY',
  );
  for (const id of ['t-blocked', 'lines-blocked']) {
    const card = (await request('GET', '/api/cards/' + id)).body.card;
    assert.equal(card.log.filter(entry => entry.event === 'task_finished').length, 0);
  }
});

test('completion events: a line prompt supersedes done without recording completion', async context => {
  const { request } = await cardFixture(context);
  await request(
    'POST',
    '/api/boards/lines/events',
    {
      rows: [
        { label: 'TASK_CREATED', task: 'prompt-finish', text: 'Prepare the export.' },
        { label: 'PROMPT', task: 'prompt-finish', state: 'done', text: 'Run the next step.' },
        { label: 'ACTION', task: 'prompt-finish', text: 'May I implement the remaining export?' },
      ],
    },
    'LEGACY',
  );
  const card = (await request('GET', '/api/cards/lines-prompt-finish')).body.card;
  assert.equal(card.status, 'waiting');
  assert.ok(card.decisions.some(decision => !decision.resolvedAt));
  assert.equal(card.log.filter(entry => entry.event === 'task_finished').length, 0);
  assert.equal((await request('GET', '/api/boards/lines/conduct')).body.signals.afterDone, 0);
});

test('completion events: CRM tool and line answers await a delivery receipt', async context => {
  const cards = {},
    comments = {};
  for (const board of ['t', 'lines']) {
    const id = board + '-staff';
    cards[id] = {
      id,
      board,
      title: 'Export question',
      status: 'inflight',
      crm: { id: board + '-question' },
      decisions: [],
      log: [],
    };
    comments[board + '-question'] = {
      id: board + '-question',
      board,
      cardId: id,
      by: 'staff:Requestor',
      via: 'crm',
      author: 'staff',
      kind: 'staff',
      text: 'Is the export ready?',
      handled: false,
    };
  }
  const { request, call } = await cardFixture(context, { cards, comments });
  await call('board_status', {});
  const staff = (await request('GET', '/api/comments?cardId=t-staff')).body.comments[0];
  assert.equal((await call('board_reply', { card: 'staff', to: [staff.sid], text: 'The export is ready.' })).ok, true);
  await request(
    'POST',
    '/api/boards/lines/events',
    {
      rows: [{ label: 'REPLY', task: 'staff', text: 'The export is ready.' }],
    },
    'LEGACY',
  );
  for (const id of ['t-staff', 'lines-staff']) {
    const card = (await request('GET', '/api/cards/' + id)).body.card;
    assert.equal(card.crm.state, 'sending', id);
    assert.notEqual(card.status, 'done', id);
    assert.equal(card.log.filter(entry => entry.event === 'task_finished').length, 0, id);
  }
});
