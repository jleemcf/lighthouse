'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const ownershipHttp = require('./ownership-http-fixture');

test('ownership uploads: unrelated activation leaves legacy pending files private and usable', async context => {
  const board = await ownershipHttp(context, true, { alphaAccess: { watch: 'operator' } });
  for (const credential of ['LEGACY', 'WATCH', 'COLLECTOR']) {
    const attachment = await board.upload(credential);
    assert.equal((await board.request('GET', '/api/attachments/' + attachment, null, 'PAGE')).status, 403);
    const forbidden = await board.request(
      'POST',
      '/api/comments',
      {
        board: 'beta',
        text: 'Cannot publish on enforcing board',
        attachments: [attachment],
      },
      credential,
    );
    assert.equal(forbidden.status, 403, forbidden.raw);
    const allowed = await board.request(
      'POST',
      '/api/comments',
      {
        board: 'alpha',
        text: 'Own enforcement-off board',
        attachments: [attachment],
      },
      credential,
    );
    if (credential === 'LEGACY') assert.equal(allowed.status, 201, allowed.raw);
    else assert.equal(allowed.status, 403, allowed.raw);
  }
  const bytes = Buffer.from('Explicit board binding');
  const scoped = await board.raw(
    'POST',
    '/api/attachments',
    bytes,
    {
      'Content-Type': 'text/plain',
      'X-Lighthouse-Board': 'beta',
    },
    'LEGACY',
  );
  assert.equal(scoped.status, 403, scoped.raw);
});

for (const enforce of [false, true])
  test('ownership humans: page writes retain their own scope, enforcement=' + enforce, async context => {
    const board = await ownershipHttp(context, enforce, {
      initial: {
        cards: {
          'beta-work': { id: 'beta-work', board: 'beta', title: 'Work', status: 'inflight', needsAction: true },
        },
      },
    });
    const attachment = await board.upload('PAGE');
    for (const body of [
      { board: 'beta', text: 'Human ask', attachments: [attachment] },
      { cardId: 'beta-work', text: 'Human card ask' },
    ]) {
      const result = await board.request('POST', '/api/comments', body, 'PAGE');
      assert.equal(result.status, 201, result.raw);
      assert.equal(result.body.author, 'person');
      assert.equal(result.body.handled, false);
    }
    assert.equal(
      (await board.request('POST', '/api/bundles', { board: 'beta', parts: [{ text: 'Human bundle' }] }, 'PAGE'))
        .status,
      201,
    );
    assert.equal((await board.request('POST', '/api/global', { text: 'Human global' }, 'OWNER')).status, 201);
    assert.equal((await board.request('POST', '/api/cards/beta-work/resolve', {}, 'PAGE')).status, 200);
    const prompt = await board.request(
      'POST',
      '/api/boards/beta/calls',
      {
        calls: [{ tool: 'board_prompt', args: { card: 'work', to: 'firstmate', purpose: 'Test', prompt: 'Test' } }],
      },
      board.first,
      1,
    );
    assert.equal(prompt.body.results[0].ok, true, prompt.raw);
    const comments = (await board.request('GET', '/api/comments?board=beta', null, 'OWNER')).body.comments;
    const source = comments.find(comment => comment.prompt);
    assert.ok(source);
    const choice = await board.request('POST', '/api/comments/' + source.id + '/decide', { choice: 'send' }, 'PAGE');
    assert.equal(choice.status, 200, choice.raw);
    assert.equal(
      (await board.request('PUT', '/api/cards/beta-work', { title: 'Not an operator' }, 'PAGE')).status,
      403,
    );
  });

test('ownership humans: Global ignores an enforcing board with read-only membership', async context => {
  const board = await ownershipHttp(context, true, { betaAccess: { owner: 'viewer' } });
  const result = await board.request('POST', '/api/global', { text: 'Only writable boards' }, 'OWNER');
  assert.equal(result.status, 201, result.raw);
  assert.deepEqual(
    result.body.copies.map(copy => copy.board),
    ['alpha'],
  );
  assert.equal(
    (await board.request('POST', '/api/comments', { board: 'beta', text: 'No rights' }, 'OWNER')).status,
    403,
  );
});

