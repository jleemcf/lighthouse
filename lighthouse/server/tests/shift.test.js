'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { cardFixture } = require('./card-fixture');
const { wait } = require('./helpers');

const iso = milliseconds => new Date(milliseconds).toISOString();
const stateOf = async fixture => (await fixture.request('GET', '/api/state')).body;
const line = (fixture, board, text, time) =>
  fixture.request(
    'POST',
    '/api/boards/' + board + '/events',
    {
      rows: [{ label: 'SHIFT', task: 'general', text, t: time }],
    },
    'LEGACY',
  );

test('shift: repeated tool starts and ends preserve the original edges', async context => {
  const fixture = await cardFixture(context);
  const result = await fixture.call('board_shift', { action: 'start' });
  assert.equal(result.ok, true, result.reason);
  const started = (await stateOf(fixture)).boards.t.shift;
  await wait(1100);
  await fixture.call('board_shift', { action: 'start' });
  assert.deepEqual((await stateOf(fixture)).boards.t.shift, started);
  await fixture.call('board_shift', { action: 'end' });
  const ended = (await stateOf(fixture)).boards.t.shift;
  await wait(1100);
  await fixture.call('board_shift', { action: 'end' });
  assert.deepEqual((await stateOf(fixture)).boards.t.shift, ended);
});

test('shift: posts after an end never relight either protocol', async context => {
  const fixture = await cardFixture(context);
  for (const board of ['t', 'lines']) {
    if (board === 't') {
      await fixture.call('board_shift', { action: 'start' });
      await fixture.call('board_shift', { action: 'end' });
      await fixture.open('after-end');
      await fixture.call('board_post', { card: 'after-end', kind: 'fyi', text: 'A later tool post.' });
    } else {
      await line(fixture, board, 'shift started', iso(Date.now() - 3600000));
      await line(fixture, board, 'shift ended', iso(Date.now() - 10 * 60000));
    }
    await fixture.request(
      'POST',
      '/api/boards/' + board + '/events',
      {
        rows: [{ label: 'FYI', task: 'general', text: 'A later note.' }],
      },
      'LEGACY',
    );
    assert.equal((await stateOf(fixture)).boards[board].shift.state, 'off', board);
  }
});

test('shift: each new shift gets its own start in both protocols', async context => {
  const fixture = await cardFixture(context);
  for (const board of ['t', 'lines']) {
    if (board === 't') {
      assert.equal((await fixture.call('board_shift', { action: 'start' })).ok, true);
      await wait(30);
      assert.equal((await fixture.call('board_shift', { action: 'end' })).ok, true);
    } else {
      await line(fixture, board, 'shift started', iso(Date.now() - 3600000));
      await line(fixture, board, 'shift ended', iso(Date.now() - 600000));
    }
    const since = iso(Date.now());
    await fixture.request('POST', '/api/boards/' + board + '/shift', { state: 'on', since }, 'LEGACY');
    await line(fixture, board, 'shift started', iso(Date.now() + 100));
    assert.equal((await stateOf(fixture)).boards[board].shift.since, since);
  }
});

test('shift: shadow tokens cannot start or end live shifts in either protocol', async context => {
  const fixture = await cardFixture(context, null, {
    tokens: {
      LEGACY: { name: 'operator', via: 'api' },
      SHADOW: { name: 'operator', via: 'api', mode: 'tools', shadow: true },
    },
  });
  for (const board of ['t', 'lines']) {
    const route = '/api/boards/' + board + '/shift';
    assert.equal((await fixture.request('POST', route, { state: 'on' }, 'SHADOW')).status, 403);
    assert.equal((await fixture.request('POST', route, { state: 'on' }, 'LEGACY')).status, 200);
    const started = (await fixture.request('GET', '/api/state', null, 'LEGACY')).body.boards[board].shift;
    assert.equal((await fixture.request('POST', route, { state: 'off' }, 'SHADOW')).status, 403);
    assert.deepEqual((await fixture.request('GET', '/api/state', null, 'LEGACY')).body.boards[board].shift, started);
    assert.equal((await fixture.request('POST', route, { state: 'off' }, 'LEGACY')).status, 200);
  }
});

