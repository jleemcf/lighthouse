'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { cardFixture } = require('./card-fixture');
const { wait } = require('./helpers');
const { questionState } = require('../crm-state');
const lifecycle = require('../card-transitions');

test('CRM reopen is a card transition that preserves open lanes and retained completion evidence', context => {
  for (const status of ['queued', 'inflight', 'held', 'waiting', 'done']) {
    const card = { status, closedAt: 'closed', log: [{ event: 'task_finished' }], needsAction: true };
    const before = structuredClone(card);
    assert.equal(lifecycle.reopen(card).ok, true);
    if (status === 'done') {
      assert.equal(card.status, 'inflight');
      assert.equal(card.closedAt, undefined);
      assert.deepEqual(card.log, before.log);
      assert.equal(card.needsAction, true);
    } else assert.deepEqual(card, before);
  }
  const reopen = context.mock.method(lifecycle, 'reopen');
  const card = { id: 'legacy', status: 'done', closedAt: 'closed', crm: { id: '7' } };
  const pending = { cid: card.id, kind: 'reply', id: 'pending' };
  assert.equal(questionState(card, { crm: { outbox: [pending] } }), 'sending');
  assert.equal(reopen.mock.callCount(), 1);
  assert.equal(card.status, 'inflight');
  assert.equal(card.closedAt, undefined);
  assert.equal(pending.closeOnDelivery, true);
});

function staffStore(board = 't', extra = {}) {
  const card = {
    id: board + '-staff',
    board,
    title: 'Staff question',
    status: 'inflight',
    crm: { id: '7' },
    decisions: [],
    log: [],
    ...extra,
  };
  const message = {
    id: 'staff-message',
    board,
    cardId: card.id,
    by: 'staff:Sam',
    via: 'crm',
    author: 'staff',
    kind: 'staff',
    text: 'How many leads?',
    handled: false,
  };
  return { cards: { [card.id]: card }, comments: { [message.id]: message } };
}

async function crmFixture(context, initial, board = 't', status = 500) {
  const remote = { status, replies: [], acks: [] };
  const service = http.createServer((request, response) => {
    const chunks = [];
    request.on('data', chunk => chunks.push(chunk));
    request.on('end', () => {
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks)) : {};
      const reply = request.url.endsWith('/reply');
      if (reply) remote.replies.push(body);
      else if (request.method === 'POST') remote.acks.push(body);
      response.writeHead(reply ? remote.status : 200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify(request.method === 'GET' ? { questions: [] } : { ok: true }));
    });
  });
  await new Promise(resolve => service.listen(0, '127.0.0.1', resolve));
  context.after(() => service.close());
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-delivery-'));
  context.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
  fs.writeFileSync(path.join(scratch, 'crm.key'), 'stand-in-key');
  const fixture = await cardFixture(context, initial, {
    crm: {
      base: 'http://127.0.0.1:' + service.address().port,
      board,
      pollSec: 1,
      keyFile: path.join(scratch, 'crm.key'),
    },
  });
  const read = async () => (await fixture.request('GET', '/api/cards/' + board + '-staff')).body.card;
  const until = async predicate => {
    for (let attempt = 0; attempt < 250; attempt++) {
      const card = await read();
      if (predicate(card)) return card;
      await wait(20);
    }
    assert.fail('CRM delivery did not reach its expected state');
  };
  return { ...fixture, remote, read, until };
}

test('CRM legacy records derive asked, working, sending and done without a schema bump', () => {
  const initial = staffStore();
  const card = initial.cards['t-staff'];
  initial.crm = { outbox: [] };
  assert.equal(questionState(card, initial), 'asked');
  delete card.crm.state;
  card.crm.working = '2026-11-09T12:00:00Z';
  assert.equal(questionState(card, initial), 'working');
  delete card.crm.state;
  card.status = 'done';
  assert.equal(questionState(card, initial), 'done');
  delete card.crm.state;
  initial.crm.outbox.push({ id: 'pending', kind: 'reply', cid: card.id });
  assert.equal(questionState(card, initial), 'sending');
  assert.notEqual(card.status, 'done');
});

