'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { cardFixture } = require('./card-fixture');

async function promptFixture(context) {
  const fixture = await cardFixture(context);
  const snapshot = async () => (await fixture.request('GET', '/api/state', null, 'CAPTAIN')).body;
  const comments = async () => (await fixture.request('GET', '/api/comments?board=t', null, 'CAPTAIN')).body.comments;
  const offer = async (card, text, extra = {}) => {
    assert.equal(
      (await fixture.call('board_prompt', { card, to: 'firstmate', purpose: 'Continue work.', prompt: text, ...extra }))
        .ok,
      true,
    );
    return (await comments()).find(comment => comment.prompt?.text === text);
  };
  const decide = (prompt, choice) =>
    fixture.request('POST', '/api/comments/' + prompt.id + '/decide', { choice }, 'CAPTAIN');
  return { ...fixture, snapshot, comments, offer, decide };
}

test('declined prompt refuses yolo, standing authority and earlier words', async context => {
  const fixture = await promptFixture(context);
  await fixture.open('declined');
  await fixture.request('POST', '/api/comments', { cardId: 't-declined', text: 'Please send it.' }, 'CAPTAIN');
  const word = (await fixture.comments()).find(comment => comment.text === 'Please send it.');
  const prompt = await fixture.offer('declined', 'Do not send this declined prompt.');
  assert.equal((await fixture.decide(prompt, 'other')).status, 200);
  await fixture.request('POST', '/api/comments', { board: 't', text: '/yolo on' }, 'CAPTAIN');
  const authority = (await fixture.call('board_authorities', {})).summary.split(' ')[0];
  for (const basis of [{ under_authority: authority }, { on_word: word.sid }]) {
    const result = await fixture.call('board_relay', { source: prompt.sid, ...basis });
    assert.equal(result.ok, false, 'No stays final under every approval basis');
    assert.match(result.reason, /declined|another way/i);
  }
  assert.equal((await fixture.decide(prompt, 'send')).status, 409);
  const after = (await fixture.comments()).find(comment => comment.id === prompt.id);
  assert.ok(!after.prompt.relayedAt);
});

test('yolo approval is recorded before ticket delivery, not confused with the receipt', async context => {
  const fixture = await promptFixture(context);
  await fixture.open('yolo-delivery');
  const prompt = await fixture.offer('yolo-delivery', 'Approved under yolo.');
  await fixture.request('POST', '/api/comments', { board: 't', text: '/yolo on' }, 'CAPTAIN');
  const authority = (await fixture.call('board_authorities', {})).summary.split(' ')[0];
  const issued = await fixture.call('board_relay', { source: prompt.sid, under_authority: authority });
  assert.equal(issued.ok, true);
  let stored = (await fixture.comments()).find(entry => entry.id === prompt.id).prompt;
  assert.equal(stored.state, 'approved');
  assert.equal(stored.approval.via, 'yolo');
  assert.equal(stored.relayedAt, undefined);
  assert.equal((await fixture.call('_relay_result', { ticket: issued.ticket.id, delivered: true })).ok, true);
  stored = (await fixture.comments()).find(entry => entry.id === prompt.id).prompt;
  assert.equal(stored.state, 'relayed');
  assert.ok(stored.relayedAt);
});

test('replaced prompt refuses stale Send without settling the replacement ask', async context => {
  const fixture = await promptFixture(context);
  await fixture.open('replaced');
  const old = await fixture.offer('replaced', 'Old prompt.');
  const ask = (await fixture.snapshot()).cards['t-replaced'].decisions.find(entry => !entry.resolvedAt);
  await fixture.offer('replaced', 'Replacement prompt.', { replaces: ask.sid });
  const before = await fixture.snapshot();
  const messages = await fixture.comments();
  const response = await fixture.decide(old, 'send');
  assert.equal(response.status, 409, 'the old Send is refused');
  assert.match(response.body.error, /superseded|replaced/i);
  assert.deepEqual((await fixture.snapshot()).cards['t-replaced'], before.cards['t-replaced']);
  assert.deepEqual(await fixture.comments(), messages, 'no instruction or prompt changes');
  assert.equal((await fixture.call('board_relay', { source: old.sid })).ok, false);
});

test('withdrawn prompt on a closed card refuses Send without changing anything', async context => {
  const fixture = await promptFixture(context);
  await fixture.open('withdrawn');
  const prompt = await fixture.offer('withdrawn', 'Withdrawn prompt.');
  const ask = (await fixture.snapshot()).cards['t-withdrawn'].decisions.find(entry => !entry.resolvedAt);
  assert.equal((await fixture.call('board_withdraw', { ask_id: ask.sid, reason: 'No longer needed.' })).ok, true);
  assert.equal((await fixture.call('board_close', { card: 'withdrawn', outcome: 'Dropped.' })).ok, true);
  const before = await fixture.snapshot();
  const messages = await fixture.comments();
  const response = await fixture.decide(prompt, 'send');
  assert.equal(response.status, 409);
  assert.match(response.body.error, /superseded|withdrawn|closed/i);
  assert.deepEqual((await fixture.snapshot()).cards['t-withdrawn'], before.cards['t-withdrawn']);
  assert.deepEqual(await fixture.comments(), messages);
});

