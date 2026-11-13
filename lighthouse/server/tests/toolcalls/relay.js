'use strict';
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { req } = require('../helpers');

// The tool calls: dry runs and the shadow token; relays by ticket, once, of Owner's words or a prompt he sent; a
// prompt under an ask; his words overtaken by later ones.
module.exports = async function relay(ctx) {
  const { port, dir, call, lcall, ok, no, state, sidOf } = ctx;
  let r, s;
  // dry run and shadow change nothing
  r = ok(await call('board_post', { card: 'release-707', kind: 'fyi', text: 'DRY-MARK', dry_run: true }), 'dry run');
  assert.match(r.body.results[0].summary, /^DRY RUN/);
  r = await call('board_post', { card: 'release-707', kind: 'fyi', text: 'SHADOW-MARK' }, 'SHADOW');
  assert.equal(r.status, 409, 'a shadow token on a board in tool mode is refused: nothing else would answer Owner');
  assert.match(r.body.error, /shadow runs only while the board stays in line mode/);
  r = ok(await lcall('board_post', { card: 'work', kind: 'status', text: 'SHADOW-MARK' }), 'shadow beside the lines');
  assert.match(r.body.results[0].summary, /^DRY RUN/, 'a shadow token always dry-runs');
  assert.match(r.body.receipt, /line mode · SHADOW/, 'the receipt says so');
  s = await state();
  assert.ok(
    !s.cards['t-release-707'].log.some(e => /DRY-MARK|SHADOW-MARK/.test(e.text)) &&
      !s.cards['l-work'].log.some(e => /SHADOW-MARK/.test(e.text)),
    'nothing posted',
  );
  await req(port, 'POST', '/api/comments', { board: 'l', text: 'Tell firstmate to stop.' }, 'OWNER');
  const lm = (await req(port, 'GET', '/api/comments?board=l', null, 'OWNER')).body.comments.find(
    c => c.by === 'owner',
  ).sid;
  // a shadow relay is checked and recorded, never issued, so the shadow trial keeps a record of relays too
  r = ok(await lcall('board_relay', { source: lm, to: 'firstmate' }), 'a shadow relay rehearses');
  assert.match(r.body.results[0].summary, /^DRY RUN/);
  assert.ok(!r.body.ticket, 'no ticket, so nothing can be sent');
  assert.ok(
    !(await req(port, 'GET', '/api/comments?board=l', null, 'OWNER')).body.comments.find(c => c.sid === lm).relayedAt,
    'nothing relayed',
  );
  no(await lcall('board_relay', { source: lm }), /Name to: firstmate/, 'a wrong relay is still refused');
  // "chat" in shadow: the board stays in line mode and never sees the chat, so the rehearsal answers a stand-in
  r = ok(
    await lcall('board_reply', { to: 'chat', general: true, text: 'Stopping it now.' }),
    'a reply to the chat rehearses in shadow',
  );
  assert.match(r.body.results[0].summary, /^DRY RUN/);
  r = ok(
    await lcall('board_batch', {
      calls: [{ tool: 'board_reply', args: { to: 'chat', general: true, text: 'Stopping it now.' } }],
    }),
    'and inside a batch',
  );
  r = ok(
    await lcall('board_reply', { to: 'chat', card: 'work', text: 'Stopping it now.' }),
    'and on the card it is about',
  );
  assert.match(r.body.results[0].summary, /^DRY RUN/);
  {
    const st = JSON.parse(fs.readFileSync(path.join(dir, 'store.json'), 'utf8')),
      sc = st.shadowCalls || [];
    assert.ok(
      !Object.values(st.comments).some(
        c => c.board === 'l' && (c.channel === 'operator-chat' || /Stopping it now/.test(c.text)),
      ),
      'the stand-in and the reply stay in the rehearsal',
    );
    assert.ok(
      sc.some(x => x.tool === 'board_post' && x.ok && /SHADOW-MARK|status/i.test(x.said)) &&
        sc.some(x => x.tool === 'board_relay' && x.ok) &&
        sc.some(x => x.tool === 'board_relay' && !x.ok) &&
        sc.filter(x => x.tool === 'board_reply' || x.tool === 'board_batch').every(x => x.ok),
      'the shadow trial keeps a record of each rehearsed call, refusals included: ' + JSON.stringify(sc.slice(-5)),
    );
  }

  // relay: only Owner's words or a prompt he sent, by ticket, once
  no(
    await call('board_relay', { source: await sidOf('delete all leads'), to: 'firstmate' }),
    /not Owner's words/,
    'a staff question is never relayed',
  );
  no(
    await call('board_prompt', { card: 'release-707', to: 'steward', purpose: 'Land it.', prompt: 'Land it.' }),
    /firstmate/,
    'unsupported prompt destination is refused',
  );
  await req(
    port,
    'POST',
    '/api/comments',
    { board: 't', text: 'Send this to the steward on my behalf, verbatim: land it.' },
    'OWNER',
  );
  {
    const tm = (await req(port, 'GET', '/api/comments?board=t&general=true', null, 'OWNER')).body.comments
      .filter(c => c.by === 'owner')
      .pop().sid;
    no(await call('board_relay', { source: tm, to: 'steward' }), /firstmate/, 'and nothing is relayed to it');
  }
  ok(
    await call('board_prompt', {
      card: 'release-707',
      to: 'firstmate',
      purpose: 'Land the release notes.',
      prompt: 'Write the release notes for 1.0.0.707.',
    }),
    'prompt',
  );
  const ps = (await req(port, 'GET', '/api/comments?board=t&cardId=t-release-707', null, 'OWNER')).body.comments.find(
    c => c.prompt,
  );
  no(await call('board_relay', { source: ps.sid }), /has not clicked Send/, 'an unsent prompt is not relayed');
  assert.equal((await req(port, 'POST', `/api/comments/${ps.id}/decide`, { choice: 'send' }, 'OWNER')).status, 200);
  r = ok(await call('board_relay', { source: ps.sid, context: 'CTX-MARK: the notes he approved' }), 'relay authorised');
  const tk = r.body.ticket;
  assert.equal(
    tk.text,
    'Write the release notes for 1.0.0.707.',
    'the ticket carries the prompt itself, not the wrapper',
  );
  // the context is the board's note: the ticket carries the text alone, and the receipt says so
  assert.ok(!JSON.stringify(tk).includes('CTX-MARK'), 'the context is not in what the tool server sends');
  assert.match(
    r.body.results[0].summary,
    /context stays on the board's record: the firstmate receives the text alone/,
    'the operator is told',
  );
  no(
    await call('_relay_result', { ticket: 'made-up', delivered: true }),
    /No such relay ticket/,
    'no record without a ticket the board issued',
  );
  const resultId = 'relay-result-' + tk.id;
  const resultArgs = { ticket: tk.id, delivered: true, detail: 'SENT' };
  const dryReceipt = ok(await call('_relay_result', { ...resultArgs, dry_run: true }), 'receipt rehearsal');
  assert.equal(dryReceipt.body.results[0].relay_receipt, undefined, 'a rehearsal acknowledges no delivery');
  const delivered = ok(await call('_relay_result', resultArgs, 'OPS', { id: resultId }), 'delivered');
  const acknowledgement = { id: resultId, ticket: tk.id, delivered: true };
  assert.deepEqual(delivered.body.results[0].relay_receipt, acknowledgement);
  const relayMessages = async () =>
    (await req(port, 'GET', '/api/comments?board=t', null, 'OWNER')).body.comments.filter(msg => msg.ticket === tk.id)
      .length;
  const messagesBeforeDuplicate = await relayMessages();
  const duplicate = ok(await call('_relay_result', resultArgs, 'OPS', { id: resultId }), 'duplicate receipt');
  assert.equal(duplicate.body.results[0].duplicate, true);
  assert.deepEqual(duplicate.body.results[0].relay_receipt, acknowledgement);
  assert.equal(await relayMessages(), messagesBeforeDuplicate, 'duplicate receipts do not duplicate board messages');
  assert.match(delivered.body.results[0].summary, /context is on the board's record only/, 'and again when it went');
  // a prompt under the card's open ask: one question, one ping, and his Send settles both
  ok(
    await call('board_batch', {
      calls: [
        {
          tool: 'board_ask',
          args: {
            card: 'release-707',
            question: 'Publish the notes now (A) or after the review (B)?',
            options: ['Now', 'After the review'],
            recommendation: 'A: they are short.',
          },
        },
        {
          tool: 'board_prompt',
          args: {
            card: 'release-707',
            to: 'firstmate',
            purpose: 'Option A: publish now.',
            prompt: 'Publish the release notes for 1.0.0.707.',
            for_ask: 'open',
          },
        },
      ],
    }),
    'an ask and its prompt in one batch',
  );
  {
    let st = await state();
    const op = st.cards['t-release-707'].decisions.filter(d => !d.resolvedAt);
    assert.equal(op.length, 1, 'one open ask, not two');
    assert.equal(op[0].kind, 'ask');
    assert.ok(op[0].promptId, 'the prompt sits under it');
    no(
      await call('board_prompt', { card: 'release-707', to: 'firstmate', purpose: 'x', prompt: 'y' }),
      /for_ask/,
      'without for_ask a second prompt is refused, and the refusal names the way',
    );
    no(
      await call('board_prompt', {
        card: 'release-707',
        to: 'firstmate',
        purpose: 'x',
        prompt: 'y',
        for_ask: 'open',
        replaces: op[0].sid,
      }),
      /not both/,
      'for_ask or replaces',
    );
    assert.equal(
      (await req(port, 'POST', `/api/comments/${op[0].promptId}/decide`, { choice: 'send' }, 'OWNER')).status,
      200,
    );
    st = await state();
    assert.ok(!st.cards['t-release-707'].decisions.some(d => !d.resolvedAt), 'his Send settles the ask');
  }
  no(await call('_relay_result', { ticket: tk.id, delivered: true }), /already reported/, 'a ticket is used once');
  assert.match(
    (await req(port, 'GET', '/api/comments?board=t&cardId=t-release-707', null, 'OWNER')).body.comments.find(
      c => c.label === 'RELAYED',
    ).text,
    /delivery reported by the operator's tool server/,
    'the record says whose report it is',
  );
  const sendMsg = (
    await req(port, 'GET', '/api/comments?board=t&cardId=t-release-707', null, 'OWNER')
  ).body.comments.find(c => c.kind === 'prompt-send');
  no(
    await call('board_relay', { source: sendMsg.sid, to: 'firstmate' }),
    /was relayed at/,
    'his Send is not a second source for the same words: it names the prompt, already relayed',
  );
  no(await call('board_relay', { source: ps.sid }), /was relayed at/, 'not twice without again');
  // his Send names the prompt it sends, so relaying the Send relays that prompt; and an ask after its own prompt
  // takes the prompt under it, one question, his Send settling it
  ok(
    await call('board_open', {
      title: 'Notes for 708',
      context: 'the next release',
      slug: 'notes-708',
      state: 'inflight',
    }),
    'open',
  );
  ok(
    await call('board_prompt', {
      card: 'notes-708',
      to: 'firstmate',
      purpose: 'Draft the notes.',
      prompt: 'Draft the release notes for 1.0.0.708.',
    }),
    'a prompt first',
  );
  {
    let st = await state();
    const pa = st.cards['t-notes-708'].decisions.find(d => !d.resolvedAt);
    assert.equal(pa.kind, 'prompt');
    r = ok(
      await call('board_ask', {
        card: 'notes-708',
        question: 'Draft them now (A) or after the freeze (B)?',
        options: ['Now', 'After the freeze'],
        recommendation: 'A: the freeze is a week off.',
      }),
      'an ask after its prompt',
    );
    assert.match(r.body.results[0].summary, /is under it: his Send sends it and settles the ask/);
    st = await state();
    const open = st.cards['t-notes-708'].decisions.filter(d => !d.resolvedAt);
    assert.equal(open.length, 1, 'one open ask');
    assert.equal(open[0].kind, 'ask');
    assert.equal(open[0].promptId, pa.commentId, 'the prompt sits under it');
    assert.equal(
      st.cards['t-notes-708'].decisions.find(d => d.id === pa.id).mergedInto,
      open[0].id,
      "the prompt's own ask went into it",
    );
    assert.equal(
      (await req(port, 'POST', `/api/comments/${pa.commentId}/decide`, { choice: 'send' }, 'OWNER')).status,
      200,
    );
    st = await state();
    assert.ok(!st.cards['t-notes-708'].decisions.some(d => !d.resolvedAt), 'his Send settles the ask');
  }
  {
    const cs = (await req(port, 'GET', '/api/comments?board=t&cardId=t-notes-708', null, 'OWNER')).body.comments,
      send = cs.find(c => c.kind === 'prompt-send'),
      pm = cs.find(c => c.label === 'PROMPT');
    r = ok(await call('board_relay', { source: send.sid }), 'relayed by naming his Send');
    assert.equal(r.body.results[0].ticket.text, 'Draft the release notes for 1.0.0.708.', 'the prompt itself goes');
    assert.match(r.body.results[0].summary, new RegExp('prompt ' + pm.sid + ', on his Send ' + send.sid));
    ok(
      await call('_relay_result', { ticket: r.body.results[0].ticket.id, delivered: true, detail: 'SENT' }),
      'delivered',
    );
  }
  ok(
    await call('board_prompt', {
      card: 'notes-708',
      to: 'firstmate',
      purpose: 'Publish.',
      prompt: 'Publish the notes.',
    }),
    'another prompt',
  );
  ok(
    await call('board_ask', { card: 'notes-708', question: 'Publish today?', recommendation: 'Yes.' }),
    'its ask takes it under',
  );
  no(
    await call('board_ask', { card: 'notes-708', question: 'And tweet it?', recommendation: 'No.' }),
    /already has an open ask/,
    'a second ask is still refused',
  );
  // an ask and its prompt in one batch: for_ask is understood, so the batch need not name it
  ok(
    await call('board_open', { title: 'Notes for 709', context: 'after that', slug: 'notes-709', state: 'inflight' }),
    'open',
  );
  ok(
    await call('board_batch', {
      calls: [
        { tool: 'board_ask', args: { card: 'notes-709', question: 'Draft now?', recommendation: 'Yes.' } },
        {
          tool: 'board_prompt',
          args: { card: 'notes-709', to: 'firstmate', purpose: 'Draft.', prompt: 'Draft the 709 notes.' },
        },
      ],
    }),
    'no for_ask needed in the same batch',
  );
  {
    const st = await state(),
      open = st.cards['t-notes-709'].decisions.filter(d => !d.resolvedAt);
    assert.equal(open.length, 1);
    assert.ok(open[0].promptId, 'the prompt sits under the ask');
  }
  no(
    await call('board_prompt', { card: 'notes-709', to: 'firstmate', purpose: 'x', prompt: 'y' }),
    /for_ask/,
    'outside the batch it still needs naming',
  );
  await req(
    port,
    'POST',
    '/api/comments',
    { cardId: 't-release-707', text: 'Send this to firstmate: hold the rollout.' },
    'OWNER',
  );
  const m5 = await sidOf('hold the rollout');
  await req(port, 'POST', '/api/comments', { cardId: 't-release-707', text: 'Actually, do not.' }, 'OWNER');
  r = no(
    await call('board_relay', { source: m5, to: 'firstmate' }),
    /Owner wrote after/,
    'never relay words he has since overtaken',
  );
  const later = /pass seen: \["([a-z2-9]+)"\]/.exec(r.body.results[0].reason)[1];
  r = ok(await call('board_relay', { source: m5, to: 'firstmate', seen: [later] }), 'read and named, it goes');
  assert.equal(r.body.ticket.text, 'Send this to firstmate: hold the rollout.');
};