for (const status of ['held', 'inflight', 'done']) {
  test('CRM legacy pending ' + status + ' reply preserves delivery intent', async context => {
    const initial = staffStore('t', { status });
    initial.comments['staff-message'].handled = true;
    initial.crm = {
      delivered: { 7: 't-staff' },
      outbox: [
        {
          id: 'legacy-answer',
          kind: 'reply',
          qid: '7',
          cid: 't-staff',
          attempts: 0,
          body: { id: 'legacy-answer', kind: 'answer', text: 'Twelve leads.', by: 'operator' },
        },
      ],
    };
    const { remote, read, until } = await crmFixture(context, initial);
    assert.equal((await read()).status, status === 'done' ? 'inflight' : status);
    await until(card => card.crm.state === 'failed');
    remote.status = 200;
    assert.equal((await until(card => card.crm.state === 'done')).status, status);
  });
}

test('CRM delivered legacy answers remain closable in an explicit open lane', async context => {
  const initial = staffStore();
  initial.comments['staff-message'].handled = true;
  initial.crm = { outbox: [] };
  const card = initial.cards['t-staff'];
  assert.equal(questionState(card, initial), 'done');
  delete card.crm.state;
  card.log.push({ text: 'needs_owner sent to the CRM' });
  assert.equal(questionState(card, initial), 'working');
  delete card.crm.state;
  card.log.push({ text: 'answer sent to the CRM' });
  assert.equal(questionState(card, initial), 'done');
  delete card.crm.state;
  const { call, read } = await crmFixture(context, initial, 't', 200);
  await call('board_status', {});
  assert.equal((await read()).crm.state, 'done');
  assert.equal((await call('board_close', { card: 'staff', outcome: 'Answered.' })).ok, true);
});

test('CRM close refusals distinguish an owed answer, active retries and stopped delivery', () => {
  for (const [state, retrying, reason] of [
    ['asked', false, /Answer the staff question/],
    ['working', false, /kind: declined/],
    ['sending', false, /Wait for delivery/],
    ['failed', true, /Wait for delivery/],
    ['failed', false, /Send the answer again/],
  ]) {
    const card = staffStore('t', { crm: { state, failure: { retrying } } }).cards['t-staff'];
    const result = lifecycle.close(card, '2026-11-10T00:00:00Z');
    assert.equal(result.ok, false);
    assert.match(result.reason, reason);
    assert.equal(card.status, 'inflight');
  }
});

test('CRM legacy ACTION routing uses question state, not equal timestamps', async context => {
  const initial = staffStore('lines', { crm: { id: '7', state: 'done' } });
  initial.comments['staff-message'].handled = true;
  initial.comments['staff-message'].handledAt = '2026-11-09T12:00:00Z';
  const { request, remote } = await crmFixture(context, initial, 'lines', 200);
  await request(
    'POST',
    '/api/boards/lines/events',
    {
      rows: [
        {
          label: 'ACTION',
          task: 'staff',
          t: '2026-11-09T12:00:00Z',
          text: 'May I add a column to the report?',
        },
      ],
    },
    'LEGACY',
  );
  await wait(80);
  assert.equal(remote.replies.length, 0, 'a settled staff question is not answered twice by coincident clocks');
});

test('CRM a second ACTION does not send another needs_owner reply', async context => {
  const { request, remote, until } = await crmFixture(context, staffStore('lines'), 'lines', 200);
  for (const text of ['May I change the report?', 'May I also include a total?']) {
    await request('POST', '/api/boards/lines/events', { rows: [{ label: 'ACTION', task: 'staff', text }] }, 'LEGACY');
    await until(card => card.crm.state === 'working');
  }
  await wait(80);
  assert.equal(remote.replies.length, 1);
  assert.equal(remote.replies[0].kind, 'needs_owner');
});

test('CRM line close refusals reach the operator and pending explicit finish waits for acceptance', async context => {
  const { request, remote, read, until } = await crmFixture(context, staffStore('lines'), 'lines');
  const post = row => request('POST', '/api/boards/lines/events', { rows: [{ task: 'staff', ...row }] }, 'LEGACY');
  await post({ label: 'TASK_FINISHED', text: 'Close it.' });
  let board = (await request('GET', '/api/state', null, 'CAPTAIN')).body.boards.lines;
  assert.ok(board.notes.some(note => note.to === 'operator' && /Answer the staff question/.test(note.text)));
  await post({ label: 'REPLY', text: 'Twelve leads.', state: 'inflight' });
  await until(card => card.crm.state === 'failed');
  await post({ label: 'TASK_FINISHED', text: 'The answer is the completed work.' });
  board = (await request('GET', '/api/state', null, 'CAPTAIN')).body.boards.lines;
  assert.ok(board.notes.some(note => note.to === 'operator' && /Wait for delivery/.test(note.text)));
  assert.notEqual((await read()).status, 'done');
  remote.status = 200;
  assert.equal((await until(card => card.crm.state === 'done')).status, 'done');
});