test('shift: legacy route refuses unknown states and arbitrary fields', async context => {
  const fixture = await cardFixture(context);
  for (const body of [{ state: 'banana' }, { state: 'on', endedAt: 'invented' }, { state: 'on', since: 'bad' }]) {
    const response = await fixture.request('POST', '/api/boards/t/shift', body, 'LEGACY');
    assert.equal(response.status, 400, JSON.stringify(body));
    assert.equal((await stateOf(fixture)).boards.t.shift.state, 'off');
  }
});

test('shift: immediate ends accept a millisecond start and duplicate line edges do nothing', async context => {
  const fixture = await cardFixture(context);
  for (const board of ['t', 'lines']) {
    const since = iso(Date.now());
    await fixture.request('POST', '/api/boards/' + board + '/shift', { state: 'on', since }, 'LEGACY');
    const started = (await stateOf(fixture)).boards[board].shift;
    await line(fixture, board, 'shift started', since);
    await fixture.request('POST', '/api/boards/' + board + '/shift', { state: 'on' }, 'LEGACY');
    assert.deepEqual((await stateOf(fixture)).boards[board].shift, started);
    await fixture.request('POST', '/api/boards/' + board + '/shift', { state: 'off' }, 'LEGACY');
    const ended = (await stateOf(fixture)).boards[board].shift;
    assert.equal(ended.state, 'off');
    await line(fixture, board, 'shift ended', iso(Date.now()));
    assert.deepEqual((await stateOf(fixture)).boards[board].shift, ended);
  }
});

test('shift: delayed optional line edges cannot change the next shift', async context => {
  const fixture = await cardFixture(context);
  const oldStart = iso(Date.now() - 12 * 3600000);
  const oldEnd = iso(Date.now() - 10 * 3600000);
  await line(fixture, 'lines', 'shift started', oldStart);
  await fixture.request('POST', '/api/boards/lines/shift', { state: 'off' }, 'LEGACY');
  await fixture.request('POST', '/api/boards/lines/shift', { state: 'on' }, 'LEGACY');
  const started = (await stateOf(fixture)).boards.lines.shift;
  await line(fixture, 'lines', 'shift ended', oldEnd);
  assert.deepEqual((await stateOf(fixture)).boards.lines.shift, started);
  await fixture.request('POST', '/api/boards/lines/shift', { state: 'off' }, 'LEGACY');
  const ended = (await stateOf(fixture)).boards.lines.shift;
  await line(fixture, 'lines', 'shift started', oldStart);
  assert.deepEqual((await stateOf(fixture)).boards.lines.shift, ended);
});

test('shift: a queued optional end keeps its original time across the next start', async context => {
  const fixture = await cardFixture(context);
  await fixture.call('board_shift', { action: 'start' });
  const started = (await stateOf(fixture)).boards.t.shift;
  const result = await fixture.request('POST', '/api/boards/t/calls', {
    calls: [
      {
        id: 'late-end',
        tool: 'board_shift',
        args: { action: 'end' },
        queued: true,
        client_at: iso(Date.now() - 10 * 3600000),
        sent_at: iso(Date.now()),
      },
    ],
  });
  assert.equal(result.body.results[0].ok, true);
  assert.deepEqual((await stateOf(fixture)).boards.t.shift, started);
});

test('shift: a three-day abandoned modern shift lapses instead of staying on', async context => {
  const old = iso(Date.now() - 3 * 86400000);
  const fixture = await cardFixture(context, {
    boards: {
      t: {
        id: 't',
        shift: {
          state: 'on',
          operator: 'operator',
          since: old,
          lastSeen: old,
          heartbeat: { t: old, session: 'gone' },
        },
      },
    },
  });
  const board = (await stateOf(fixture)).boards.t;
  assert.equal(board.shift.state, 'off');
  assert.equal(board.shift.endedBy, 'lapse');
});
