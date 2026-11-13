'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const lifecycle = require('../../server/card-transitions');

test('ClosedCardsHaveNoOpenAsks: generated legal and illegal transition sequences', context => {
  const states = new Map();
  const initial = lifecycle.open({ status: 'inflight' }).card;
  const key = card => JSON.stringify(card);
  let frontier = [initial];
  let attempted = 0;
  const actions = [
    card => lifecycle.move(card, 'held'),
    card => lifecycle.move(card, 'inflight'),
    card => lifecycle.reopen(card),
    card => lifecycle.close(card, 'time'),
    card => lifecycle.legacyWrite(card, { status: 'done' }, false),
    card => lifecycle.legacyWrite(card, { status: 'done' }, true),
    card => lifecycle.legacyWrite(card, { status: 'done', decisions: [] }, true),
    card => lifecycle.legacyWrite(card, { needsAction: true }, false),
    card => lifecycle.ask(card, { id: 'one', resolvedAt: null }),
    card => lifecycle.ask(card, { id: 'two', resolvedAt: null }, 'held'),
    card => lifecycle.ask(card, { id: 'illegal', resolvedAt: null }, 'done'),
    card => {
      lifecycle.settle(card, lifecycle.openAsks(card).slice(0, 1), { resolvedAt: 'settled', resolvedBy: 'captain' });
      return { ok: true, card };
    },
    card => {
      lifecycle.settle(card, lifecycle.openAsks(card), { resolvedAt: 'withdrawn' }, { clearLegacy: true });
      return { ok: true, card };
    },
  ];
  for (let depth = 0; depth < 6; depth++) {
    const next = [];
    for (const source of frontier) {
      if (states.has(key(source))) continue;
      states.set(key(source), true);
      for (const action of actions) {
        const card = structuredClone(source);
        const before = structuredClone(card);
        const result = action(card);
        attempted++;
        const after = result.card || card;
        assert.ok(after.status !== 'done' || (!lifecycle.openAsks(after).length && !after.needsAction));
        if (!result.ok) assert.deepEqual(card, before, 'refused transitions are atomic');
        if (!states.has(key(after))) next.push(after);
      }
    }
    frontier = next;
  }
  assert.ok(attempted > 1000, 'the bound explores more than a handful of examples');
  context.diagnostic(states.size + ' distinct source states; ' + attempted + ' attempted transitions; depth six.');
});

test('settlement preserves other asks, resolved evidence and the explicit hold lane', () => {
  const first = { id: 'one', resolvedAt: null };
  const second = { id: 'two', resolvedAt: null };
  const card = lifecycle.open({ status: 'inflight' }).card;
  lifecycle.ask(card, first);
  lifecycle.ask(card, second);
  lifecycle.settle(card, [first], { resolvedAt: 'time', resolvedBy: 'captain' });
  assert.equal(card.status, 'waiting');
  assert.deepEqual(lifecycle.openAsks(card), [second]);
  lifecycle.move(card, 'held');
  lifecycle.settle(card, [second], { resolvedAt: 'later', withdrawn: 'No longer needed' });
  assert.equal(card.status, 'held');
  assert.equal(lifecycle.close(card, 'closed').ok, true);
  assert.equal(first.resolvedBy, 'captain');
  assert.equal(second.withdrawn, 'No longer needed');
});

test('settling the last real ask clears its legacy flag without rewriting settlement evidence', () => {
  const card = lifecycle.open({ status: 'waiting', needsAction: true }).card;
  const decision = { id: 'one', resolvedAt: null };
  lifecycle.ask(card, decision);
  lifecycle.settle(card, [decision], { resolvedAt: 'time' });
  assert.equal(card.needsAction, false);
  assert.equal(card.askSettledAt, 'time');
  lifecycle.settle(card, [], { resolvedAt: 'later' }, { clearLegacy: true });
  assert.equal(card.needsAction, false);
  assert.equal(card.askSettledAt, 'time');
  lifecycle.settle(card, [], { resolvedAt: 'again' }, { clearLegacy: true });
  assert.equal(card.askSettledAt, 'time');
  assert.equal(lifecycle.close(card, 'closed').ok, true);
  const legacy = lifecycle.open({ status: 'waiting', needsAction: true }).card;
  assert.match(lifecycle.close(legacy, 'closed').reason, /captain.*legacy ask/);
});