test('CRM line follow-up state=done requires its own delivery receipt', async context => {
  const initial = staffStore('lines', { status: 'done', crm: { id: '7', state: 'done' } });
  initial.comments['staff-message'].handled = true;
  const { request, remote, read, until } = await crmFixture(context, initial, 'lines');
  await request(
    'POST',
    '/api/boards/lines/events',
    { rows: [{ label: 'REPLY', task: 'staff', text: 'The count is thirteen now.', state: 'done' }] },
    'LEGACY',
  );
  const pending = await read();
  assert.notEqual(pending.status, 'done');
  assert.equal(
    pending.log.some(entry => entry.event === 'task_finished'),
    false,
  );
  await until(card => card.crm.state === 'failed');
  remote.status = 200;
  assert.equal((await until(card => card.crm.state === 'done')).status, 'done');
});

test('CRM acceptance respects an explicit open lane and needs_owner is not completion', async context => {
  const { call, request, until } = await crmFixture(context, staffStore(), 't', 200);
  await call('board_status', {});
  const staff = (await request('GET', '/api/comments?cardId=t-staff')).body.comments[0];
  await call('board_reply', { card: 'staff', to: [staff.sid], text: 'Twelve leads.', state: 'inflight' });
  const delivered = await until(card => card.crm.state === 'done');
  assert.equal(delivered.status, 'inflight');
  await call('board_reply', {
    card: 'staff',
    to: [staff.sid],
    text: 'A decision is needed.',
    follow_up: true,
    kind: 'needs_owner',
  });
  const working = await until(card => card.crm.state === 'working');
  assert.notEqual(working.status, 'done');
  assert.equal(
    working.log.some(entry => entry.event === 'task_finished'),
    false,
  );
});

test('CRM acceptance closes through the prompt owner and supersedes undelivered Send', async context => {
  const { call, request, until } = await crmFixture(context, staffStore(), 't', 200);
  const offered = await call('board_prompt', {
    card: 'staff',
    to: 'firstmate',
    purpose: 'Continue.',
    prompt: 'Undelivered instruction.',
  });
  assert.equal(offered.ok, true, offered.reason);
  const comments = async () => (await request('GET', '/api/comments?cardId=t-staff')).body.comments;
  const prompt = (await comments()).find(message => message.prompt);
  const staff = (await comments()).find(message => message.kind === 'staff');
  assert.equal(
    (await request('POST', '/api/comments/' + prompt.id + '/decide', { choice: 'send' }, 'CAPTAIN')).status,
    200,
  );
  assert.equal((await call('board_reply', { card: 'staff', to: [staff.sid], text: 'Twelve leads.' })).ok, true);
  assert.equal((await until(card => card.crm.state === 'done')).status, 'done');
  assert.equal((await comments()).find(message => message.id === prompt.id).prompt.state, 'superseded');
});

test('CRM duplicate acceptance is a receipt, not a failed answer', async context => {
  const { call, request, until } = await crmFixture(context, staffStore(), 't', 409);
  await call('board_status', {});
  const staff = (await request('GET', '/api/comments?cardId=t-staff')).body.comments[0];
  await call('board_reply', { card: 'staff', to: [staff.sid], text: 'Twelve leads.' });
  const card = await until(candidate => candidate.crm.state === 'done');
  assert.equal(card.status, 'done');
  assert.equal(card.crm.failure, undefined);
});

