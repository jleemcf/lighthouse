'use strict';
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { req, rawReq, wait } = require('../helpers');

// The board end to end, last part: Owner's words answered by the operator's next line on a card and in General;
// pictures; bundles and repeated sends; the change feed; the store on disk; the archive of finished cards.
module.exports = async function conversation(ctx) {
  const { port, dir, cid } = ctx;
  let r;
  // the board is another route for Owner's words: his unanswered message on a card is answered by the operator's
  // next line about that card
  r = await req(port, 'POST', '/api/comments', { cardId: 't-op-cleanup', text: 'when will this start?' }, 'OWNER');
  assert.equal(r.status, 201);
  const askId = r.body.id;
  r = await req(
    port,
    'POST',
    '/api/boards/t/events',
    { rows: [{ label: 'FYI', task: 'op-cleanup', text: 'Tomorrow morning, after the archive run.' }] },
    'OPS',
  );
  assert.ok(r.body.results[0].ok, JSON.stringify(r.body));
  r = await req(port, 'GET', '/api/comments?cardId=t-op-cleanup', null, 'OWNER');
  const reply = (r.body.comments || []).find(x => x.replyTo === askId);
  assert.ok(
    reply && reply.by === 'op-test' && reply.text === 'Tomorrow morning, after the archive run.',
    'the line became the answer in the conversation',
  );
  assert.ok((r.body.comments || []).find(x => x.id === askId).handled, "Owner's message is handled by that line");
  r = await req(
    port,
    'POST',
    '/api/boards/t/events',
    { rows: [{ label: 'FYI', task: 'op-cleanup', text: 'Still on.' }] },
    'OPS',
  );
  r = await req(port, 'GET', '/api/comments?cardId=t-op-cleanup', null, 'OWNER');
  assert.equal(
    (r.body.comments || []).length,
    3,
    'a later FYI with nothing unanswered adds no comment; the earlier REPLY ("Owner chose seven days") is a ' +
      'message even though nothing was unanswered then',
  );

  // the general conversation: Owner's naked words with an image, not tied to a card; answered by the operator's
  // next line
  const png = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');
  const up = await rawReq(
    port,
    'POST',
    '/api/attachments',
    png,
    { 'Content-Type': 'image/png', 'X-Name': 'dot.png' },
    'OWNER',
  );
  assert.equal(up.status, 201, up.raw);
  const attId = up.body.id;
  const bad = await rawReq(
    port,
    'POST',
    '/api/attachments',
    Buffer.from('hello'),
    { 'Content-Type': 'application/zip' },
    'OWNER',
  );
  assert.equal(bad.status, 415, 'a type the board does not take is refused');
  r = await req(port, 'POST', '/api/comments', { board: 't', text: 'how are things?', attachments: [attId] }, 'OWNER');
  assert.equal(r.status, 201, r.raw);
  assert.equal(r.body.cardId, null);
  assert.equal(r.body.attachments[0].name, 'dot.png');
  const gid = r.body.id;
  r = await req(port, 'GET', '/api/comments?board=t&general=true', null, 'VIEW');
  const g0 = r.body.comments.length;
  assert.equal(r.body.comments.find(x => x.id === gid).handled, false);
  const dl = await rawReq(port, 'GET', '/api/attachments/' + attId, null, {}, 'VIEW');
  assert.equal(dl.status, 200);
  assert.equal(dl.buf.length, png.length);
  assert.equal(dl.headers['content-type'], 'image/png');
  const nodl = await rawReq(port, 'GET', '/api/attachments/' + attId, null, {}, null);
  assert.equal(nodl.status, 401, 'no identity, no image');
  r = await req(
    port,
    'POST',
    '/api/boards/t/events',
    { rows: [{ label: 'FYI', task: 'general', text: 'Quiet; firstmate is idle.' }] },
    'OPS',
  );
  assert.ok(r.body.results[0].ok, JSON.stringify(r.body));
  r = await req(port, 'GET', '/api/comments?board=t&general=true', null, 'OWNER');
  assert.equal(r.body.comments.length, g0 + 1, 'the general line became the reply');
  assert.ok(r.body.comments.find(x => x.id === gid).handled, 'and handled the message');
  assert.equal(r.body.comments.find(x => x.replyTo === gid).text, 'Quiet; firstmate is idle.');
  r = await req(port, 'GET', '/api/state', null, 'OWNER');
  assert.ok(Date.parse(r.body.boards.t.shift.lastSeen) > 0, 'presence read: the shift has a last-seen time');
  assert.equal(r.body.boards.t.shift.state, 'off', 'a general line does not start a shift');
  r = await req(port, 'POST', '/api/comments', { board: 't', text: 'and the marker task?' }, 'OWNER');
  const gid2 = r.body.id;
  r = await req(
    port,
    'POST',
    '/api/boards/t/events',
    { rows: [{ label: 'STATUS', task: 'op-cleanup', text: 'Still queued; nothing started.' }] },
    'OPS',
  );
  r = await req(port, 'GET', '/api/comments?board=t&general=true', null, 'OWNER');
  assert.ok(!r.body.comments.find(x => x.replyTo === gid2), 'a line naming a task does not answer a general message');
  r = await req(
    port,
    'POST',
    '/api/boards/t/events',
    { rows: [{ label: 'FYI', task: 'general', text: 'Nothing started yet.' }] },
    'OPS',
  );
  r = await req(port, 'GET', '/api/comments?board=t&general=true', null, 'OWNER');
  assert.equal(
    r.body.comments.find(x => x.replyTo === gid2).text,
    'Nothing started yet.',
    'the next general line answers it',
  );
  assert.equal(r.body.comments.length, g0 + 3, 'every general line is a message in the general conversation');
  assert.equal(r.body.comments[r.body.comments.length - 1].label, 'FYI', 'tagged with its label');
  r = await req(
    port,
    'POST',
    '/api/boards/t/events',
    { rows: [{ label: 'FYI', task: 'general', text: 'Firstmate acknowledged the test.', untagged: true }] },
    'OPS',
  );
  r = await req(port, 'GET', '/api/comments?board=t&general=true', null, 'OWNER');
  assert.ok(r.body.comments[r.body.comments.length - 1].untagged, 'untagged prose reaches the General box, marked');
  r = await req(
    port,
    'POST',
    '/api/boards/t/events',
    {
      rows: [
        {
          label: 'STATUS',
          task: 'op-cleanup',
          text: 'Queued, nothing started.',
          body: '**Why:**\n- the archive run comes first',
        },
        { label: 'FYI', task: 'general', text: 'Summary.', body: '**What I found**\n- a\n- b' },
      ],
    },
    'OPS',
  );
  r = await req(port, 'GET', '/api/state', null, 'OWNER');
  assert.equal(r.body.cards['t-op-cleanup'].description, 'Queued, nothing started.');
  assert.equal(
    r.body.cards['t-op-cleanup'].detail,
    '**Why:**\n- the archive run comes first',
    'the body beneath a STATUS is the card detail',
  );
  assert.equal(
    r.body.cards['t-op-cleanup'].log[r.body.cards['t-op-cleanup'].log.length - 1].body,
    '**Why:**\n- the archive run comes first',
    'and travels with the log entry',
  );
  r = await req(port, 'GET', '/api/comments?board=t&general=true', null, 'OWNER');
  assert.equal(
    r.body.comments[r.body.comments.length - 1].text,
    'Summary.\n\n**What I found**\n- a\n- b',
    'a General message keeps its structure',
  );
  // the operator decides which task Owner's words concern: a task-named line written in answer to a General message
  // comes back to General
  r = await req(port, 'POST', '/api/comments', { board: 't', text: 'what about the cleanup?' }, 'OWNER');
  const gid3 = r.body.id;
  r = await req(
    port,
    'POST',
    '/api/boards/t/events',
    { rows: [{ label: 'STATUS', task: 'op-cleanup', text: 'Cleanup is still queued.', re: ['general'] }] },
    'OPS',
  );
  r = await req(port, 'GET', '/api/comments?board=t&general=true', null, 'OWNER');
  const back = r.body.comments.find(x => x.replyTo === gid3);
  assert.ok(
    back && back.text === 'Cleanup is still queued.' && back.about === 'op-cleanup',
    'the task-named answer landed in General, marked with its task',
  );
  r = await req(port, 'POST', '/api/comments', { cardId: 't-op-cleanup', text: 'and overall?' }, 'OWNER');
  const cid3 = r.body.id;
  r = await req(
    port,
    'POST',
    '/api/boards/t/events',
    { rows: [{ label: 'FYI', task: 'general', text: 'Overall quiet.', re: ['op-cleanup'] }] },
    'OPS',
  );
  r = await req(port, 'GET', '/api/comments?cardId=t-op-cleanup', null, 'OWNER');
  assert.equal(
    (r.body.comments.find(x => x.replyTo === cid3) || {}).text,
    'Overall quiet.',
    'a general line written in answer to a card message lands on that card',
  );
  assert.equal(
    (await req(port, 'GET', '/api/state', null, 'OWNER')).body.cards['t-op-cleanup'].messageTimes.length,
    1,
    'a reply delivered from General flags the target card',
  );
  // a bundle: one message from Owner addressing a task and a general part; each answer lands only where it belongs
  r = await req(
    port,
    'POST',
    '/api/bundles',
    {
      board: 't',
      parts: [{ cardId: 't-op-cleanup', text: 'when does cleanup start?' }, { text: 'and how is the fleet?' }],
    },
    'OWNER',
  );
  assert.equal(r.status, 201, r.raw);
  const bId = r.body.bundleId;
  assert.equal(r.body.parts.length, 2);
  r = await req(port, 'GET', '/api/comments?board=t&bundleId=' + bId, null, 'OWNER');
  assert.equal(r.body.comments.length, 2);
  assert.ok(
    r.body.comments.every(x => x.bundleId === bId && x.bundleSize === 2 && !x.handled),
    'two unanswered parts share the bundle id',
  );
  r = await req(port, 'GET', '/api/changes?since=0', null, 'OPS');
  assert.ok(
    r.body.changes.some(x => x.kind === 'bundle' && x.id === bId),
    'one bundle change in the feed',
  );
  r = await req(
    port,
    'POST',
    '/api/boards/t/events',
    {
      rows: [
        { label: 'REPLY', task: 'op-cleanup', text: 'Cleanup starts tomorrow.', re: ['op-cleanup', 'general'] },
        { label: 'FYI', task: 'general', text: 'The fleet is idle.', re: ['op-cleanup', 'general'] },
      ],
    },
    'OPS',
  );
  r = await req(port, 'GET', '/api/comments?cardId=t-op-cleanup', null, 'OWNER');
  assert.ok(
    r.body.comments.some(x => x.text === 'Cleanup starts tomorrow.') &&
      !r.body.comments.some(x => x.text === 'The fleet is idle.'),
    'the task part got its own answer and nothing else',
  );
  assert.ok(r.body.comments.find(x => x.bundleId === bId).handled, 'the task part is handled');
  r = await req(port, 'GET', '/api/comments?board=t&general=true', null, 'OWNER');
  assert.ok(
    r.body.comments.some(x => x.text === 'The fleet is idle.') &&
      !r.body.comments.some(x => x.text === 'Cleanup starts tomorrow.'),
    'the general part got the general answer and nothing else',
  );
  r = await req(port, 'POST', '/api/bundles', { board: 't', parts: [{ cardId: 't-never', text: 'x' }] }, 'OWNER');
  assert.equal(r.status, 404, 'an unknown task is refused');
  // a send whose answer was lost: the page tries the same words with the same sendId, and the board makes nothing
  // twice
  {
    const n0 = Object.keys((await req(port, 'GET', '/api/comments?board=t', null, 'OWNER')).body.comments).length;
    const once = await req(
      port,
      'POST',
      '/api/bundles',
      { board: 't', parts: [{ cardId: 't-op-cleanup', text: 'twice?' }], sendId: 'send-abc-12345' },
      'OWNER',
    );
    assert.equal(once.status, 201);
    const again = await req(
      port,
      'POST',
      '/api/bundles',
      { board: 't', parts: [{ cardId: 't-op-cleanup', text: 'twice?' }], sendId: 'send-abc-12345' },
      'OWNER',
    );
    assert.equal(again.status, 200);
    assert.equal(again.body.bundleId, once.body.bundleId, 'the same bundle comes back');
    const c1 = await req(
        port,
        'POST',
        '/api/comments',
        { cardId: 't-op-cleanup', text: 'once only', sendId: 'send-def-12345' },
        'OWNER',
      ),
      c2 = await req(
        port,
        'POST',
        '/api/comments',
        { cardId: 't-op-cleanup', text: 'once only', sendId: 'send-def-12345' },
        'OWNER',
      );
    assert.equal(c2.body.id, c1.body.id, 'and the same message');
    const n1 = Object.keys((await req(port, 'GET', '/api/comments?board=t', null, 'OWNER')).body.comments).length;
    assert.equal(n1, n0 + 2, 'one bundle part and one message, not four');
    const other = await req(
      port,
      'POST',
      '/api/bundles',
      { board: 't', parts: [{ cardId: 't-op-cleanup', text: 'twice?' }], sendId: 'send-xyz-12345' },
      'OWNER',
    );
    assert.notEqual(other.body.bundleId, once.body.bundleId, 'a new send is new');
  }
  // each part of a bundle carries its own images; an image alone is a part
  r = await req(
    port,
    'POST',
    '/api/bundles',
    {
      board: 't',
      parts: [
        { cardId: 't-op-cleanup', text: 'see this', attachments: [attId] },
        { text: '', attachments: [attId] },
      ],
    },
    'OWNER',
  );
  assert.equal(r.status, 201, r.raw);
  assert.equal(r.body.parts.length, 2);
  assert.ok(
    r.body.parts[0].cardId === 't-op-cleanup' &&
      r.body.parts[0].attachments.length === 1 &&
      r.body.parts[0].attachments[0].id === attId,
    'the task part keeps its own image',
  );
  assert.ok(
    r.body.parts[1].cardId === null && r.body.parts[1].attachments.length === 1 && r.body.parts[1].text === '',
    'an image alone makes a general part',
  );
  r = await req(
    port,
    'POST',
    '/api/comments',
    { board: 't', text: 'Please open a task.', kind: 'task-request' },
    'OWNER',
  );
  assert.equal(r.body.kind, 'task-request', 'a task request keeps its kind');
  r = await req(port, 'GET', '/api/state', null, 'OWNER');
  assert.ok(
    Array.isArray(r.body.recent) && r.body.recent.length >= 3 && r.body.recent[0].t >= r.body.recent[1].t,
    'state carries the newest messages for the feed',
  );
  assert.ok('weather' in r.body && r.body.weather === null, 'state carries the weather, null when none is configured');
  r = await req(port, 'GET', '/api/weather', null, 'OWNER');
  assert.equal(r.status, 200);
  assert.equal(r.body.configured, false);

  // change feed
  r = await req(port, 'GET', '/api/changes?since=0', null, 'OPS');
  assert.ok(r.body.changes.length >= 6);
  assert.equal(r.body.changes[0].seq, 1);
  const last = r.body.seq;
  r = await req(port, 'GET', '/api/changes?since=' + last, null, 'OPS');
  assert.equal(r.body.changes.length, 0);

  // store persisted
  await wait(400);
  const store = JSON.parse(fs.readFileSync(path.join(dir, 'store.json'), 'utf8'));
  assert.ok(store.cards['t-task1'] && store.comments[cid]);

  // archive on Done: the finished card and its comments leave the store into one JSON file under archive/<board>/
  r = await req(port, 'POST', '/api/boards/t/archive', { days: 0 }, 'VIEW');
  assert.equal(r.status, 403, 'a viewer cannot archive');
  r = await req(port, 'POST', '/api/boards/t/archive', { days: 0 }, 'OPS');
  assert.equal(r.status, 200);
  assert.ok(r.body.archived.includes('t-task1'), JSON.stringify(r.body));
  assert.ok(
    r.body.archived.some(x => String(x).startsWith('general:')),
    'old general messages archived too',
  );
  r = await req(port, 'GET', '/api/state', null, 'OWNER');
  assert.ok(!r.body.cards['t-task1'], 'the archived card left the store');
  assert.ok(r.body.cards['t-op-cleanup'], 'a queued card stays');
  const arch = JSON.parse(fs.readFileSync(path.join(dir, 'archive', 't', 't-task1.json'), 'utf8'));
  assert.equal(arch.card.id, 't-task1');
  assert.ok(
    arch.comments.some(x => x.id === cid),
    'its comments travel with it',
  );
  r = await req(port, 'GET', '/api/comments?cardId=t-task1', null, 'OWNER');
  assert.equal((r.body.comments || []).length, 0, 'the comments left the store too');
  assert.ok(
    fs.readdirSync(path.join(dir, 'archive', 't')).some(f => f.startsWith('general-')),
    'the general archive file exists',
  );
  r = await req(port, 'GET', '/api/comments?board=t&general=true', null, 'OWNER');
  assert.equal((r.body.comments || []).length, 0, 'the General box was emptied into the archive');
};
