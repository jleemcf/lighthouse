'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const fixture = require('./release-fixture');

test('replies require an existing readable target on the destination board before any mutation', async test => {
  const board = await fixture(test);
  const question = await board.request('POST', '/api/comments', { board: 'beta', text: 'Private question' }, 'OWNER');
  const target = question.body.id;
  assert.deepEqual((await board.request('GET', '/api/comments?board=beta')).body.comments, []);
  for (const [token, replyTo] of [
    ['ALPHA', target],
    ['OWNER', target],
    ['ALPHA', 'missing-message'],
  ]) {
    const before = (await board.request('GET', '/api/state', null, 'OWNER')).body;
    const result = await board.request(
      'POST',
      '/api/comments',
      { board: 'alpha', text: 'Wrong reply', replyTo },
      token,
    );
    assert.equal(result.status, 400);
    assert.match(result.body.error, /reply target.*same board.*readable/i);
    assert.deepEqual((await board.request('GET', '/api/state', null, 'OWNER')).body, before);
  }
  const reply = await board.request(
    'POST',
    '/api/comments',
    { board: 'beta', text: 'Authorized answer', replyTo: target },
    'BETA',
  );
  assert.equal(reply.status, 201);
  const messages = (await board.request('GET', '/api/comments?board=beta', null, 'BETA')).body.comments;
  assert.equal(messages.find(message => message.id === target).handled, true);
});

test('ordinary attachments follow readable references and only their uploader can read pending uploads', async test => {
  const board = await fixture(test);
  const attachment = await board.upload();
  const route = '/api/attachments/' + attachment;
  assert.equal((await board.request('GET', route)).status, 200);
  assert.equal((await board.raw('GET', route)).headers['cache-control'], 'private, no-store');
  assert.equal((await board.request('GET', route, null, 'BETA')).status, 403);
  assert.equal((await board.request('GET', route, null, 'OWNER')).status, 403);
  const post = await board.request('POST', '/api/comments', {
    board: 'alpha',
    text: 'Alpha only',
    attachments: [attachment],
  });
  assert.equal(post.status, 201);
  assert.equal((await board.request('GET', route, null, 'OWNER')).status, 200);
  assert.equal((await board.request('GET', route, null, 'BETA')).status, 403);
});

test('unreadable attachment references are refused by comments, bundles, lines and tools', async test => {
  const board = await fixture(test, {
    cards: { 'beta-work': { id: 'beta-work', board: 'beta', title: 'Work', status: 'inflight' } },
  });
  const attachment = await board.upload();
  for (const [route, body] of [
    ['/api/comments', { board: 'beta', text: 'Stolen reference', attachments: [attachment] }],
    ['/api/bundles', { board: 'beta', parts: [{ text: 'Stolen reference', attachments: [attachment] }] }],
    ['/api/bundles', { board: 'beta', attachments: [attachment], parts: [{ text: 'Stolen reference' }] }],
  ]) {
    const before = (await board.request('GET', '/api/state', null, 'OWNER')).body.seq;
    const result = await board.request('POST', route, body, 'BETA');
    assert.equal(result.status, 403);
    assert.match(result.body.error, /attachment.*access/i);
    assert.equal((await board.request('GET', '/api/state', null, 'OWNER')).body.seq, before);
  }
  const lines = await board.request(
    'POST',
    '/api/boards/beta/events',
    {
      rows: [{ label: 'FYI', task: 'work', text: 'Stolen reference', attachments: [attachment] }],
    },
    'BETA',
  );
  assert.equal(lines.body.results[0].ok, false);
  assert.match(lines.body.results[0].reason, /attachment.*access/i);
  const tools = await board.request(
    'POST',
    '/api/boards/beta/calls',
    {
      calls: [
        {
          id: 'unreadable-file',
          tool: 'board_post',
          args: {
            card: 'work',
            kind: 'fyi',
            text: 'Stolen reference',
            attachments: [attachment],
          },
        },
      ],
    },
    'TOOLS',
  );
  assert.equal(tools.body.results[0].ok, false);
  assert.match(tools.body.results[0].reason, /attachment.*access/i);
  assert.equal((await board.request('GET', '/api/attachments/' + attachment, null, 'BETA')).status, 403);
});

