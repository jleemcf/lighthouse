'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const makeRoutes = require('../routes');
const makeWeb = require('../web');

async function pageState(boards, stored = boards, principal = 'reader', defaultRole = {}) {
  const cfg = { boards, defaultRole };
  const store = {
    seq: 1,
    boards: Object.fromEntries(Object.entries(stored).map(([id, board]) => [id, { id, ...board }])),
    cards: Object.fromEntries(Object.keys(stored).map(id => [id + '-task', { id: id + '-task', board: id }])),
    comments: Object.fromEntries(Object.keys(stored).map(id => [id + '-msg', { id: id + '-msg', board: id }])),
  };
  const web = makeWeb({ cfg });
  const routes = makeRoutes({
    cfg,
    store,
    ...web,
    principalOf: () => ({ name: principal }),
    send: (res, status, body) => ({ status, body }),
    WX: { data: null },
    TC: { yoloOf: () => null },
    ST: { forPage: () => ({}) },
    quietEntry: () => false,
    doorbellStatus: () => ({}),
  });
  const result = await routes.handle({ method: 'GET', url: '/api/state', headers: {} }, {});
  assert.equal(result.status, 200);
  return result.body;
}

const board = (name, extra = {}) => ({ name, access: { reader: 'viewer' }, ...extra });
const legacy = () => ({
  lighthouse: board('Lighthouse'),
  signal: board('Sample'),
  sample: board('Sample Board'),
});

test('state discovers zero, one and many boards in configuration order, not stored order', async () => {
  for (const ids of [[], ['solo'], ['zulu', 'alpha', 'delta', 'echo', 'foxtrot']]) {
    const configured = Object.fromEntries(ids.map(id => [id, board('Board ' + id)]));
    const stored = Object.fromEntries(Object.entries(configured).reverse());
    const state = await pageState(configured, stored);
    assert.deepEqual(Object.keys(state.boards), ids);
    assert.deepEqual(
      Object.values(state.boards).map(item => item.displayName),
      ids.map(id => 'Board ' + id),
    );
    assert.deepEqual(
      Object.values(state.boards).map(item => item.order),
      ids.map((id, index) => index),
    );
  }
});

test('configured names and presentation override stale store metadata without modifying it', async () => {
  const stored = { alpha: { name: 'Old board' }, beta: { name: 'Old second' } };
  const configured = {
    alpha: board('Renamed board', { displayName: 'Short label', order: 20 }),
    beta: board('Second board', { order: 10 }),
  };
  const state = await pageState(configured, stored);
  assert.deepEqual(Object.keys(state.boards), ['beta', 'alpha']);
  assert.equal(state.boards.alpha.name, 'Renamed board');
  assert.equal(state.boards.alpha.displayName, 'Short label');
  assert.equal(stored.alpha.name, 'Old board');
});

test('state never reveals hidden boards, their counts or their position to a viewer', async () => {
  const configured = {
    hidden: board('Hidden board', { order: -1, access: { other: 'owner' } }),
    visible: board('Visible board', { order: 12 }),
    another: board('Another board', { order: 3 }),
  };
  const state = await pageState(configured);
  assert.deepEqual(Object.keys(state.boards), ['another', 'visible']);
  assert.deepEqual(
    Object.values(state.boards).map(item => item.order),
    [0, 1],
  );
  assert.equal(Object.keys(state.cards).length, 2);
  assert.equal(state.recent.length, 2);
  assert.doesNotMatch(JSON.stringify(state), /hidden/i);
  const empty = await pageState(configured, configured, 'stranger');
  assert.deepEqual(empty.boards, {});
  assert.deepEqual(empty.cards, {});
  assert.deepEqual(empty.recent, []);
});

test('board identifiers never select a hidden presentation profile', async () => {
  const configured = legacy();
  const state = await pageState(configured);
  assert.deepEqual(Object.keys(state.boards), ['lighthouse', 'signal', 'sample']);
  assert.deepEqual(
    Object.values(state.boards).map(item => item.displayName),
    ['Lighthouse', 'Sample', 'Sample Board'],
  );
  assert.equal(state.boards.sample.name, 'Sample Board');
  assert.deepEqual(Object.keys(configured), ['lighthouse', 'signal', 'sample']);
  configured.signal.name = 'Renamed signal';
  const renamed = await pageState(configured);
  assert.equal(renamed.boards.signal.name, 'Renamed signal');
  assert.equal(renamed.boards.signal.displayName, 'Renamed signal');
  configured.signal.displayName = 'Renamed signal';
  assert.equal((await pageState(configured)).boards.signal.displayName, 'Renamed signal');
});

test('store-only authorized boards follow configured boards without exposing unauthorized records', async () => {
  const configured = { current: board('Current board') };
  const stored = { extra: { name: 'Stored board' }, ...configured };
  const state = await pageState(configured, stored, 'reader', { reader: 'viewer' });
  assert.deepEqual(Object.keys(state.boards), ['current', 'extra']);
  assert.equal(state.boards.extra.displayName, 'Stored board');
  assert.equal(state.boards.extra.order, 1);
  const denied = await pageState(configured, stored, 'stranger', { reader: 'viewer' });
  assert.deepEqual(denied.boards, {});
  assert.doesNotMatch(JSON.stringify(denied), /Stored board|extra/);
});

test('explicit presentation settings alone determine labels and order', async () => {
  const configured = legacy();
  configured.lighthouse.order = 0;
  configured.signal.displayName = 'Configured label';
  const state = await pageState(configured);
  assert.deepEqual(Object.keys(state.boards), ['lighthouse', 'signal', 'sample']);
  assert.equal(state.boards.signal.displayName, 'Configured label');
});