for (const board of ['t', 'lines']) {
  test('CRM ' + board + ': answer stays open until delivery is accepted', async context => {
    const fixture = await crmFixture(context, staffStore(board), board);
    const { request, call, remote, read, until } = fixture;
    if (board === 't') {
      await call('board_status', {});
      const staff = (await request('GET', '/api/comments?cardId=t-staff')).body.comments[0];
      const result = await call('board_reply', { card: 'staff', to: [staff.sid], text: 'Twelve leads.' });
      assert.equal(result.ok, true);
      assert.doesNotMatch(result.summary, /is closed/);
    } else {
      await request(
        'POST',
        '/api/boards/lines/events',
        {
          rows: [{ label: 'REPLY', task: 'staff', text: 'Twelve leads.' }],
        },
        'LEGACY',
      );
    }
    assert.notEqual((await read()).status, 'done', 'a reply is not a delivery receipt');
    const failed = await until(card => card.crm.state === 'failed');
    assert.equal(failed.crm.failure.retrying, true);
    const boardState = (await request('GET', '/api/state', null, 'CAPTAIN')).body.boards[board];
    const retryNote = boardState.notes.find(note => /Retrying automatically/.test(note.text));
    assert.ok(retryNote);
    assert.match(retryNote.text, /No action is needed/);
    assert.doesNotMatch(retryNote.text, /Use .*board_reply|Use a REPLY/);
    assert.equal(
      failed.log.some(entry => entry.event === 'task_finished'),
      false,
    );
    if (board === 't') {
      const closed = await call('board_close', { card: 'staff', outcome: 'Answered.' });
      assert.equal(closed.ok, false, 'manual close cannot bypass delivery');
    }
    for (const method of ['PUT', 'PATCH']) {
      const closed = await request(method, '/api/cards/' + board + '-staff', { status: 'done' }, 'LEGACY');
      assert.equal(closed.status, 409, 'legacy writes preserve the pending CRM question');
    }
    remote.status = 200;
    const accepted = await until(card => card.crm.state === 'done');
    assert.equal(accepted.status, 'done');
    assert.equal(accepted.log.filter(entry => entry.event === 'task_finished').length, 1);
    assert.equal(new Set(remote.replies.map(reply => reply.id)).size, 1, 'retry keeps its id');
    assert.deepEqual(Object.keys(remote.replies[0]).sort(), ['answeredAt', 'by', 'id', 'kind', 'text']);
  });
}

test('CRM superseded give-up does not tell the operator to send a duplicate answer', async context => {
  const initial = staffStore('t', { crm: { id: '7', state: 'sending', deliveryId: 'latest' } });
  initial.comments['staff-message'].handled = true;
  initial.crm = {
    delivered: { 7: 't-staff' },
    outbox: ['old', 'latest'].map(id => ({
      id,
      kind: 'reply',
      qid: '7',
      cid: 't-staff',
      attempts: id === 'old' ? 59 : 0,
      body: { id, kind: 'answer', text: 'Twelve leads.', by: 'operator' },
    })),
  };
  const { request, until } = await crmFixture(context, initial);
  const card = await until(candidate => candidate.crm.state === 'failed');
  assert.equal(card.crm.deliveryId, 'latest');
  assert.equal(card.crm.failure.retrying, true);
  const board = (await request('GET', '/api/state', null, 'CAPTAIN')).body.boards.t;
  assert.equal(
    board.notes.some(note => /Retries stopped/.test(note.text)),
    false,
  );
});

for (const [status, attempts, title] of [
  [500, 59, 'give-up after 60 tries'],
  [422, 2, 'permanent refusal'],
]) {
  test('CRM ' + title + ' remains visible and counted', async context => {
    const initial = staffStore('t', { status: 'done', closedAt: '2026-11-09T12:00:00Z' });
    initial.comments['staff-message'].handled = true;
    initial.crm = {
      delivered: { 7: 't-staff' },
      outbox: [
        {
          id: 'saved-answer',
          kind: 'reply',
          qid: '7',
          cid: 't-staff',
          attempts,
          body: { id: 'saved-answer', kind: 'answer', text: 'Twelve leads.', by: 'operator' },
        },
      ],
    };
    const { request, remote, until } = await crmFixture(context, initial, 't', status);
    for (let attempt = 0; attempt < 250 && !remote.replies.length; attempt++) await wait(20);
    await wait(100);
    const report = (await request('GET', '/api/boards/t/conduct')).body;
    assert.equal(report.crm.failed, 1, 'conduct must not report a clean delivery lane');
    assert.equal(report.crm.answered24h, 0);
    assert.equal(report.crm.pending, 0);
    assert.equal(remote.replies.length, 1, 'the saved retry budget is exhausted exactly once');
    const card = await until(candidate => candidate.crm.state === 'failed');
    assert.notEqual(card.status, 'done');
    assert.equal(card.crm.failure.retrying, false);
    assert.match(card.log.at(-1).text, /not reached|not seen|not delivered/i);
    const board = (await request('GET', '/api/state', null, 'CAPTAIN')).body.boards.t;
    assert.ok(board.notes.some(note => note.to === 'operator' && /CRM/.test(note.text)));
    assert.ok(board.notes.some(note => note.text.includes('Use board_reply(follow_up: true)')));
  });
}