test('Send approves exact words and only the matching delivery receipt marks them relayed', async context => {
  const fixture = await promptFixture(context);
  await fixture.open('delivery');
  const prompt = await fixture.offer('delivery', 'Send these exact words.');
  const approval = await fixture.decide(prompt, 'send');
  assert.equal(approval.body.comment.prompt.state, 'approved');
  assert.equal(approval.body.comment.prompt.approval.via, 'send');
  assert.ok(!approval.body.comment.prompt.relayedAt);
  let issued = await fixture.call('board_relay', { source: prompt.sid });
  assert.equal(issued.ok, true);
  assert.equal(issued.ticket.text, 'Send these exact words.');
  assert.equal((await fixture.call('_relay_result', { ticket: issued.ticket.id, delivered: false })).ok, true);
  assert.equal((await fixture.comments()).find(entry => entry.id === prompt.id).prompt.state, 'approved');
  issued = await fixture.call('board_relay', { source: prompt.sid });
  assert.equal((await fixture.call('_relay_result', { ticket: issued.ticket.id, delivered: true })).ok, true);
  const after = (await fixture.comments()).find(entry => entry.id === prompt.id).prompt;
  assert.equal(after.state, 'relayed');
  assert.ok(after.relayedAt);
});

test('closing an approved prompt supersedes it and refuses its outstanding ticket receipt', async context => {
  const fixture = await promptFixture(context);
  await fixture.open('closed-ticket');
  const prompt = await fixture.offer('closed-ticket', 'Pending delivery.');
  await fixture.decide(prompt, 'send');
  const issued = await fixture.call('board_relay', { source: prompt.sid });
  assert.equal((await fixture.call('board_close', { card: 'closed-ticket', outcome: 'Cancelled.' })).ok, true);
  const messages = await fixture.comments();
  assert.equal(messages.find(entry => entry.id === prompt.id).prompt.state, 'superseded');
  const receipt = await fixture.call('_relay_result', { ticket: issued.ticket.id, delivered: true });
  assert.equal(receipt.ok, false);
  assert.match(receipt.reason, /superseded/);
  assert.deepEqual(await fixture.comments(), messages);
});

test('line explicit finish supersedes an approved undelivered prompt', async context => {
  const fixture = await promptFixture(context);
  const line = async rows =>
    (await fixture.request('POST', '/api/boards/lines/events', { rows }, 'LEGACY')).body.results[0];
  await line([{ label: 'TASK_CREATED', task: 'line-close', title: 'Line_close', text: 'Work.' }]);
  await line([{ label: 'PROMPT', task: 'line-close', to: 'firstmate', text: 'Undelivered line prompt.' }]);
  const messages = (await fixture.request('GET', '/api/comments?cardId=lines-line-close', null, 'CAPTAIN')).body
    .comments;
  const prompt = messages.find(message => message.prompt);
  assert.equal((await fixture.decide(prompt, 'send')).status, 200);
  const finished = await line([{ label: 'TASK_FINISHED', task: 'line-close', text: 'Cancelled before delivery.' }]);
  assert.equal(finished.ok, true, finished.reason);
  const state = await fixture.snapshot();
  assert.equal(state.cards['lines-line-close'].status, 'done');
  const after = (await fixture.request('GET', '/api/comments?cardId=lines-line-close', null, 'CAPTAIN')).body.comments;
  const stored = after.find(message => message.id === prompt.id).prompt;
  assert.equal(stored.state, 'superseded');
  assert.equal(stored.relayedAt, undefined);
});

test('line mode shares final refusal and approved delivery', async context => {
  const fixture = await promptFixture(context);
  const line = async rows =>
    (await fixture.request('POST', '/api/boards/lines/events', { rows }, 'LEGACY')).body.results[0];
  for (const slug of ['line-no', 'line-send']) {
    await line([{ label: 'TASK_CREATED', task: slug, title: 'Line_prompt', text: 'Work.' }]);
    await line([{ label: 'PROMPT', task: slug, to: 'firstmate', text: 'Continue ' + slug }]);
    const messages = (await fixture.request('GET', '/api/comments?cardId=lines-' + slug, null, 'CAPTAIN')).body
      .comments;
    const prompt = messages.find(entry => entry.prompt);
    await fixture.decide(prompt, slug === 'line-no' ? 'other' : 'send');
    const result = await line([
      {
        label: 'RELAYED',
        task: slug,
        text: 'Sent to firstmate under your standing authority.',
      },
    ]);
    assert.equal(result.ok, slug === 'line-send');
    const after = (await fixture.request('GET', '/api/comments?cardId=lines-' + slug, null, 'CAPTAIN')).body.comments;
    const stored = after.find(entry => entry.id === prompt.id).prompt;
    assert.equal(stored.state, slug === 'line-no' ? 'declined' : 'relayed');
    assert.equal(!!stored.relayedAt, slug === 'line-send');
  }
});
