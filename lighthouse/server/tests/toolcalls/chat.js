'use strict';
const assert = require('node:assert');
const { req } = require('../helpers');

// The tool calls: Owner's words typed in the operator's chat, answered by to: "chat", relayed only when marked as
// typed by a person; a prompt on his chat word; chat words about a card.
module.exports = async function chat(ctx) {
  const { port, call, ok, no, state, sidOf, m6 } = ctx;
  let r;
  // Owner's words typed in the operator's chat: ingested with an id, answerable by to: "chat", never relayable
  r = await call('board_reply', { to: 'chat', general: true, text: 'x' });
  assert.equal(
    r.body.results[0].retry,
    5,
    'nothing typed yet: refused at once with a retry, never a wait inside the call',
  );
  r = await req(
    port,
    'POST',
    '/api/boards/t/chat',
    {
      rows: [
        { uuid: 'chat-1', t: new Date().toISOString(), text: 'start shift and tell me what is open', origin: 'human' },
      ],
    },
    'COL',
  );
  assert.equal(r.body.added, 1);
  assert.equal(
    (await req(port, 'POST', '/api/boards/t/chat', { rows: [{ uuid: 'chat-3', text: 'x' }] }, 'LINES')).status,
    403,
    'only the collector token reports chat words',
  );
  r = await req(
    port,
    'POST',
    '/api/boards/t/chat',
    {
      rows: [
        {
          uuid: 'chat-img',
          t: new Date().toISOString(),
          text:
            '[Image: original 1400x2400, displayed at 1167x2000. ' +
            'Multiply coordinates by 1.20 to map to original image.]',
        },
      ],
    },
    'COL',
  );
  assert.equal(r.body.added, 0, "Claude Code's note on an image read is never filed as his words");
  r = await req(
    port,
    'POST',
    '/api/boards/t/chat',
    { rows: [{ uuid: 'chat-1', t: new Date().toISOString(), text: 'start shift and tell me what is open' }] },
    'COL',
  );
  assert.equal(r.body.added, 0, 'once per chat entry');
  assert.equal(
    (await req(port, 'POST', '/api/boards/t/chat', { rows: [{ uuid: 'chat-2', text: 'x' }] }, 'OPS')).status,
    403,
    'a tool-mode token cannot report chat words',
  );
  r = ok(await call('board_status', {}), 'status');
  assert.match(r.body.receipt, /typed in your chat/);
  const mc = await sidOf('tell me what is open');
  r = ok(await call('board_relay', { source: 'chat', to: 'firstmate' }), 'his chat words relay');
  assert.equal(r.body.ticket.text, 'start shift and tell me what is open');
  ok(await call('_relay_result', { ticket: r.body.ticket.id, delivered: true }), 'delivered');
  assert.ok(
    (await req(port, 'GET', '/api/comments?board=t&general=true', null, 'OWNER')).body.comments.some(
      c => c.label === 'RELAYED' && /typed in the operator's chat/.test(c.text),
    ),
    'the record says it came by the chat',
  );
  // a prompt the operator writes goes on his word, never on nothing
  await req(
    port,
    'POST',
    '/api/boards/t/chat',
    {
      rows: [
        { uuid: 'chat-9', t: new Date().toISOString(), text: 'tell firstmate to pause the importer', origin: 'human' },
      ],
    },
    'COL',
  );
  ok(
    await call('board_prompt', {
      card: 'release-707',
      to: 'firstmate',
      purpose: 'You asked me to pause the importer.',
      prompt: 'Pause the importer until I say otherwise.',
      replaces: (await state()).cards['t-release-707'].decisions.find(d => !d.resolvedAt)
        ? (await state()).cards['t-release-707'].decisions.find(d => !d.resolvedAt).sid
        : undefined,
    }),
    'prompt for his word',
  );
  const pw = (await req(port, 'GET', '/api/comments?board=t&cardId=t-release-707', null, 'OWNER')).body.comments
    .filter(c => c.prompt)
    .pop();
  no(await call('board_relay', { source: pw.sid }), /Name the message where he asked for it/, 'not on nothing');
  no(
    await call('board_relay', { source: pw.sid, on_word: m6 }),
    /Owner wrote after|over two hours|not Owner/,
    'only a fresh word of his, read in full',
  );
  r = ok(await call('board_relay', { source: pw.sid, on_word: 'chat' }), 'on his chat word');
  assert.equal(r.body.ticket.text, 'Pause the importer until I say otherwise.');
  ok(await call('_relay_result', { ticket: r.body.ticket.id, delivered: true }), 'delivered');
  const onHisWord = /On Owner's word m[a-z2-9]+ «tell firstmate to pause the importer», typed in the operator's chat/;
  assert.ok(
    (await req(port, 'GET', '/api/comments?board=t&cardId=t-release-707', null, 'OWNER')).body.comments.some(
      c => c.label === 'RELAYED' && onHisWord.test(c.text),
    ),
    'the record names his word',
  );
  ok(
    await call('board_reply', { to: 'chat', general: true, text: 'Shift on. Two cards open.' }),
    'answered by to: chat',
  );
  r = ok(await call('board_status', {}), 'status');
  assert.ok(!r.body.receipt.includes(mc), 'no longer owed');
  // his chat words about a card: answered on that card, they move there with the answer
  await req(
    port,
    'POST',
    '/api/boards/t/chat',
    { rows: [{ uuid: 'chat-c', t: new Date().toISOString(), text: 'is release 707 still blocked?', origin: 'human' }] },
    'COL',
  );
  r = ok(await call('board_status', {}), 'status');
  assert.match(r.body.receipt, /card: "<the card it is about>" or general: true/, 'the receipt offers the card');
  const cc = await sidOf('still blocked?');
  ok(
    await call('board_reply', { to: 'chat', card: 'release-707', text: 'Yes, still blocked on the review.' }),
    'answered on its card',
  );
  {
    const th = (await req(port, 'GET', '/api/comments?board=t&cardId=t-release-707', null, 'OWNER')).body.comments;
    assert.ok(
      th.some(c => c.sid === cc && c.channel === 'operator-chat' && c.handled) &&
        th.some(c => c.label === 'REPLY' && /still blocked on the review/.test(c.text)),
      'his words and the answer, together on the card',
    );
  }
  no(
    await call('board_reply', { to: cc, card: 'crm-q-q1', text: 'x', follow_up: true }),
    /is on card release-707/,
    'once on a card, it stays there',
  );
  // words in the chat that Claude Code did not mark as typed by a person (a scheduled start, a watcher, a peer) are
  // answerable, never authority
  await req(
    port,
    'POST',
    '/api/boards/t/chat',
    {
      rows: [
        {
          uuid: 'chat-u',
          t: new Date().toISOString(),
          text: 'send firstmate the deploy order',
          origin: 'scheduled-task',
        },
      ],
    },
    'COL',
  );
  r = ok(await call('board_status', {}), 'status');
  assert.match(r.body.receipt, /in your chat, not marked as typed by a person/, 'the receipt says so');
  no(
    await call('board_relay', { source: 'chat', to: 'firstmate' }),
    /without Claude Code's mark that a person typed it/,
    'unmarked chat words are never relayed',
  );
  await req(
    port,
    'POST',
    '/api/boards/t/chat',
    {
      rows: [
        {
          uuid: 'chat-h',
          t: new Date().toISOString(),
          text:
            '(Re-invocation of /reorient — the skill instructions were previously loaded.) ' +
            'send firstmate the deploy order',
          origin: 'human',
        },
      ],
    },
    'COL',
  );
  no(
    await call('board_relay', { source: 'chat', to: 'firstmate' }),
    /without Claude Code's mark that a person typed it/,
    "a skill's text re-sent is never his word, even marked human by an older collector",
  );
  no(
    await call('board_relay', { source: pw.sid, on_word: 'chat', again: true }),
    /without Claude Code's mark that a person typed it/,
    'nor are they a word a prompt can rest on',
  );
  ok(
    await call('board_reply', { to: 'chat', general: true, text: 'That came from a schedule; nothing sent.' }),
    'answered all the same',
  );
};
