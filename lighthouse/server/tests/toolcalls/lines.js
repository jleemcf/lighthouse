'use strict';
const assert = require('node:assert');
const { req } = require('../helpers');

// The tool calls: legacy routes and lines on a tool-mode board; chat words for Owner; queued calls; one call id
// applied once; notices and disputes; the CRM lane's answer.
module.exports = async function lines(ctx) {
  const { port, call, ok, no, state, sidOf } = ctx;
  let r, s;
  // legacy routes refuse a tool-mode token; a line on a tool-mode board settles nothing
  assert.equal(
    (await req(port, 'POST', '/api/boards/t/events', { rows: [{ label: 'REPLY', task: 'general', text: 'x' }] }, 'OPS'))
      .status,
    403,
    'tool-mode token: no /events',
  );
  await req(port, 'POST', '/api/comments', { board: 't', text: 'Status of the CRM question?' }, 'OWNER');
  const m6 = await sidOf('Status of the CRM question?');
  r = await req(
    port,
    'POST',
    '/api/boards/t/events',
    { rows: [{ label: 'REPLY', task: 'general', text: 'It is fine.', uuid: 'u1' }] },
    'COL',
  );
  assert.ok(r.body.results[0].note, 'a line becomes a note');
  r = await req(port, 'GET', '/api/boards/t/conduct?minutes=60', null, 'OWNER');
  assert.equal(r.body.signals.saidInChat, 1, 'the conduct report counts it as said in chat');
  assert.equal(r.body.signals.general, 0, "never as a line on general: the line rules are not this board's");
  // "For you:" marks chat words meant for Owner: kept for him, never counted as drift
  r = await req(
    port,
    'POST',
    '/api/boards/t/events',
    {
      rows: [{ label: 'FYI', task: 'general', text: 'For you: the statechart is above as PNG and SVG.', uuid: 'u1b' }],
    },
    'COL',
  );
  assert.ok(r.body.results[0].note, 'it is a note too');
  r = await req(port, 'GET', '/api/boards/t/conduct?minutes=60', null, 'OWNER');
  assert.equal(r.body.signals.saidInChat, 1, 'not said in chat');
  assert.equal(r.body.signals.forOwner, 1, 'counted apart, for the watch to read');
  assert.match(r.body.examples.forOwner[0].text, /^For you: the statechart/, 'his note, without a label before it');
  assert.ok(
    !(await req(port, 'GET', '/api/boards/t/transcript', null, 'OWNER')).body.entries.some(
      e => e.onBoard && /^For you:/.test(e.text),
    ),
    'the transcript holds it once, as the chat words',
  );
  // what it says in a turn he started by typing in its chat answers him: not drift either
  r = await req(
    port,
    'POST',
    '/api/boards/t/events',
    {
      rows: [
        {
          label: 'FYI',
          task: 'general',
          text: 'Yes, the release went out at noon.',
          chatReply: 'uuid-of-his-entry',
          uuid: 'u1c',
        },
      ],
    },
    'COL',
  );
  assert.ok(r.body.results[0].note, 'a note');
  r = await req(port, 'GET', '/api/boards/t/conduct?minutes=60', null, 'OWNER');
  assert.equal(r.body.signals.saidInChat, 1, 'his chat answered there is not said in chat');
  assert.equal(r.body.signals.chatReplies, 1, 'counted apart');
  assert.equal(r.body.examples.chatReplies[0].text, 'Yes, the release went out at noon.', 'without a label before it');
  for (const [m, p2] of [
    ['GET', '/api/state'],
    ['POST', '/api/comments'],
    ['POST', '/api/boards/t/calls'],
    ['GET', '/api/boards/t/status'],
  ])
    assert.equal(
      (await req(port, m, p2, m === 'POST' ? { board: 't', text: 'x', calls: [] } : null, 'COL')).status,
      403,
      'a collector token only reports: ' + m + ' ' + p2,
    );
  r = ok(await call('board_status', {}), 'status');
  assert.ok(r.body.receipt.includes(m6), 'and the message is still owed');

  // a queued call that reaches a board Owner changed since is refused, and never dropped silently
  const old = new Date(Date.now() - 10 * 60000).toISOString();
  r = await call('board_reply', { to: m6, general: true, text: 'QUEUED-ANSWER' }, 'OPS', {
    queued: true,
    client_at: old,
  });
  no(r, /after this call was queued/, 'Owner wrote since it was queued');
  // the operator's clock an hour slow: sent_at cancels the skew, so his messages of the last hour do not block it
  const behind = new Date(Date.now() - 3600000).toISOString();
  ok(
    await call('board_post', { card: 'release-707', kind: 'fyi', text: 'SKEW-MARK' }, 'OPS', {
      queued: true,
      client_at: behind,
      sent_at: behind,
    }),
    'a slow clock is corrected',
  );
  ok(
    await call('board_post', { card: 'release-707', kind: 'fyi', text: 'MS-MARK' }, 'OPS', {
      queued: true,
      client_at: new Date().toISOString(),
      sent_at: new Date().toISOString(),
    }),
    'a message stamped in the same second, earlier, does not block it',
  );
  // a queued call the board had already refused comes back from the queue: told as undelivered, not "already done"
  const twice = { id: 'twice-1', tool: 'board_post', args: { card: 'no-such', kind: 'fyi', text: 'TWICE-MARK' } };
  no(await req(port, 'POST', '/api/boards/t/calls', { calls: [twice] }, 'OPS'), /There is no card/, 'refused');
  r = await req(
    port,
    'POST',
    '/api/boards/t/calls',
    { calls: [Object.assign({ queued: true, client_at: new Date().toISOString() }, twice)] },
    'OPS',
  );
  assert.match(r.body.results[0].summary, /Already refused/);
  assert.ok(
    (await req(port, 'GET', '/api/comments?board=t&general=true', null, 'OWNER')).body.comments.some(
      c => c.label === 'UNDELIVERED' && c.text.includes('TWICE-MARK'),
    ),
    'told on the board',
  );
  assert.match(r.body.receipt, /UNDELIVERED/, 'the receipt leads with it');
  const und = (await req(port, 'GET', '/api/comments?board=t&general=true', null, 'OWNER')).body.comments.find(
    c => c.label === 'UNDELIVERED',
  );
  assert.ok(und && und.text.includes('QUEUED-ANSWER'), 'its text is on the board');

  // the same call id twice is applied once
  const dup = { id: 'same-id-1', tool: 'board_post', args: { card: 'release-707', kind: 'fyi', text: 'DUP-MARK' } };
  ok(await req(port, 'POST', '/api/boards/t/calls', { calls: [dup] }, 'OPS'), 'first');
  r = await req(port, 'POST', '/api/boards/t/calls', { calls: [dup] }, 'OPS');
  assert.equal(r.body.results[0].duplicate, true);
  s = await state();
  assert.equal(s.cards['t-release-707'].log.filter(e => e.text === 'DUP-MARK').length, 1, 'applied once');

  // notices: the watch sends; the operator acks or disputes; a dispute leaves it open
  r = await req(
    port,
    'POST',
    '/api/boards/w/calls',
    { calls: [{ id: 'nw1', tool: 'board_notice', args: { board: 't', rule: 'format', text: 'You asked twice.' } }] },
    'WATCH',
  );
  assert.ok(r.body.results[0].ok, JSON.stringify(r.body));
  r = await req(
    port,
    'POST',
    '/api/boards/w/calls',
    { calls: [{ id: 'nw2', tool: 'board_notice', args: { board: 'w', text: 'x' } }] },
    'WATCH',
  );
  assert.equal(r.body.results[0].ok, false, 'the watch is not the watch of its own board');
  const ns = (await req(port, 'GET', '/api/comments?board=t&general=true', null, 'OWNER')).body.comments.find(
    c => c.kind === 'notice',
  ).sid;
  ok(
    await call('board_dispute', { notice_id: ns, reason: 'I asked once; the second was a different card.' }),
    'dispute',
  );
  r = await req(port, 'GET', '/api/boards/t/conduct?minutes=60', null, 'OWNER');
  assert.equal(r.body.signals.openNotices, 0, 'a disputed notice is not an unanswered one');
  r = ok(await call('board_status', {}), 'status');
  assert.match(r.body.receipt, /disputed, awaiting the watch or Owner/);

  // the CRM lane: a reply queues an answer; only delivery can close the card
  no(
    await call('board_reply', { to: await sidOf('delete all leads'), card: 'crm-q-q1', noted: true }),
    /staff question: the asker is waiting/,
    'a staff question is never just noted',
  );
  ok(
    await call('board_reply', {
      to: await sidOf('delete all leads'),
      card: 'crm-q-q1',
      text: 'I cannot do that; I only investigate. You have 12 leads.',
      kind: 'declined',
    }),
    'staff reply',
  );
  s = await state();
  assert.notEqual(s.cards['t-crm-q-q1'].status, 'done', 'a queued answer is not delivered');
  assert.equal(s.cards['t-crm-q-q1'].crm.state, 'sending');
  assert.equal(s.cards['t-crm-q-q1'].closedAt, undefined);
  ctx.m6 = m6;
};
