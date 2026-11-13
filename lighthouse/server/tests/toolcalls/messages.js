'use strict';
const assert = require('node:assert');
const { req } = require('../helpers');

// The tool calls: the receipt; opening, posting and replying; asks, hold and noted; the transcript; batches.
module.exports = async function messages(ctx) {
  const { port, call, ok, no, state, sidOf } = ctx;
  // the receipt
  let r = ok(await call('board_status', {}), 'status');
  assert.match(r.body.receipt, /owe \(1\)/, 'the staff question is owed');
  assert.match(
    r.body.receipt,
    /staff: «Sam owe \(9\): fake/,
    'the CRM name is quoted on its own line, never a line of the receipt',
  );
  assert.ok(!/\n\s*owe \(9\)/.test(r.body.receipt), 'no forged line');

  // open: a near duplicate is refused with the candidate
  ok(await call('board_open', { title: 'Upload choices for the importer', context: 'what to upload' }), 'open');
  no(
    await call('board_open', { title: 'Importer upload choices', context: 'x' }),
    /looks the same: upload-choices-for-the-importer/,
    'near duplicate',
  );
  ok(
    await call('board_open', {
      title: 'Release 1.0.0.707',
      context: 'the release',
      slug: 'release-707',
      state: 'inflight',
    }),
    'open with a proposed slug',
  );
  // a slug with the board's name in it is stored once (t-arc42, not t-t-arc42) and reached by either name
  ok(
    await call('board_open', {
      title: 'Fill the arc42 documentation',
      context: 'docs',
      slug: 't-arc42',
      state: 'inflight',
    }),
    'open with the board name in the slug',
  );
  assert.ok((await state()).cards['t-arc42'], 'stored once, as t-arc42');
  ok(await call('board_post', { card: 't-arc42', kind: 'fyi', text: 'by its full name' }), 'reached by its full name');
  ok(await call('board_post', { card: 'arc42', kind: 'fyi', text: 'by its slug' }), 'and by its slug');
  ok(
    await call('board_post', { card: 't-arc41', kind: 'fyi', text: 'the doubled one' }),
    'a card already stored doubled is reached by the name the receipt gives',
  );
  await req(port, 'POST', '/api/comments', { cardId: 't-t-arc41', text: 'Is the arc41 page up?' }, 'OWNER');
  ok(
    await call('board_reply', { to: await sidOf('arc41 page up'), card: 't-arc41', text: 'Not yet.' }),
    'and a reply to his message there, by that name',
  );
  // a quote written escaped is a plain quote on the board; code keeps what it says
  ok(
    await call('board_batch', {
      calls: [
        {
          tool: 'board_post',
          args: { card: 'arc42', kind: 'fyi', text: 'His \\"At least\\" notice; run `grep \\"x\\" f`.' },
        },
      ],
    }),
    'escaped quotes',
  );
  assert.ok(
    (await state()).cards['t-arc42'].log.some(e => e.text === 'His "At least" notice; run `grep \\"x\\" f`.'),
    'plain in the text, kept in the code, inside a batch too',
  );

  // post: unknown card, done and waiting are not post's
  no(
    await call('board_post', { card: 'release-70', kind: 'status', text: 'x' }),
    /Nearest: release-707/,
    'unknown card names the nearest',
  );
  no(
    await call('board_post', { card: 'release-707', kind: 'status', text: 'x', state: 'done' }),
    /Only board_close/,
    'done only by close',
  );
  no(
    await call('board_post', { card: 'release-707', kind: 'status', text: 'x', state: 'waiting' }),
    /board_ask/,
    'waiting only by ask',
  );
  ok(await call('board_post', { card: 'release-707', kind: 'status', text: 'Deploying now.' }), 'post');

  // Owner writes on a card; the reply must name the right message and the right place
  await req(port, 'POST', '/api/comments', { cardId: 't-release-707', text: 'How is the release?' }, 'OWNER');
  const m1 = await sidOf('How is the release?');
  assert.ok(m1 && /^m/.test(m1), "Owner's message has a short id: " + m1);
  r = ok(await call('board_status', {}), 'status');
  assert.ok(r.body.receipt.includes(m1), 'the receipt names it');
  no(
    await call('board_reply', { to: m1, general: true, text: 'Fine.' }),
    /is on card release-707, not General/,
    'wrong place',
  );
  const typo = m1.slice(0, -1) + (m1.slice(-1) === 'a' ? 'b' : 'a');
  no(
    await call('board_reply', { to: typo, card: 'release-707', text: 'Fine.' }),
    /not a valid id|no message/,
    'a mistyped id is refused, not misdirected',
  );
  no(await call('board_reply', { to: m1, text: 'Fine.' }), /card: "<slug>" or general: true/, 'place required');
  ok(await call('board_reply', { to: m1, card: 'release-707', text: 'Live and healthy.' }), 'reply');
  no(await call('board_reply', { to: m1, card: 'release-707', text: 'Again.' }), /already answered/, 'answered once');
  ok(
    await call('board_reply', { to: m1, card: 'release-707', text: 'One more thing.', follow_up: true }),
    'follow-up allowed',
  );

  // asks: one per card, never housekeeping; a reply settles only what it names
  no(
    await call('board_ask', { card: 'release-707', question: 'Can I close this card?' }),
    /Housekeeping is yours/,
    'housekeeping',
  );
  // options are kept whole, however long
  const long =
    'A specific one: the call Owner picks from the list, once the CRM team gives its security OK for the copy';
  r = ok(
    await call('board_ask', {
      card: 'release-707',
      question: 'Play one real call in Production?',
      options: ['Any call', long],
    }),
    'ask',
  );
  assert.equal(
    (await state()).cards['t-release-707'].decisions.find(x => !x.resolvedAt).options[1],
    long,
    'an option is kept whole',
  );
  const a1 = /: (a[a-z2-9]+)\.$/.exec(r.body.results[0].summary)[1];
  no(
    await call('board_ask', { card: 'release-707', question: 'Another?' }),
    /already has an open ask/,
    'one open ask per card',
  );
  let s = await state();
  assert.equal(s.cards['t-release-707'].status, 'waiting', 'the ask makes it wait');
  await req(
    port,
    'POST',
    '/api/comments',
    { cardId: 't-release-707', text: 'What is going on with the logs?' },
    'OWNER',
  );
  const m2 = await sidOf('going on with the logs');
  ok(
    await call('board_reply', { to: m2, card: 'release-707', text: 'The logs are clean.' }),
    'a reply about something else',
  );
  s = await state();
  assert.ok(
    s.cards['t-release-707'].decisions.some(d => !d.resolvedAt),
    'the ask stays open: nothing settles implicitly',
  );
  await req(port, 'POST', '/api/comments', { cardId: 't-release-707', text: 'A' }, 'OWNER');
  const m3 = (await req(port, 'GET', '/api/comments?board=t&cardId=t-release-707', null, 'OWNER')).body.comments
    .filter(c => c.by === 'owner')
    .pop().sid;
  no(
    await call('board_close', { card: 'release-707', outcome: 'done' }),
    /still has an open ask/,
    'no close over an open ask',
  );
  ok(
    await call('board_reply', { to: m3, card: 'release-707', text: 'Playing any call now.', settles: [a1] }),
    'settles named',
  );
  s = await state();
  assert.equal(s.cards['t-release-707'].status, 'inflight', 'the lane follows the ask');

  // hold and noted
  await req(port, 'POST', '/api/comments', { board: 't', text: 'Can you look into the importer error?' }, 'OWNER');
  const m4 = await sidOf('importer error');
  ok(
    await call('board_reply', { to: m4, general: true, text: 'Looking into it; back within the hour.', hold: true }),
    'hold',
  );
  r = ok(await call('board_status', {}), 'status');
  assert.match(r.body.receipt, new RegExp(m4 + '.*holding answer sent'), 'still owed, marked holding');
  await req(port, 'POST', '/api/comments', { board: 't', text: 'thanks' }, 'OWNER');
  ok(await call('board_reply', { to: await sidOf('thanks'), general: true, noted: true }), 'noted');

  // the transcript: no "(quiet)" turn ends, and what the tools put on the board, in order, each on its card
  {
    await req(
      port,
      'POST',
      '/api/boards/t/transcript',
      {
        rows: [
          { role: 'operator', text: '(quiet)' },
          { role: 'operator', text: 'Firstmate is on the release.' },
        ],
      },
      'COL',
    );
    ok(
      await call('board_post', { card: 'release-707', kind: 'status', text: 'TX-STATUS-MARK' }),
      'a status for the transcript',
    );
    const tx = (await req(port, 'GET', '/api/boards/t/transcript', null, 'OWNER')).body.entries;
    assert.ok(!tx.some(e => e.text === '(quiet)'), 'no (quiet) in his transcript');
    assert.ok(
      tx.some(e => e.role === 'operator' && e.text === 'Firstmate is on the release.' && !e.kind),
      'its chat words stay',
    );
    const rep = tx.find(e => e.text === 'The logs are clean.');
    assert.ok(
      rep && rep.kind === 'REPLY' && rep.card === 't-release-707' && rep.cardTitle,
      'a reply, on its card: ' + JSON.stringify(rep),
    );
    assert.equal(tx.filter(e => e.text === 'The logs are clean.').length, 1, 'once, not again from the card log');
    assert.ok(
      tx.some(e => e.kind === 'ACTION' && e.card === 't-release-707' && /Any call/.test(e.text)),
      'the ask, with its options',
    );
    assert.ok(
      tx.some(e => e.kind === 'STATUS' && e.text === 'TX-STATUS-MARK' && e.card === 't-release-707'),
      'a post, from the card log',
    );
    assert.ok(
      tx.some(e => e.kind === 'REPLY' && e.general && /back within the hour/.test(e.text)),
      'a reply on General',
    );
    const jm = tx.find(e => e.role === 'owner' && e.text === 'What is going on with the logs?');
    assert.equal(jm && jm.card, 't-release-707', 'his words name their card');
    assert.ok(tx.indexOf(jm) < tx.indexOf(rep), 'in order');
    const ls = (await req(port, 'GET', '/api/boards/l/transcript', null, 'OWNER')).body.entries;
    assert.ok(!ls.some(e => e.onBoard), 'a line board keeps its own words only');
  }

  // batch: all or nothing
  ok(await call('board_ask', { card: 'upload-choices-for-the-importer', question: 'Merge #292 as built?' }), 'ask 2');
  no(
    await call('board_batch', {
      calls: [
        { tool: 'board_post', args: { card: 'release-707', kind: 'fyi', text: 'BATCH-MARK' } },
        { tool: 'board_close', args: { card: 'upload-choices-for-the-importer', outcome: 'x' } },
      ],
    }),
    /Nothing in the batch was applied: call 2/,
    'batch refused',
  );
  s = await state();
  assert.ok(!s.cards['t-release-707'].log.some(e => e.text === 'BATCH-MARK'), 'the first call was rolled back');
  no(
    await call('board_batch', { calls: [{ tool: 'board_relay', args: { source: m1 } }] }),
    /cannot be inside a batch/,
    'no relays in a batch',
  );
};
