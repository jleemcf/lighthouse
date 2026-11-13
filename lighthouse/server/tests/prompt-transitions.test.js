'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const prompts = require('../prompt-transitions');

function fixture() {
  const message = { id: 'prompt', cardId: 'card', t: 'offered', prompt: prompts.offer('firstmate', 'Exact words.') };
  const ask = { id: 'ask', commentId: message.id, resolvedAt: null };
  const card = { id: 'card', status: 'waiting', decisions: [ask] };
  const store = { cards: { card }, comments: { prompt: message } };
  return { message, ask, card, store };
}

for (const via of ['send', 'yolo', 'on-word', 'authority'])
  test('approval provenance and delivered timestamp: ' + via, () => {
    const { message, card, store } = fixture();
    assert.equal(prompts.relay(store, message, 'too early').ok, false);
    assert.equal(prompts.approve(store, message, { via, at: 'approved', by: 'captain' }).ok, true);
    assert.equal(message.prompt.state, 'approved');
    assert.equal(message.prompt.approval.via, via);
    assert.equal(message.prompt.relayedAt, undefined);
    assert.equal(prompts.relay(store, message, 'delivered').ok, true);
    assert.equal(message.prompt.state, 'relayed');
    assert.equal(message.prompt.relayedAt, 'delivered');
    assert.equal(card.status, 'inflight');
  });

for (const ending of ['declined', 'withdrawn', 'replaced', 'settled', 'closed'])
  test('final prompts refuse every approval and receipt without mutation: ' + ending, () => {
    const { message, ask, card, store } = fixture();
    if (ending === 'declined') prompts.decline(store, message, 'ended', 'captain');
    else {
      prompts.settle(store, card, [ask], { resolvedAt: 'ended', [ending]: true });
      if (ending === 'closed') prompts.close(store, card, 'ended');
    }
    const before = structuredClone(store);
    for (const via of ['send', 'yolo', 'on-word', 'authority'])
      assert.equal(prompts.approve(store, message, { via, at: 'later' }).ok, false);
    assert.equal(prompts.decline(store, message, 'later', 'captain').ok, false);
    assert.equal(prompts.relay(store, message, 'later').ok, false);
    assert.deepEqual(store, before);
  });

test('settling an ask supersedes its follow-through prompt without disturbing another ask', () => {
  const { message, ask, card, store } = fixture();
  delete ask.commentId;
  ask.promptId = message.id;
  const other = { id: 'other', resolvedAt: null };
  card.decisions.push(other);
  prompts.settle(store, card, [ask], { resolvedAt: 'withdrawn', resolvedBy: 'operator' });
  assert.equal(message.prompt.state, 'superseded');
  assert.equal(other.resolvedAt, null);
  assert.equal(card.status, 'waiting');
});

test('legacy ask removal invalidates delegated approval before its receipt', () => {
  const { message, card, store } = fixture();
  prompts.approve(store, message, { via: 'yolo', at: 'approved', by: 'operator' });
  card.decisions = [];
  prompts.load(store);
  assert.equal(message.prompt.state, 'approved');
  const before = structuredClone(store);
  assert.equal(prompts.relay(store, message, 'later').ok, false);
  assert.deepEqual(store, before);
});

test('legacy records map on read without a schema bump and an old No beats a stray delivery timestamp', () => {
  const { card, store } = fixture();
  store.schema = 1;
  const decisions = [null, 'send', 'on-word', 'delegated', 'other', 'replaced'];
  const expected = ['offered', 'approved', 'relayed', 'relayed', 'declined', 'superseded'];
  for (const [index, decision] of decisions.entries()) {
    const id = 'legacy-' + index;
    store.comments[id] = { id, cardId: card.id, prompt: { decision, text: 'Legacy.' } };
    card.decisions.push({ id: 'ask-' + index, commentId: id, resolvedAt: null });
  }
  store.comments['legacy-4'].prompt.relayedAt = 'contradictory old evidence';
  prompts.load(store);
  assert.equal(store.schema, 1);
  for (const [index, state] of expected.entries()) assert.equal(store.comments['legacy-' + index].prompt.state, state);
  assert.equal(store.comments['legacy-2'].prompt.approval.via, 'on-word');
});