test('ownership scopes: an unenrolled session cannot read or write an unrelated line board', async context => {
  const board = await ownershipHttp(context, true, { betaAccess: { beta: 'owner' } });
  const result = await board.request(
    'POST',
    '/api/boards/alpha/calls',
    {
      calls: [{ tool: 'board_open', args: { task: 'unexpected', title: 'Must not cross boards' } }],
    },
    board.first,
    1,
  );
  assert.equal(result.status, 403, result.raw);
  const comments = await board.request('GET', '/api/comments?board=alpha', null, board.first, 1);
  assert.equal(comments.status, 200);
  assert.deepEqual(comments.body.comments, []);
  assert.equal((await board.control({ action: 'nominate' }, board.first, 1)).status, 403);
});

for (const sessionId of ['session_with_underscore', 's'.repeat(100)])
  test('ownership heartbeat: every explicit session ID can renew: length ' + sessionId.length, async context => {
    const board = await ownershipHttp(context, true, { sessionId });
    const body = { session: sessionId, processId: board.processId };
    const result = await board.request('POST', '/api/boards/beta/heartbeat', body, board.first, 1);
    assert.equal(result.status, 200, result.raw);
    assert.equal(
      (
        await board.request(
          'POST',
          '/api/boards/beta/heartbeat',
          {
            ...body,
            session: 'session-different',
          },
          board.first,
          1,
        )
      ).status,
      403,
    );
  });

test('ownership notices: source writes stay fenced while target watch scope stays narrow', async context => {
  const board = await ownershipHttp(context, true, { alphaAccess: { beta: 'watch' } });
  const notice = () => ({
    calls: [{ id: crypto.randomUUID(), tool: 'board_notice', args: { board: 'alpha', text: 'Scoped watch notice' } }],
  });
  const valid = await board.request('POST', '/api/boards/beta/calls', notice(), board.first, 1);
  assert.equal(valid.status, 200, valid.raw);
  assert.equal(valid.body.results[0].ok, true, valid.raw);
  await board.acquire('session-second', board.second, 1);
  const before = (await board.request('GET', '/api/state', null, 'OWNER')).body;
  for (const [credential, epoch] of [
    [board.first, 1],
    [board.first, 2],
    [board.second, 1],
    ['TOOLS', 2],
  ]) {
    const result = await board.request('POST', '/api/boards/beta/calls', notice(), credential, epoch);
    assert.ok([403, 409].includes(result.status), result.raw);
    assert.deepEqual((await board.request('GET', '/api/state', null, 'OWNER')).body, before);
  }
});

test('ownership evidence retention keeps only outstanding old capabilities', async context => {
  const t = new Date(Date.now() - 31 * 86400000).toISOString();
  const board = await ownershipHttp(context, true, {
    initial: {
      tickets: {
        pending: { id: 'pending', board: 'beta', t, evidenceHash: 'pending-hash' },
        settled: { id: 'settled', board: 'beta', t, evidenceHash: 'settled-hash', used: true },
        legacy: { id: 'legacy', board: 'beta', t, used: true },
      },
    },
  });
  const result = await board.request(
    'POST',
    '/api/boards/beta/calls',
    {
      calls: [{ tool: 'board_status', args: {} }],
    },
    board.first,
    1,
  );
  assert.equal(result.status, 200, result.raw);
  const stored = JSON.parse(fs.readFileSync(path.join(board.directory, 'store.json'), 'utf8'));
  assert.ok(stored.tickets.pending);
  assert.equal(stored.tickets.settled, undefined);
  assert.equal(stored.tickets.legacy, undefined);
});
