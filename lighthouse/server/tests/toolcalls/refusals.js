'use strict';
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { req, wait } = require('../helpers');

// The tool calls: ids from another board; dry runs inside a batch; the plain refusals; compaction; every call a
// sign of life; claims by kind; the check letter; duplicates by the hour judged; Global; the handoff.
module.exports = async function refusals(ctx) {
  const { port, dir, call, ok, no, state, sidOf } = ctx;
  let r, s;
  // ids from another board are refused like missing ones
  r = await req(
    port,
    'POST',
    '/api/boards/w/calls',
    { calls: [{ id: 'w1', tool: 'board_open', args: { title: 'Watch work', context: 'x', slug: 'ww' } }] },
    'WATCH',
  );
  assert.ok(r.body.results[0].ok, JSON.stringify(r.body));
  r = await req(
    port,
    'POST',
    '/api/boards/w/calls',
    { calls: [{ id: 'w2', tool: 'board_ask', args: { card: 'ww', question: 'Ship the watch change?' } }] },
    'WATCH',
  );
  const wa = /: (a[a-z2-9]+)\.$/.exec(r.body.results[0].summary)[1];
  await req(port, 'POST', '/api/comments', { cardId: 'w-ww', text: 'Send this to firstmate: ship it.' }, 'OWNER');
  const wm = (await req(port, 'GET', '/api/comments?board=w&cardId=w-ww', null, 'OWNER')).body.comments.find(
    c => c.by === 'owner',
  ).sid;
  await req(port, 'POST', '/api/comments', { board: 't', text: 'Yes, go ahead.' }, 'OWNER');
  const mg = await sidOf('Yes, go ahead.');
  no(
    await call('board_reply', { to: mg, general: true, text: 'ok', settles: [wa] }),
    /There is no ask/,
    "another board's ask is not settled",
  );
  no(
    await call('board_relay', { source: wm, to: 'firstmate' }),
    /There is no message or prompt/,
    "another board's words are not relayed",
  );
  no(
    await call('board_ask', { card: 'release-707', question: 'Which window?', replaces: wa }),
    /There is no ask|not an open ask/,
    "another board's ask is not replaced",
  );
  s = await state();
  assert.equal(s.cards['w-ww'].status, 'waiting', 'board w untouched');
  assert.equal(
    (
      await req(
        port,
        'POST',
        '/api/boards/w/calls',
        { calls: [{ id: 'n3', tool: 'board_notice', args: { board: 't', text: 'x' } }] },
        'OPS',
      )
    ).status,
    403,
    'no notice through a board the caller cannot see',
  );
  // a dry run inside a batch is refused, never applied for real
  no(
    await call('board_batch', {
      calls: [{ tool: 'board_post', args: { card: 'release-707', kind: 'fyi', text: 'INNER-DRY', dry_run: true } }],
    }),
    /dry_run goes on the batch itself/,
    'inner dry run',
  );
  s = await state();
  assert.ok(!s.cards['t-release-707'].log.some(e => e.text === 'INNER-DRY'), 'nothing applied');
  // a refused batch leaves everyone else's writes alone
  await req(port, 'POST', '/api/comments', { board: 't', text: 'KEEP-THIS-MESSAGE' }, 'OWNER');
  no(
    await call('board_batch', {
      calls: [
        { tool: 'board_post', args: { card: 'release-707', kind: 'fyi', text: 'B2' } },
        { tool: 'board_close', args: { card: 'nope' } },
      ],
    }),
    /Nothing in the batch was applied/,
    'refused batch',
  );
  assert.ok(await sidOf('KEEP-THIS-MESSAGE'), "Owner's message is still there");
  // the plain refusals
  no(
    await call('board_reply', { to: [], general: true, text: 'x' }),
    /Name the message you are answering/,
    'an empty to',
  );
  no(
    await call('board_post', { general: true, kind: 'fyi', text: 'All three boards are quiet.' }),
    /News always belongs to a card \(ruling 42\)/,
    'no task-less FYI on General',
  );
  no(
    await call('board_post', { kind: 'fyi', text: 'x' }),
    /board_open one for it/,
    'a post with no card names the way',
  );
  // the compaction hook calls compacting with no note: the operator's own note is kept
  ok(await call('board_shift', { action: 'compacting', note: 'Mid-release: waiting on the notes.' }), 'a note');
  ok(await call('board_shift', { action: 'compacting' }), 'the hook, no note');
  r = ok(await call('board_shift', { action: 'compacted' }), 'compacted');
  assert.equal(r.body.results[0].pickup.note, 'Mid-release: waiting on the notes.', 'the note survives the hook');
  // every call is a sign of life: a STATUS goes to its card's log, never a message, and still moves the silence
  // clock, which would otherwise read only the shift's start
  ok(await call('board_shift', { action: 'start' }), 'shift on');
  const onAt = (await state()).boards.t.shift.lastSeen;
  await wait(1100); // the board's clock is in whole seconds
  ok(await call('board_post', { card: 'release-707', kind: 'status', text: 'Still deploying.' }), 'a status');
  s = await state();
  assert.ok(s.boards.t.shift.lastSeen > onAt, 'the status moves the last-seen clock');
  r = await req(port, 'GET', '/api/boards/t/conduct?minutes=60', null, 'OWNER');
  assert.equal(r.body.lastLine, s.boards.t.shift.lastSeen, 'the conduct report reads it');
  assert.equal(r.body.signals.silenceMin, 0);
  await call('board_post', { card: 'release-707', kind: 'fyi', text: 'LATE-MARK' }, 'OPS', {
    queued: true,
    client_at: new Date(Date.now() - 3600000).toISOString(),
  }); // queued an hour ago (refused: Owner wrote since)
  assert.equal((await state()).boards.t.shift.lastSeen, s.boards.t.shift.lastSeen, 'never moves the clock back');
  // a claim names its kind: one name can hold a line, shadow, tool-mode and collector token at a switch
  {
    const cl = path.join(dir, 'claims');
    fs.mkdirSync(cl, { recursive: true });
    for (const [code, kind] of [
      ['KLINES23', 'lines'],
      ['KSHADOW2', 'shadow'],
      ['KTOOLS23', 'tools'],
      ['KCOLLEC2', 'collector'],
      ['KNOKIND2', undefined],
    ])
      fs.writeFileSync(
        path.join(cl, code + '.json'),
        JSON.stringify({ name: 'op-test', kind, exp: Date.now() + 60000 }),
      );
    for (const [code, tok] of [
      ['KLINES23', 'LINES'],
      ['KSHADOW2', 'SHADOW'],
      ['KTOOLS23', 'OPS'],
      ['KCOLLEC2', 'COL'],
      ['KNOKIND2', 'LINES'],
    ]) {
      r = await req(port, 'POST', '/api/claim', { code });
      assert.equal(r.status, 200, r.raw);
      assert.equal(r.body.token, tok, code + ' hands over the token of its kind');
    }
  }
  // the check letter catches one wrong letter and two swapped neighbours, everywhere in an id
  const TC = require('../../toolcalls')({
    store: () => ({ comments: {}, cards: {}, boards: {} }),
    cfg: {},
    now: () => new Date().toISOString(),
    newId: () => 'x',
  });
  const B = 'abcdefghjkmnpqrstuvwxyz23456789';
  for (const sid of [TC.makeSid('m', 'one'), TC.makeSid('a', 'two'), TC.makeSid('p', 'three', 5)]) {
    assert.ok(TC.sidOk(sid), sid);
    for (let i = 1; i < sid.length; i++)
      for (const c of B)
        if (c !== sid[i])
          assert.ok(!TC.sidOk(sid.slice(0, i) + c + sid.slice(i + 1)), `one letter wrong in ${sid} at ${i}: ${c}`);
    for (let i = 1; i < sid.length - 1; i++)
      if (sid[i] !== sid[i + 1])
        assert.ok(!TC.sidOk(sid.slice(0, i) + sid[i + 1] + sid[i] + sid.slice(i + 2)), `swap in ${sid} at ${i}`);
  }

  // a duplicate counts in the hour it was judged, when it was opened, not whenever it is posted to
  {
    const cd = (await req(port, 'GET', '/api/boards/l/conduct?minutes=60', null, 'OWNER')).body;
    assert.equal(cd.signals.duplicates, 1, 'one duplicate: ' + JSON.stringify(cd.examples.duplicates));
    assert.equal(
      cd.examples.duplicates[0].id,
      'l-dup-new',
      'the newly judged one, not the one judged weeks ago and posted to now',
    );
    assert.ok(
      !cd.examples.duplicates.some(x => x.id === 'l-split'),
      'a card split off a card the watch named a catch-all is not its duplicate',
    );
  }

  // Global: one message from his page lands on every board as his words on General, marked Global;
  // each operator answers its own copy, and Global shows how every copy stands
  {
    assert.equal((await req(port, 'POST', '/api/global', { text: 'x' }, 'OPS')).status, 403, 'only Owner sends Global');
    const g = await req(port, 'POST', '/api/global', { text: 'GLOBAL-MARK: done for today' }, 'OWNER');
    assert.equal(g.status, 201, g.raw);
    assert.deepEqual(g.body.copies.map(c => c.board).sort(), ['l', 't', 'w'], 'a copy on every board');
    r = await req(
      port,
      'POST',
      '/api/boards/w/calls',
      { calls: [{ id: 'gw1', tool: 'board_status', args: {} }] },
      'WATCH',
    );
    assert.equal(r.status, 200, r.raw);
    assert.match(
      r.body.receipt,
      /Global: sent to every operator at once; answer your own copy\]: «GLOBAL-MARK/,
      "marked Global in the operator's inbox",
    );
    ok(
      await call('board_reply', { to: await sidOf('GLOBAL-MARK'), general: true, text: 'Noted, standing down.' }),
      'answered on its own copy',
    );
    const gl = (await req(port, 'GET', '/api/global', null, 'OWNER')).body.globals.find(x =>
      x.text.includes('GLOBAL-MARK'),
    );
    const tc = gl.copies.find(c => c.board === 't'),
      wc = gl.copies.find(c => c.board === 'w');
    assert.ok(tc.handled && tc.reply && tc.reply.text === 'Noted, standing down.', 'its answer shows');
    assert.ok(!wc.handled && !wc.reply, 'the others still wait');
    assert.equal((await req(port, 'GET', '/api/global', null, 'OPS')).status, 403, "Global's list is Owner's");
    const tx = (await req(port, 'GET', '/api/boards/t/transcript', null, 'OWNER')).body.entries;
    assert.ok(
      tx.some(e => e.role === 'owner' && e.via === 'global' && e.text.includes('GLOBAL-MARK')),
      'his words in the transcript, as Global',
    );
    assert.ok(
      tx.some(e => e.text === 'Noted, standing down.' && e.global),
      'the answer marked as an answer to Global',
    );
    const one = await req(port, 'POST', '/api/global', { text: 'GLOBAL-TWICE', sendId: 'global-send-1' }, 'OWNER'),
      two = await req(port, 'POST', '/api/global', { text: 'GLOBAL-TWICE', sendId: 'global-send-1' }, 'OWNER');
    assert.equal(two.body.global, one.body.global, 'a repeated send is caught, not sent twice');
    ok(
      await call('board_reply', { to: await sidOf('GLOBAL-TWICE'), general: true, noted: true }),
      'the second one needs no answer here',
    );
  }

  // handoff: built from records, never authority from the operator
  r = ok(await call('board_handoff', { people: 'Robin: release owner', commitments: 'notes by Friday' }), 'handoff');
  assert.match(
    r.body.handoff,
    /Standing authorities[\s\S]*IN FORCE: «release-note prompts to firstmate»/,
    'authorities from records',
  );
  assert.match(r.body.handoff, /## The board now/);
  assert.ok(
    fs.statSync(path.join(dir, 'store.json')).size > 1000,
    'the store was written before the answer (durability)',
  );
};
