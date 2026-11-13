'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { cardFixture } = require('./card-fixture');

async function fixture(context, initial) {
  const board = await cardFixture(context, initial);
  const comments = async (query = 'board=t') =>
    (await board.request('GET', '/api/comments?' + query, null, 'CAPTAIN')).body.comments;
  const snapshot = async () => (await board.request('GET', '/api/state', null, 'CAPTAIN')).body;
  const line = async rows =>
    (await board.request('POST', '/api/boards/lines/events', { rows }, 'LEGACY')).body.results[0];
  const decide = (prompt, choice) =>
    board.request('POST', '/api/comments/' + prompt.id + '/decide', { choice }, 'CAPTAIN');
  const offer = async (card, text, extra = {}) => {
    const result = await board.call('board_prompt', {
      card,
      to: 'firstmate',
      purpose: 'Continue.',
      prompt: text,
      ...extra,
    });
    assert.equal(result.ok, true, result.reason);
    return (await comments()).find(message => message.prompt?.text === text);
  };
  const yolo = async enabled => {
    await board.request('POST', '/api/comments', { board: 't', text: '/yolo ' + (enabled ? 'on' : 'off') }, 'CAPTAIN');
    return (await board.call('board_authorities', {})).summary.split(' ')[0];
  };
  const receipt = issued => board.call('_relay_result', { ticket: issued.ticket.id, delivered: true });
  return { ...board, comments, snapshot, line, decide, offer, yolo, receipt };
}

for (const decline of [false, true])
  test('ordinary line relay preserves another answer after ' + (decline ? 'No' : 'an offer'), async context => {
    const board = await fixture(context);
    await board.line([{ label: 'TASK_CREATED', task: 'answer', text: 'Work.' }]);
    await board.line([{ label: 'PROMPT', task: 'answer', to: 'firstmate', text: 'Suggested words.' }]);
    const prompt = (await board.comments('cardId=lines-answer')).find(message => message.prompt);
    if (decline) assert.equal((await board.decide(prompt, 'other')).status, 200);
    await board.request(
      'POST',
      '/api/comments',
      { cardId: 'lines-answer', text: 'Tell firstmate to stop.' },
      'CAPTAIN',
    );
    const result = await board.line([{ label: 'RELAYED', task: 'answer', text: 'Sent your words to firstmate.' }]);
    assert.equal(result.ok, true, result.reason);
    const messages = await board.comments('cardId=lines-answer');
    assert.equal(messages.filter(message => message.label === 'RELAYED').length, 1);
    const after = messages.find(message => message.id === prompt.id).prompt;
    assert.equal(after.state, decline ? 'declined' : 'superseded');
    assert.equal(after.relayedAt, undefined);
    assert.equal((await board.snapshot()).cards['lines-answer'].status, 'inflight');
  });

for (const otherWords of [false, true])
  test('ordinary line receipt credits only its latest captain source: ' + otherWords, async context => {
    const board = await fixture(context);
    await board.line([{ label: 'TASK_CREATED', task: 'line-source', text: 'Work.' }]);
    await board.line([{ label: 'PROMPT', task: 'line-source', to: 'firstmate', text: 'Deploy the update.' }]);
    const prompt = (await board.comments('cardId=lines-line-source')).find(message => message.prompt);
    assert.equal((await board.decide(prompt, 'send')).status, 200);
    const approved = (await board.comments('cardId=lines-line-source')).find(message => message.id === prompt.id);
    if (otherWords)
      await board.request(
        'POST',
        '/api/comments',
        { cardId: 'lines-line-source', text: 'Hold off on deployment.' },
        'CAPTAIN',
      );
    const result = await board.line([
      {
        label: 'RELAYED',
        task: 'line-source',
        text: otherWords ? 'Sent your hold-off message to firstmate.' : 'Sent your prompt to firstmate.',
      },
    ]);
    assert.equal(result.ok, true, result.reason);
    const messages = await board.comments('cardId=lines-line-source');
    const after = messages.find(message => message.id === prompt.id).prompt;
    if (otherWords) assert.deepEqual(after, approved.prompt, 'an unrelated approval stays untouched');
    else {
      assert.equal(after.state, 'relayed');
      assert.ok(after.relayedAt);
    }
    assert.equal(messages.filter(message => message.label === 'RELAYED').length, 1);
  });