test('repeated load preserves old decisions and never invents a superseded time', () => {
  const { message, card, store } = fixture();
  const decisions = ['send', 'delegated', 'on-word', null];
  card.status = 'done';
  for (const [index, decision] of decisions.entries())
    store.comments['old-' + index] = {
      id: 'old-' + index,
      cardId: card.id,
      t: 'creation-time',
      prompt: { text: 'Old words.', decision },
    };
  delete store.comments[message.id];
  prompts.load(store);
  const once = structuredClone(store);
  prompts.load(store);
  assert.deepEqual(store, once);
  for (const [index, decision] of decisions.entries()) {
    assert.equal(store.comments['old-' + index].prompt.decision, decision);
    assert.equal(store.comments['old-' + index].prompt.decidedAt, undefined);
  }
  assert.equal(store.comments['old-0'].prompt.state, 'approved');
  assert.equal(store.comments['old-1'].prompt.state, 'relayed');
  assert.equal(store.comments['old-2'].prompt.state, 'relayed');
  assert.equal(store.comments['old-3'].prompt.state, 'superseded');
});

test('refresh changes only undelivered non-Send approval provenance', () => {
  const { message, store } = fixture();
  prompts.approve(store, message, { via: 'on-word', at: 'first', by: 'operator', onWord: 'old-word' });
  const before = structuredClone(store);
  const approval = { via: 'authority', at: 'fresh', by: 'operator', authority: 'current-authority' };
  assert.equal(prompts.refreshApproval(store, message, approval).ok, true);
  Object.assign(before.comments.prompt.prompt, { approval, decidedAt: 'fresh', decision: 'delegated' });
  delete before.comments.prompt.prompt.onWord;
  assert.deepEqual(store, before);
});

for (const state of ['offered', 'send', 'relayed', 'declined', 'superseded', 'legacy-send'])
  test('refresh refuses without mutations: ' + state, () => {
    const { message, store } = fixture();
    if (state !== 'offered') prompts.approve(store, message, { via: 'send', at: 'first', by: 'captain' });
    if (['relayed', 'declined', 'superseded'].includes(state)) message.prompt.state = state;
    if (state === 'legacy-send') delete message.prompt.approval;
    const before = structuredClone(store);
    assert.equal(prompts.refreshApproval(store, message, { via: 'yolo', at: 'changed', by: 'operator' }).ok, false);
    assert.deepEqual(store, before);
  });

test('a relay basis refresh cannot impersonate the captain Send', () => {
  const { message, store } = fixture();
  prompts.approve(store, message, { via: 'yolo', at: 'first', by: 'operator' });
  const before = structuredClone(store);
  assert.equal(prompts.refreshApproval(store, message, { via: 'send', at: 'changed', by: 'captain' }).ok, false);
  assert.deepEqual(store, before);
});

test('repeat receipt updates only delivery time and requires an explicit repeat ticket', () => {
  const { message, card, store } = fixture();
  prompts.approve(store, message, { via: 'yolo', at: 'approved', by: 'operator' });
  prompts.relay(store, message, 'first delivery');
  const newer = { id: 'newer', resolvedAt: null };
  card.decisions.push(newer);
  card.status = 'waiting';
  const before = structuredClone(store);
  assert.equal(prompts.relay(store, message, 'unrequested repeat').ok, false);
  assert.deepEqual(store, before);
  assert.equal(prompts.relay(store, message, 'second delivery', true).ok, true);
  before.comments.prompt.prompt.relayedAt = 'second delivery';
  assert.deepEqual(store, before);
});
