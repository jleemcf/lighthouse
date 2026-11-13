'use strict';
const { testPort, spawnServer } = require('../../../tests/sandbox.cjs');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { req, rawReq, wait } = require('../helpers');

// The CRM question lane: fetch, the staff line, received and working, the answer with its file, needs_owner,
// retries by id, and a refusal that is not lost silently.
module.exports = async function crm(ctx) {
  const { t } = ctx;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lhsrv-'));
  const port = await testPort();
  // a stand-in CRM: one question, served once; acks and replies recorded; the first reply answered 500 once
  const crm = { acks: [], replies: [], served: false, fail: 1 };
  const svc = http.createServer((rq, rs) => {
    const ch = [];
    rq.on('data', c => ch.push(c));
    rq.on('end', () => {
      const body = ch.length ? JSON.parse(Buffer.concat(ch).toString()) : null;
      const auth = rq.headers.authorization;
      if (auth !== 'Bearer CRMKEY') {
        rs.writeHead(401);
        return rs.end('{"error":"bad key"}');
      }
      if (rq.method === 'GET' && rq.url.startsWith('/api/operator-questions')) {
        const qs = crm.served
          ? crm.q2 && !crm.served2
            ? ((crm.served2 = true),
              [
                {
                  id: 'q_78',
                  askedAt: '2026-10-12T20:00:00Z',
                  asker: { name: 'Alex', role: 'lead' },
                  scope: { summary: 'Team lead: sees the team.' },
                  text: 'Can you add a column for lead source to my view?',
                },
              ])
            : []
          : [
              {
                id: 'q_77',
                askedAt: '2026-10-12T19:40:00Z',
                asker: { name: 'Sam', role: 'rep' },
                scope: { summary: 'This person can see only their own leads; answer only within that.' },
                text: 'How many type X leads do I have? Please list them.',
                status: 'open',
              },
            ];
        crm.served = true;
        rs.writeHead(200, { 'Content-Type': 'application/json' });
        return rs.end(JSON.stringify({ cursor: 'c2', questions: qs }));
      }
      const m = /^\/api\/operator-questions\/([^/]+)\/(ack|reply)$/.exec(rq.url);
      if (m && rq.method === 'POST') {
        if (m[2] === 'reply' && crm.refuse) {
          rs.writeHead(422);
          return rs.end('{"error":"no corrections in phase 1"}');
        }
        if (m[2] === 'reply' && crm.fail > 0) {
          crm.fail--;
          rs.writeHead(500);
          return rs.end('{"error":"flaky"}');
        }
        (m[2] === 'ack' ? crm.acks : crm.replies).push(Object.assign({ qid: m[1] }, body));
        rs.writeHead(200, { 'Content-Type': 'application/json' });
        return rs.end('{"ok":true}');
      }
      rs.writeHead(404);
      rs.end('{}');
    });
  });
  await new Promise(r => svc.listen(0, '127.0.0.1', r));
  const sport = svc.address().port;
  t.after(() => svc.close());
  fs.writeFileSync(path.join(dir, 'crm.key'), 'LH_CRM_KEY=CRMKEY\n');
  const cfg = {
    port,
    bind: '127.0.0.1',
    storeFile: 'store.json',
    crm: { base: `http://127.0.0.1:${sport}`, keyFile: 'crm.key', board: 't', pollSec: 1, files: true },
    tokens: { OWNER: { name: 'owner', via: 'page' }, OPS: { name: 'op-test', via: 'api' } },
    boards: { t: { name: 'Test', access: { owner: 'owner', 'op-test': 'operator' } } },
  };
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(cfg));
  fs.writeFileSync(path.join(dir, 'store.json'), JSON.stringify({ cards: {}, comments: {} }));
  const child = spawnServer(path.join(dir, 'config.json'), {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout.on('data', d => (out += d));
  child.stderr.on('data', d => (out += d));
  t.after(() => child.kill());
  for (let i = 0; i < 40 && !out.includes('listening'); i++) await wait(100);
  assert.ok(out.includes('crm question lane'), 'the lane announces itself: ' + out);
  for (let i = 0; i < 200 && !crm.served; i++) await wait(100);
  await wait(600);
  // the question became a card with a staff message, and the CRM heard "received" (off shift: answered in working
  // hours)
  let r = await req(port, 'GET', '/api/state', null, 'OWNER');
  const card = r.body.cards['t-crm-q-q_77'];
  assert.ok(card, 'the card exists');
  assert.equal(card.title, 'How many type X leads do I have');
  assert.equal(card.crm.name, 'Sam');
  assert.match(card.context, /Scope stated by the CRM: This person can see only their own leads/);
  r = await req(port, 'GET', '/api/comments?cardId=t-crm-q-q_77', null, 'OWNER');
  const sm = r.body.comments.find(m => m.kind === 'staff');
  assert.ok(sm && !sm.handled && sm.by === 'staff:Sam' && sm.via === 'crm', 'a staff message, unanswered, never Owner');
  assert.equal(sm.staff.scope, 'This person can see only their own leads; answer only within that.');
  assert.equal(crm.acks.length, 1);
  assert.equal(crm.acks[0].state, 'received');
  assert.equal(crm.acks[0].note, 'answered during working hours');
  assert.deepEqual(
    Object.keys(crm.acks[0])
      .filter(k => k !== 'qid')
      .sort(),
    ['id', 'note', 'state'],
    'exactly the fields the CRM accepts',
  );
  assert.ok(crm.acks[0].id);
  // the shift starts: the staff message is re-emitted to the change feed for the board watch
  r = await req(port, 'GET', '/api/changes?since=0', null, 'OWNER');
  const n0 = r.body.changes.filter(c => c.kind === 'comment' && c.id === sm.id).length;
  r = await req(
    port,
    'POST',
    '/api/boards/t/events',
    { rows: [{ label: 'SHIFT', task: 'general', text: 'shift started' }] },
    'OPS',
  );
  r = await req(port, 'GET', '/api/changes?since=0', null, 'OWNER');
  assert.equal(
    r.body.changes.filter(c => c.kind === 'comment' && c.id === sm.id).length,
    n0 + 1,
    'replayed at the shift start',
  );
  // a STATUS on the card is work, not the answer: the CRM hears "working"; the question stays open
  r = await req(
    port,
    'POST',
    '/api/boards/t/events',
    { rows: [{ label: 'STATUS', task: 'crm-q-q_77', state: 'inflight', text: 'Looking into it.' }] },
    'OPS',
  );
  assert.ok(r.body.results[0].ok);
  await wait(300);
  assert.equal(crm.acks.length, 2);
  assert.equal(crm.acks[1].state, 'working');
  r = await req(port, 'GET', '/api/comments?cardId=t-crm-q-q_77', null, 'OWNER');
  assert.ok(!r.body.comments.find(m => m.kind === 'staff').handled, 'still unanswered');
  // the answer: a REPLY with a CSV; the CRM failed once and the retry carries the same replyId; the card is done
  r = await rawReq(
    port,
    'POST',
    '/api/attachments',
    Buffer.from('lead,type\nA,X\nB,X\n'),
    { 'Content-Type': 'text/csv', 'X-Name': 'leads.csv' },
    'OPS',
  );
  assert.equal(r.status, 201, 'a CSV is taken');
  const fid = r.body.id;
  r = await req(
    port,
    'POST',
    '/api/boards/t/events',
    {
      rows: [
        {
          label: 'REPLY',
          task: 'crm-q-q_77',
          text: 'You have 2 type X leads; the list is attached.',
          attachments: [fid],
        },
      ],
    },
    'OPS',
  );
  assert.ok(r.body.results[0].ok);
  // the retry rides the next poll; longer on a loaded machine
  for (let i = 0; i < 200 && crm.replies.length < 1; i++) await wait(100);
  assert.equal(crm.replies.length, 1, 'one reply after the retry');
  const rp = crm.replies[0];
  assert.equal(rp.kind, 'answer');
  assert.equal(rp.by, 'op-test');
  assert.match(rp.text, /^You have 2 type X leads/);
  assert.deepEqual(
    Object.keys(rp)
      .filter(k => k !== 'qid' && k !== 'file')
      .sort(),
    ['answeredAt', 'by', 'id', 'kind', 'text'],
    'exactly the fields the CRM accepts',
  );
  assert.ok(rp.id);
  assert.equal(rp.file.name, 'leads.csv');
  assert.equal(Buffer.from(rp.file.base64, 'base64').toString(), 'lead,type\nA,X\nB,X\n');
  r = await req(port, 'GET', '/api/state', null, 'OWNER');
  assert.equal(r.body.cards['t-crm-q-q_77'].status, 'done', 'answered means done');
  r = await req(port, 'GET', '/api/comments?cardId=t-crm-q-q_77', null, 'OWNER');
  assert.ok(r.body.comments.find(m => m.kind === 'staff').handled);
  r = await req(port, 'GET', '/api/boards/t/conduct?minutes=60', null, 'OWNER');
  assert.equal(r.body.crm.open, 0);
  assert.equal(r.body.crm.answered24h, 1);
  assert.equal(r.body.crm.pending, 0);
  // a second question answered with an ACTION: a change request, Owner decides, the CRM hears needs_owner
  crm.q2 = true;
  for (let i = 0; i < 200 && !crm.served2; i++) await wait(100);
  await wait(600);
  r = await req(port, 'GET', '/api/state', null, 'OWNER');
  assert.ok(r.body.cards['t-crm-q-q_78'], 'the second question arrived');
  assert.equal(
    Object.keys(r.body.cards).filter(k => k.startsWith('t-crm-q-')).length,
    2,
    'and the first was not delivered twice',
  );
  r = await req(
    port,
    'POST',
    '/api/boards/t/events',
    {
      rows: [
        {
          label: 'ACTION',
          task: 'crm-q-q_78',
          text: 'Alex asks for a lead-source column in the team view; a schema change. Your call.',
        },
      ],
    },
    'OPS',
  );
  assert.ok(r.body.results[0].ok);
  for (let i = 0; i < 200 && crm.replies.length < 2; i++) await wait(100);
  assert.equal(
    crm.replies.length,
    2,
    'acks=' +
      JSON.stringify(crm.acks) +
      ' replies=' +
      JSON.stringify(crm.replies.map(x => [x.qid, x.kind])) +
      ' log=' +
      out
        .split(String.fromCharCode(10))
        .filter(l => /crm/.test(l))
        .join(' / '),
  );
  assert.equal(crm.replies[1].qid, 'q_78');
  r = await req(port, 'GET', '/api/state', null, 'OWNER');
  assert.equal(r.body.cards['t-crm-q-q_78'].status, 'waiting', 'Owner decides');
  assert.ok(r.body.cards['t-crm-q-q_78'].decisions.some(d => !d.resolvedAt));
  r = await req(port, 'GET', '/api/comments?cardId=t-crm-q-q_78', null, 'OWNER');
  assert.ok(r.body.comments.find(m => m.kind === 'staff').handled, 'the asker has been told');
  // a refusal is not lost silently: three tries, then a line on the card and a note to the operator
  await wait(1100); // a later second than the ACTION: the follow-up must go whatever the clock says
  crm.refuse = true;
  r = await req(
    port,
    'POST',
    '/api/boards/t/events',
    { rows: [{ label: 'REPLY', task: 'crm-q-q_78', text: 'Owner decided: no new column for now.', kind: 'declined' }] },
    'OPS',
  );
  for (
    let i = 0;
    i < 200 &&
    !((await req(port, 'GET', '/api/boards/t/notes', null, 'OWNER')).body.notes || []).some(
      n => n.rule === 'crm-refused',
    );
    i++
  )
    await wait(100); // three tries, one per poll second, longer on a loaded machine
  {
    const ns = (await req(port, 'GET', '/api/boards/t/notes', null, 'OWNER')).body.notes;
    assert.ok(
      ns.some(n => n.rule === 'crm-refused'),
      'the operator is told the asker did not see it',
    );
  }
  r = await req(port, 'GET', '/api/boards/t/conduct?minutes=60', null, 'OWNER');
  assert.equal(r.body.crm.pending, 0, 'dropped after three tries');
};