test('repeat refusals give recovery that does not require the prompt Send', async context => {
  const board = await fixture(context);
  await board.open('repeat-refusal');
  await board.request('POST', '/api/comments', { cardId: 't-repeat-refusal', text: 'Send it now.' }, 'CAPTAIN');
  const word = (await board.comments()).find(message => message.text === 'Send it now.');
  const prompt = await board.offer('repeat-refusal', 'Repeat these words.');
  const authority = await board.yolo(true);
  const first = await board.call('board_relay', { source: prompt.sid, under_authority: authority });
  assert.equal(first.ok, true, first.reason);
  assert.equal((await board.receipt(first)).ok, true);
  await board.yolo(false);
  const before = await board.comments();
  const revoked = await board.call('board_relay', { source: prompt.sid, under_authority: authority, again: true });
  assert.equal(revoked.ok, false);
  assert.match(revoked.reason, /has ended/);
  assert.match(revoked.reason, /fresh words.*on_word.*replacement prompt/);
  assert.deepEqual(await board.comments(), before);
  const initial = await board.snapshot();
  initial.comments = Object.fromEntries(before.map(message => [message.id, message]));
  initial.comments[word.id].t = new Date(Date.now() - 3 * 3600000).toISOString();
  const reboot = await fixture(context, initial);
  const expired = await reboot.call('board_relay', { source: prompt.sid, on_word: word.sid, again: true });
  assert.equal(expired.ok, false);
  assert.match(expired.reason, /over two hours old/);
  assert.match(expired.reason, /fresh words.*on_word.*replacement prompt/);
});

test('failed yolo ticket requires its still-active authority on retry', async context => {
  const board = await fixture(context);
  await board.open('revoked');
  const prompt = await board.offer('revoked', 'Authority words.');
  const authority = await board.yolo(true);
  const first = await board.call('board_relay', { source: prompt.sid, under_authority: authority });
  assert.equal(first.ok, true);
  await board.call('_relay_result', { ticket: first.ticket.id, delivered: false });
  const retry = await board.call('board_relay', { source: prompt.sid, under_authority: authority });
  assert.equal(retry.ok, true);
  await board.call('_relay_result', { ticket: retry.ticket.id, delivered: false });
  await board.yolo(false);
  const before = await board.comments();
  const bare = await board.call('board_relay', { source: prompt.sid });
  assert.equal(bare.ok, false);
  assert.match(bare.reason, /fresh words.*on_word.*replacement prompt/);
  const revoked = await board.call('board_relay', { source: prompt.sid, under_authority: authority });
  assert.equal(revoked.ok, false);
  assert.match(revoked.reason, /has ended/);
  assert.match(revoked.reason, /fresh words.*on_word.*replacement prompt/);
  assert.deepEqual(await board.comments(), before);
  const ask = (await board.snapshot()).cards['t-revoked'].decisions.find(decision => !decision.resolvedAt);
  const replacement = await board.offer('revoked', 'Replacement after authority ended.', { replaces: ask.sid });
  assert.equal((await board.decide(replacement, 'send')).status, 200);
  const recovered = await board.call('board_relay', { source: replacement.sid });
  assert.equal(recovered.ok, true, recovered.reason);
  assert.equal((await board.receipt(recovered)).ok, true);
});

test('failed on-word ticket rechecks later words and the two-hour limit', async context => {
  const board = await fixture(context);
  await board.open('word-retry');
  await board.request('POST', '/api/comments', { cardId: 't-word-retry', text: 'Send it now.' }, 'CAPTAIN');
  const word = (await board.comments()).find(message => message.text === 'Send it now.');
  const prompt = await board.offer('word-retry', 'Word-authorised text.');
  const first = await board.call('board_relay', { source: prompt.sid, on_word: word.sid });
  assert.equal(first.ok, true);
  await board.call('_relay_result', { ticket: first.ticket.id, delivered: false });
  await board.request(
    'POST',
    '/api/comments',
    { cardId: 't-word-retry', text: 'Actually do not send it, wait.' },
    'CAPTAIN',
  );
  const bare = await board.call('board_relay', { source: prompt.sid });
  assert.equal(bare.ok, false);
  const overtaken = await board.call('board_relay', { source: prompt.sid, on_word: word.sid });
  assert.equal(overtaken.ok, false);
  assert.match(overtaken.reason, /wrote after/);
  const old = structuredClone(word);
  old.t = new Date(Date.now() - 3 * 3600000).toISOString();
  const initial = await board.snapshot();
  initial.comments = Object.fromEntries((await board.comments()).map(message => [message.id, message]));
  initial.comments[word.id] = old;
  const reboot = await fixture(context, initial);
  const expired = await reboot.call('board_relay', { source: prompt.sid, on_word: word.sid });
  assert.equal(expired.ok, false);
  assert.match(expired.reason, /over two hours old/);
  assert.match(expired.reason, /fresh words.*on_word.*replacement prompt/);
});