for (const method of ['PUT', 'PATCH'])
  test(`legacy card ${method} refuses unreadable attachment references before any mutation`, async test => {
    const board = await fixture(test, {
      cards: { 'beta-work': { id: 'beta-work', board: 'beta', title: 'Work', status: 'inflight' } },
    });
    const attachment = await board.upload();
    const published = await board.request('POST', '/api/comments', {
      board: 'alpha',
      text: 'Alpha only',
      attachments: [attachment],
    });
    assert.equal(published.status, 201);
    const route = '/api/attachments/' + attachment;
    assert.equal((await board.request('GET', route, null, 'BETA')).status, 403);
    const before = (await board.request('GET', '/api/state', null, 'OWNER')).body;
    const refused = await board.request(
      method,
      '/api/cards/beta-work',
      { board: 'beta', title: 'Stolen reference', attachments: [attachment] },
      'BETA',
    );
    assert.equal(refused.status, 403);
    assert.match(refused.body.error, /attachment.*access/i);
    assert.deepEqual((await board.request('GET', '/api/state', null, 'OWNER')).body, before);
    assert.equal((await board.request('GET', route, null, 'BETA')).status, 403);
    const own = await board.upload('BETA');
    const allowed = await board.request(
      method,
      '/api/cards/beta-work',
      { board: 'beta', title: 'Own reference', attachments: [own] },
      'BETA',
    );
    assert.equal(allowed.status, 200);
    assert.deepEqual(allowed.body.attachments, [own]);
    assert.equal((await board.request('GET', '/api/attachments/' + own, null, 'BETA')).status, 200);
  });

test('Global intentionally shares authorized attachments across its destination boards', async test => {
  const board = await fixture(test);
  const attachment = await board.upload('OWNER');
  const result = await board.request(
    'POST',
    '/api/global',
    { text: 'For both boards', attachments: [attachment] },
    'OWNER',
  );
  assert.equal(result.status, 201);
  assert.equal(result.body.copies.length, 2);
  for (const token of ['ALPHA', 'BETA', 'OWNER'])
    assert.equal((await board.request('GET', '/api/attachments/' + attachment, null, token)).status, 200);
  const pending = await board.upload();
  const denied = await board.request(
    'POST',
    '/api/global',
    { text: 'Unreadable pending file', attachments: [pending] },
    'OWNER',
  );
  assert.equal(denied.status, 403);
});

test('tool-mode event notes cannot publish unreadable attachment references', async test => {
  const board = await fixture(test, {}, 'tools');
  const attachment = await board.upload();
  const result = await board.request(
    'POST',
    '/api/boards/beta/events',
    {
      rows: [{ text: 'Unreadable note', attachments: [attachment] }],
    },
    'BETA',
  );
  assert.equal(result.body.results[0].ok, false);
  assert.match(result.body.results[0].reason, /attachment.*access/i);
  assert.deepEqual((await board.request('GET', '/api/comments?board=beta', null, 'BETA')).body.comments, []);
});

test('legacy comment and card references grant scope without changing the store schema', async test => {
  const messageFile = '1234567890abcdef';
  const cardFile = '1234567890abcdee';
  const stewardFile = '1234567890abcded';
  const board = await fixture(test, {
    attachments: {
      [messageFile]: { id: messageFile, type: 'text/plain', by: 'alpha' },
      [cardFile]: { id: cardFile, type: 'text/plain', by: 'alpha' },
      [stewardFile]: { id: stewardFile, type: 'text/plain', by: 'alpha', steward: true, board: 'alpha' },
    },
    comments: { legacy: { id: 'legacy', board: 'alpha', attachments: [{ id: messageFile }] } },
    cards: { legacy: { id: 'legacy', board: 'beta', attachments: [{ id: cardFile }], status: 'inflight' } },
  });
  fs.mkdirSync(path.join(board.directory, 'attachments'));
  for (const identity of [messageFile, cardFile, stewardFile])
    fs.writeFileSync(path.join(board.directory, 'attachments', identity + '.txt'), 'Legacy fixture');
  assert.equal((await board.request('GET', '/api/cards/legacy')).status, 404);
  assert.equal((await board.request('GET', '/api/cards/legacy', null, 'BETA')).status, 200);
  for (const [identity, allowed, denied] of [
    [messageFile, 'ALPHA', 'BETA'],
    [cardFile, 'BETA', 'ALPHA'],
  ]) {
    assert.equal((await board.request('GET', '/api/attachments/' + identity, null, allowed)).status, 200);
    assert.equal((await board.request('GET', '/api/attachments/' + identity, null, denied)).status, 403);
  }
  assert.equal((await board.request('GET', '/api/attachments/' + stewardFile)).status, 403);
  assert.equal((await board.request('GET', '/api/attachments/' + stewardFile, null, 'OWNER')).status, 200);
});
