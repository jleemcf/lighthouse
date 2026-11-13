'use strict';
const assert = require('node:assert');
const { req } = require('../helpers');

// The tool calls: standing authorities, from Owner or the chief developer quoting him; /yolo on, off and scoped.
module.exports = async function authority(ctx) {
  const { port, call, ok, no, state, sidOf } = ctx;
  let r, s;
  // standing authority: only from a person (or the chief developer quoting him)
  assert.equal(
    (
      await req(
        port,
        'POST',
        '/api/boards/t/authorities',
        { owner_words: 'you may send these yourself', covers: 'x', relay: true, target: 'firstmate' },
        'LINES',
      )
    ).status,
    403,
    'an operator cannot grant itself authority',
  );
  assert.equal(
    (
      await req(
        port,
        'POST',
        '/api/boards/t/authorities',
        { owner_words: 'you may send these yourself', covers: 'x', relay: true, target: 'firstmate' },
        'CHIEF',
      )
    ).status,
    400,
    'the chief developer cannot invent his words',
  );
  await req(
    port,
    'POST',
    '/api/comments',
    { board: 't', text: 'From now on you may send the nightly-check prompt to firstmate yourself.' },
    'OWNER',
  );
  const mq = await sidOf('nightly-check prompt');
  assert.equal(
    (
      await req(
        port,
        'POST',
        '/api/boards/t/authorities',
        {
          message_id: mq,
          owner_words: 'you may send every prompt to firstmate yourself',
          covers: 'all prompts',
          relay: true,
          target: 'firstmate',
        },
        'CHIEF',
      )
    ).status,
    400,
    'only his exact words',
  );
  assert.equal(
    (
      await req(
        port,
        'POST',
        '/api/boards/t/authorities',
        {
          message_id: mq,
          owner_words: 'you may send the nightly-check prompt to firstmate yourself',
          covers: 'the nightly-check prompt',
          relay: true,
          target: 'firstmate',
        },
        'CHIEF',
      )
    ).status,
    201,
    'quoting his message on the board',
  );
  ok(await call('board_reply', { to: mq, general: true, text: 'Recorded as a standing authority.' }), 'answered');
  r = await req(
    port,
    'POST',
    '/api/boards/t/authorities',
    {
      owner_words: 'You may send release-note prompts to firstmate yourself.',
      owner_at: '2026-10-22T15:00:00Z',
      covers: 'release-note prompts to firstmate',
      relay: true,
      target: 'firstmate',
    },
    'OWNER',
  );
  assert.equal(r.status, 201);
  const auth = (await call('board_authorities', {})).body.results[0].summary;
  const tsid = /^(t[a-z2-9]+)/.exec(auth)[1];
  ok(
    await call('board_prompt', {
      card: 'upload-choices-for-the-importer',
      to: 'firstmate',
      purpose: 'p',
      prompt: 'Draft the notes.',
      replaces: (await state()).cards['t-upload-choices-for-the-importer'].decisions.find(d => !d.resolvedAt).sid,
    }),
    'prompt 2',
  );
  const ps2 = (
    await req(port, 'GET', '/api/comments?board=t&cardId=t-upload-choices-for-the-importer', null, 'OWNER')
  ).body.comments
    .filter(c => c.prompt)
    .pop();
  r = ok(await call('board_relay', { source: ps2.sid, under_authority: tsid }), 'relay under a standing authority');
  assert.equal(r.body.ticket.to, 'firstmate');
  no(
    await call('board_relay', { source: tsid, to: 'firstmate' }),
    /standing authority, not a message or prompt/,
    'an authority record is not a source of words',
  );

  // /yolo: Owner switches it on and off from his page; nobody else's words do
  await req(port, 'POST', '/api/comments', { board: 't', text: '/yolo' }, 'LINES');
  assert.equal((await state()).boards.t.yolo, null, 'an operator typing /yolo switches nothing');
  await req(port, 'POST', '/api/comments', { board: 't', text: '/yolo' }, 'OWNER');
  s = await state();
  assert.ok(s.boards.t.yolo && /^t/.test(s.boards.t.yolo.sid), 'his /yolo turns it on');
  const ysid = s.boards.t.yolo.sid;
  {
    const g = (await req(port, 'GET', '/api/comments?board=t&general=true', null, 'OWNER')).body.comments;
    assert.ok(
      g.find(c => c.by === 'owner' && c.text === '/yolo').handled,
      'the board answered it: the operator owes nothing',
    );
    assert.ok(
      g.some(c => c.label === 'YOLO' && c.text.includes(ysid)),
      'and says so where he typed it',
    );
  }
  await req(port, 'POST', '/api/comments', { board: 't', text: '/yolo on' }, 'OWNER');
  assert.equal((await state()).boards.t.yolo.sid, ysid, 'on twice is one record');
  r = ok(await call('board_status', {}), 'status');
  assert.ok(r.body.receipt.includes(`/yolo ON (${ysid}`), 'the receipt tells the operator');
  assert.match(r.body.receipt, /Critical direction decisions still go to him as asks/);
  ok(await call('board_open', { title: 'Nightly test runs', context: 'the yolo work', slug: 'yolo-work' }), 'a card');
  ok(
    await call('board_prompt', { card: 'yolo-work', to: 'firstmate', purpose: 'p', prompt: 'Run the nightly tests.' }),
    'a prompt',
  );
  const yp = async () =>
    (await req(port, 'GET', '/api/comments?board=t&cardId=t-yolo-work', null, 'OWNER')).body.comments
      .filter(c => c.prompt)
      .pop().sid;
  r = ok(
    await call('board_relay', { source: await yp(), under_authority: ysid }),
    'under /yolo it goes without his Send',
  );
  assert.equal(r.body.ticket.text, 'Run the nightly tests.');
  await req(port, 'POST', '/api/comments', { board: 't', text: '/yolo off' }, 'OWNER');
  assert.equal((await state()).boards.t.yolo, null, '/yolo off ends it');
  ok(
    await call('board_prompt', {
      card: 'yolo-work',
      to: 'firstmate',
      purpose: 'p',
      prompt: 'Run them again.',
      replaces: (await state()).cards['t-yolo-work'].decisions.find(d => !d.resolvedAt).sid,
    }),
    'another prompt',
  );
  no(
    await call('board_relay', { source: await yp(), under_authority: ysid }),
    /has ended: Owner ended it .* with \/yolo off\. p[a-z2-9]+ waits for his Send/,
    'after /yolo off it waits for his Send',
  );
  assert.match(
    (await call('board_authorities', {})).body.results[0].summary,
    new RegExp(ysid + ' ended'),
    'and the record says ended',
  );
  assert.match(
    (await call('board_authorities', {})).body.results[0].summary,
    new RegExp(tsid + ' in force'),
    'his other standing authorities are untouched',
  );
  // a scope narrows it: "/yolo on <scope>"
  await req(port, 'POST', '/api/comments', { board: 't', text: '/yolo on release matters' }, 'OWNER');
  s = await state();
  assert.equal(s.boards.t.yolo.scope, 'release matters', 'on, for that only');
  const ys1 = s.boards.t.yolo.sid;
  r = ok(await call('board_status', {}), 'status');
  assert.match(
    r.body.receipt,
    /\/yolo ON \(t[a-z2-9]+, .release matters. only, .*on that alone \(anything else waits for his Send\)/,
    'the receipt names the scope',
  );
  assert.match((await req(port, 'GET', '/api/state', null, 'OWNER')).body.boards.t.yolo.sid, /^t/);
  await req(port, 'POST', '/api/comments', { board: 't', text: '/yolo the nightly runs' }, 'OWNER');
  s = await state();
  assert.equal(s.boards.t.yolo.scope, 'the nightly runs', 'a new scope replaces the old');
  assert.match(
    (await call('board_authorities', {})).body.results[0].summary,
    new RegExp(ys1 + ' superseded by ' + s.boards.t.yolo.sid),
  );
  await req(port, 'POST', '/api/comments', { board: 't', text: '/yolo ' + 'x'.repeat(90) }, 'OWNER');
  assert.equal((await state()).boards.t.yolo.scope, 'the nightly runs', 'a paragraph after /yolo switches nothing');
  await req(port, 'POST', '/api/comments', { board: 't', text: '/yolo off.' }, 'OWNER');
  assert.equal((await state()).boards.t.yolo, null, 'off ends the scoped one');
  // the chief developer narrows one recorded before scopes, quoting his message
  await req(
    port,
    'POST',
    '/api/comments',
    { board: 't', text: 'From now on you may prompt firstmate on the importer yourself.' },
    'OWNER',
  );
  const mi = await sidOf('on the importer yourself');
  r = await req(
    port,
    'POST',
    '/api/boards/t/authorities',
    {
      message_id: mi,
      owner_words: 'you may prompt firstmate on the importer yourself',
      covers: '/yolo, the importer only: x',
      relay: true,
      target: 'firstmate',
      yolo_scope: 'the importer',
    },
    'CHIEF',
  );
  assert.equal(r.status, 201, r.raw);
  assert.equal((await state()).boards.t.yolo.scope, 'the importer', 'recorded with its scope');
  await req(port, 'POST', '/api/comments', { board: 't', text: '/yolo off' }, 'OWNER');
  assert.equal((await state()).boards.t.yolo, null);
};