for (const via of ['on-word', 'yolo'])
  test('failed delivery refreshes checked approval provenance: ' + via, async context => {
    const board = await fixture(context);
    await board.open('new-basis');
    await board.request('POST', '/api/comments', { cardId: 't-new-basis', text: 'Send it now.' }, 'CAPTAIN');
    const word = (await board.comments()).find(message => message.text === 'Send it now.');
    const prompt = await board.offer('new-basis', 'Freshly authorised text.');
    const authority = await board.yolo(true);
    const firstBasis = via === 'on-word' ? { under_authority: authority } : { on_word: word.sid };
    const first = await board.call('board_relay', { source: prompt.sid, ...firstBasis });
    assert.equal(first.ok, true, first.reason);
    await board.call('_relay_result', { ticket: first.ticket.id, delivered: false });
    if (via === 'on-word') {
      await board.yolo(false);
      await board.request('POST', '/api/comments', { cardId: 't-new-basis', text: 'Send it now please.' }, 'CAPTAIN');
    }
    const freshWord = (await board.comments()).find(message => message.text === 'Send it now please.') || word;
    const basis = via === 'on-word' ? { on_word: freshWord.sid, seen: [word.sid] } : { under_authority: authority };
    const before = (await board.snapshot()).cards['t-new-basis'];
    const retry = await board.call('board_relay', { source: prompt.sid, ...basis });
    assert.equal(retry.ok, true, retry.reason);
    const approved = (await board.comments()).find(message => message.id === prompt.id).prompt;
    assert.equal(approved.state, 'approved');
    assert.equal(approved.approval.via, via);
    assert.equal(approved.decision, via === 'on-word' ? 'on-word' : 'delegated');
    assert.equal(approved.decidedAt, approved.approval.at);
    assert.equal(approved.approval.authority, via === 'yolo' ? authority : undefined);
    assert.equal(approved.approval.onWord, via === 'on-word' ? freshWord.id : undefined);
    assert.equal(approved.onWord, via === 'on-word' ? freshWord.id : undefined);
    assert.deepEqual((await board.snapshot()).cards['t-new-basis'], before);
    assert.equal((await board.receipt(retry)).ok, true);
    const delivered = (await board.comments()).find(message => message.id === prompt.id).prompt;
    assert.equal(delivered.state, 'relayed');
    assert.deepEqual(delivered.approval, approved.approval);
  });

for (const via of ['send', 'yolo', 'on-word'])
  test('explicit repeat preserves approval and newer asks: ' + via, async context => {
    const board = await fixture(context);
    await board.open('repeat');
    await board.request('POST', '/api/comments', { cardId: 't-repeat', text: 'Send these words.' }, 'CAPTAIN');
    const word = (await board.comments()).find(message => message.text === 'Send these words.');
    const prompt = await board.offer('repeat', 'Repeatable text.');
    const basis =
      via === 'yolo' ? { under_authority: await board.yolo(true) } : via === 'on-word' ? { on_word: word.sid } : {};
    if (via === 'send') await board.decide(prompt, 'send');
    const first = await board.call('board_relay', { source: prompt.sid, ...basis });
    assert.equal(first.ok, true, first.reason);
    assert.equal((await board.receipt(first)).ok, true);
    const approved = (await board.comments()).find(message => message.id === prompt.id).prompt;
    const ask = await board.ask('repeat');
    const cardBefore = (await board.snapshot()).cards['t-repeat'];
    const repeated = await board.call('board_relay', { source: prompt.sid, again: true, ...basis });
    assert.equal(repeated.ok, true, repeated.reason);
    const pending = (await board.comments()).find(message => message.id === prompt.id).prompt;
    assert.deepEqual(pending, approved, 'issuing a repeat does not approve again');
    assert.deepEqual((await board.snapshot()).cards['t-repeat'], cardBefore);
    const receipt = await board.receipt(repeated);
    assert.equal(receipt.ok, true, receipt.reason);
    const after = (await board.comments()).find(message => message.id === prompt.id).prompt;
    assert.equal(after.state, 'relayed');
    assert.deepEqual(after.approval, approved.approval);
    assert.equal(after.decidedAt, approved.decidedAt);
    assert.ok(after.relayedAt);
    const cardAfter = (await board.snapshot()).cards['t-repeat'];
    assert.equal(cardAfter.decisions.find(decision => decision.id === ask.id).resolvedAt, null);
    assert.equal(cardAfter.status, 'waiting');
  });

test('yolo receipt leaves the follow-through ACTION ask for the captain', async context => {
  const board = await fixture(context);
  await board.open('follow-through');
  const ask = await board.ask('follow-through');
  const prompt = await board.offer('follow-through', 'Follow-through text.', { for_ask: ask.sid });
  const issued = await board.call('board_relay', { source: prompt.sid, under_authority: await board.yolo(true) });
  assert.equal(issued.ok, true);
  assert.equal((await board.receipt(issued)).ok, true);
  const card = (await board.snapshot()).cards['t-follow-through'];
  assert.equal(card.decisions.find(decision => decision.id === ask.id).resolvedAt, null);
  assert.equal(card.status, 'waiting');
});
