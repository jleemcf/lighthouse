// The steward's board side against its design (lighthouse/STEWARD-ASSISTANT-DESIGN.md): requests and their order,
// the job text, results checked at the door, advice kept apart from messages, held pings and the digest clock.
// Run: node --test lighthouse/server/tests/steward.test.js
'use strict';
const { testPort, spawnServer } = require('../../tests/sandbox.cjs');
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs'),
  os = require('node:os'),
  path = require('node:path'),
  http = require('node:http');
const wait = ms => new Promise(r => setTimeout(r, ms));
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);
function req(port, method, p, body, token, extra) {
  return new Promise((resolve, reject) => {
    const raw = Buffer.isBuffer(body),
      data = body == null ? null : raw ? body : Buffer.from(JSON.stringify(body));
    const headers = Object.assign(
      { 'Content-Type': raw ? 'image/png' : 'application/json' },
      token ? { Authorization: 'Bearer ' + token } : {},
      extra || {},
    );
    const r = http.request({ host: '127.0.0.1', port, method, path: p, headers }, res => {
      let d = '';
      res.on('data', c => (d += c));
      res.on('end', () => {
        let j = null;
        try {
          j = JSON.parse(d);
        } catch {}
        resolve({ status: res.statusCode, body: j, raw: d, headers: res.headers });
      });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

test('the steward: jobs, results at the door, advice apart, held pings', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lhst-'));
  const port = await testPort();
  const cfg = {
    port,
    bind: '127.0.0.1',
    storeFile: 'store.json',
    stewardClockMs: 150,
    stewardDigestMinutes: 0.05,
    stewardRunLimitMs: 1200,
    stewardRetryMs: 0,
    stewardChecksPerHour: 50,
    tokens: {
      OWNER: { name: 'owner', via: 'page' },
      OPS: { name: 'op-s', via: 'api' },
      TOOLS: { name: 'op-t', via: 'api', mode: 'tools' },
      STEWARDSTOKEN1: { name: 'steward-s', via: 'api', mode: 'steward', board: 's' },
      STEWT: { name: 'steward-t', via: 'api', mode: 'steward', board: 't' },
      NOST: { name: 'steward-n', via: 'api', mode: 'steward', board: 'n' },
    },
    boards: {
      s: { name: 'Signal', steward: true, access: { owner: 'owner', 'op-s': 'operator' } },
      t: { name: 'Tools', protocol: 'tools', steward: true, access: { owner: 'owner', 'op-t': 'operator' } },
      n: { name: 'None', access: { owner: 'owner' } },
    },
  };
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(cfg));
  fs.writeFileSync(path.join(dir, 'store.json'), JSON.stringify({ cards: {}, comments: {} }));
  let child = null,
    out = '';
  const start = async () => {
    out = '';
    child = spawnServer(path.join(dir, 'config.json'), {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', d => (out += d));
    child.stderr.on('data', d => (out += d));
    for (let i = 0; i < 60 && !out.includes('listening'); i++) await wait(100);
    if (!out.includes('listening')) throw new Error('the board did not start: ' + out.slice(-600));
  };
  await start();
  t.after(() => child.kill());
  const ST = 'STEWARDSTOKEN1';
  const state = async () => (await req(port, 'GET', '/api/state', null, 'OWNER')).body;
  const line = rows => req(port, 'POST', '/api/boards/s/events', { rows }, 'OPS');
  const press = (board, body, tok = 'OWNER') => req(port, 'POST', `/api/boards/${board}/steward`, body, tok);
  const claim = async (tok = ST) => (await req(port, 'GET', '/api/steward/next', null, tok)).body;
  const answer = (b, tok = ST) => req(port, 'POST', '/api/steward/result', b, tok);
  // every job the steward was given, so a job answered on the way (the 3-second digest) can still be checked
  const seen = [];
  async function claimKind(kind, tok = ST) {
    // the steward works through what is queued; other jobs answered plainly
    for (let i = 0; i < 20; i++) {
      const j = (await claim(tok)).job;
      if (!j) {
        await wait(200);
        continue;
      }
      seen.push(j);
      if (j.kind === kind) return j;
      await answer(
        j.kind === 'ask-check' || j.kind === 'review'
          ? { request: j.request, silent: true }
          : { request: j.request, oneLine: 'noted', text: 'noted', model: 'test' },
        tok,
      );
    }
    throw new Error('no ' + kind + ' job came');
  }

  // the steward token reaches only its own routes, for its own board
  assert.equal((await req(port, 'GET', '/api/state', null, ST)).status, 403, 'no reading the board');
  assert.equal(
    (await req(port, 'POST', '/api/comments', { board: 's', text: 'x' }, ST)).status,
    403,
    'no writing messages',
  );
  assert.equal((await req(port, 'GET', '/api/steward/next', null, 'NOST')).status, 403, 'no steward on board n');
  assert.equal(
    (await req(port, 'GET', '/api/steward/next', null, 'OPS')).status,
    403,
    "an operator cannot claim the steward's jobs",
  );

  // an operator's ask: held for the digest when it may wait; checked by the steward
  await req(port, 'POST', '/api/boards/s/shift', { state: 'on' }, 'OPS');
  await wait(400);
  await line([
    { label: 'TASK_CREATED', task: 'importer', title: 'Importer_fix', text: 'Fix the importer', uuid: 'u0' },
  ]);
  await line([
    {
      label: 'ACTION',
      task: 'importer',
      text: 'Ship the importer fix to staging this week? A. now B. Monday',
      uuid: 'u1',
      urgent: 'no',
      reversible: 'yes',
      rec: 'B',
    },
  ]);
  await line([{ label: 'STATUS', task: 'importer', text: 'I recommend B, Monday.', uuid: 'u1b' }]);
  let s = await state();
  const d1 = s.cards['s-importer'].decisions.find(d => !d.resolvedAt);
  assert.ok(d1.heldPing, 'not urgent, can be undone: its ping waits for the digest');
  await line([
    { label: 'TASK_CREATED', task: 'prod', title: 'Prod_switch', text: 'x', uuid: 'u2' },
    { label: 'ACTION', task: 'prod', text: 'Flip the switch?', uuid: 'u3', urgent: 'no', reversible: 'no' },
  ]);
  s = await state();
  assert.ok(!s.cards['s-prod'].decisions.find(d => !d.resolvedAt).heldPing, 'an irreversible ask always pings at once');
  await line([
    { label: 'TASK_CREATED', task: 'vague', title: 'Vague', text: 'x', uuid: 'u3b' },
    { label: 'ACTION', task: 'vague', text: 'Tidy the labels?', uuid: 'u3c', urgent: 'no' },
  ]);
  s = await state();
  assert.ok(
    s.cards['s-vague'].decisions.find(d => !d.resolvedAt).heldPing,
    'not urgent, and nothing says it cannot be undone: held for the digest',
  );

  // Owner's press goes before the automatic checks; the job leaves the operator's recommendation out
  assert.equal(
    (await press('s', { kind: 'second-opinion', cardId: 's-importer' }, 'OPS')).status,
    403,
    'only Owner presses',
  );
  assert.equal((await press('n', { kind: 'state' })).status, 409, 'no steward on board n');
  let r = await press('s', { kind: 'second-opinion', cardId: 's-importer' });
  assert.equal(r.status, 201);
  assert.ok(
    (await press('s', { kind: 'second-opinion', cardId: 's-importer' })).body.already,
    'a second press of the same is the same request',
  );
  let job = (await claim()).job;
  assert.equal(job.kind, 'second-opinion', 'his press first');
  assert.match(job.text, /Ship the importer fix/);
  assert.match(job.text, /left out on purpose/);
  assert.match(job.text, /Ruling \d+:/);
  assert.ok(
    !/I recommend B/.test(job.text),
    'nothing the operator wrote reaches a second opinion: its recommendation can sit in any of it',
  );
  assert.deepEqual((await claim()).job, job, 'a lost claim reply replays the same job');
  r = await answer({
    request: job.request,
    choice: 'B',
    oneLine: 'I would wait for Monday.',
    text: 'Because the release window closes Friday.',
    cites: [1, 999],
    claims: [
      { text: 'The card is open', record: 'card:s-importer' },
      { text: 'Made up', record: 'card:nope' },
    ],
    model: 'codex-test',
  });
  assert.equal(r.status, 200, r.raw);
  assert.equal((await answer({ request: job.request, oneLine: 'again' })).status, 200, 'the first answer stands');
  s = await state();
  const lite = s.advice.find(a => a.requestId === job.request);
  assert.ok(
    lite && lite.text === undefined && lite.claims === undefined && lite.more === true,
    'the page holds a summary; the reasons come when he opens it',
  );
  const a1 = (await req(port, 'GET', '/api/advice/' + lite.id, null, 'OWNER')).body.advice;
  assert.equal(
    (await req(port, 'GET', '/api/advice/' + lite.id, null, 'OPS')).status,
    404,
    'an operator cannot open it',
  );
  assert.deepEqual(a1.cites, [1]);
  assert.deepEqual(a1.unknownCites, [999], 'a ruling that does not exist is named, not trusted');
  assert.equal(a1.claims[0].record, 'card:s-importer');
  assert.equal(a1.claims[1].record, null, 'a claim the board cannot open is reported, not verified');
  assert.equal(a1.agrees, true, 'on a line-mode board too, the board compares (rec=B)');
  const opView = (await req(port, 'GET', '/api/state', null, 'OPS')).body;
  assert.equal((opView.advice || []).length, 0, "an operator never sees the steward's advice");
  assert.equal((opView.stewardRequests || []).length, 0, 'nor his questions to it');
  const all = (await req(port, 'GET', '/api/comments?board=s', null, 'OWNER')).body.comments;
  assert.ok(!all.some(c => /wait for Monday/.test(c.text || '')), 'advice is never a message');

  // the automatic check: silent when there is nothing to say
  job = await claimKind('ask-check');
  r = await answer({ request: job.request, silent: true });
  assert.ok(r.body.silent);
  // results checked at the door: a secret is withheld and flagged
  await press('s', { kind: 'ask', text: 'What is a migration?' });
  job = await claimKind('ask');
  r = await answer({ request: job.request, oneLine: 'Here is the key: ' + ST, text: 'x', model: 't' });
  assert.equal(r.status, 422);
  s = await state();
  assert.ok(
    s.advice.some(a => a.kind === 'flag' && /withheld/.test(a.oneLine)),
    'Owner is told it was withheld',
  );
  assert.ok(!JSON.stringify(s.advice).includes(ST), 'the secret is nowhere on the board');
  await press('s', { kind: 'ask', text: 'Another question' });
  job = await claimKind('ask');
  assert.equal(
    (
      await answer({
        request: job.request,
        oneLine: 'fine',
        text: 'fine',
        missing: ['ghp_' + 'x'.repeat(36)],
        model: 't',
      })
    ).status,
    422,
    'a secret anywhere in the answer, "missing" included',
  );
  await press('s', { kind: 'ask', text: 'A third question' });
  job = await claimKind('ask');
  assert.equal(
    (await answer({ request: job.request, oneLine: 'the key is ' + ST.split('').join(' '), text: 'x', model: 't' }))
      .status,
    422,
    'a key split by spaces is still a key',
  );
  await press('s', { kind: 'ask', text: 'A fourth question' });
  job = await claimKind('ask');
  assert.equal(
    (
      await answer({
        request: job.request,
        oneLine: 'see ' + Buffer.from(ST).toString('base64'),
        text: 'x',
        model: 't',
      })
    ).status,
    422,
    'and so is one in base64',
  );
  await press('s', { kind: 'state' });
  job = await claimKind('state');
  await req(port, 'POST', '/api/steward/heartbeat', { starting: true }, ST);
  s = await state();
  assert.equal(
    s.stewardRequests.find(x => x.id === job.request).state,
    'running',
    'the lease survives a starting heartbeat so a saved answer can settle it',
  );
  assert.deepEqual(await claimKind('state'), job, 'a restart does not spend another attempt');
  await answer({ request: job.request, oneLine: 'n', text: 'n', model: 't' });
  // three failures and Owner is told
  await press('s', { kind: 'state' });
  for (let i = 0; i < 3; i++) {
    job = await claimKind('state');
    await answer({ request: job.request, failed: true, detail: 'quota' });
  }
  s = await state();
  assert.equal(s.stewardRequests.find(x => x.id === job.request).state, 'failed');
  assert.ok(s.advice.some(a => a.kind === 'flag' && /after 3 tries/.test(a.oneLine)));
  await press('s', { kind: 'explain', cardId: 's-importer' });
  job = await claimKind('explain');
  assert.equal(job.attempt, 1);
  await wait(1400);
  const again = await claimKind('explain');
  assert.equal(again.request, job.request);
  assert.deepEqual(again, job, 'the same holder recovers its job even after the run limit');
  // the explainer: the skill's own SVG, uploaded first; anything that could run is taken out on the way in
  const up = body =>
    req(port, 'POST', '/api/steward/diagram', Buffer.from(body), ST, { 'Content-Type': 'image/svg+xml' });
  assert.equal((await up('hello')).status, 415, 'an SVG document only');
  assert.equal((await up(PNG.toString('latin1'))).status, 415, 'a PNG is no longer taken');
  assert.equal(
    (await up('<!DOCTYPE svg [<!ENTITY a "aaaa">]><svg xmlns="http://www.w3.org/2000/svg">&a;</svg>')).status,
    415,
    'no entities',
  );
  r = await up(
    '<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(2)</script>' +
      '<a href="javascript:alert(3)"><rect onclick=\'alert(4)\' width="5" height="5"/></a>' +
      '<text>Importer</text></svg>\n',
  );
  assert.equal(r.status, 201, r.raw);
  const svgId = r.body.id;
  r = await answer({
    request: again.request,
    oneLine: 'The importer moves leads from the CRM into the warehouse.',
    text: 'Step one…',
    diagram: svgId,
    skill: 'diagram-design 2.6',
    model: 'codex-test',
  });
  assert.equal(r.status, 200, r.raw);
  const att = await req(port, 'GET', '/api/attachments/' + svgId, null, 'OWNER');
  assert.equal(att.headers['content-type'], 'image/svg+xml');
  assert.equal(att.headers['x-content-type-options'], 'nosniff');
  assert.match(att.headers['content-security-policy'], /sandbox; default-src 'none'/);
  assert.ok(
    /<text>Importer<\/text>/.test(att.raw) && !/alert|onload|onclick|<script|javascript/i.test(att.raw),
    'the drawing is kept, everything that could run is gone: ' + att.raw,
  );
  assert.equal(
    (await req(port, 'GET', '/api/attachments/' + svgId, null, 'OPS')).status,
    403,
    "the diagram is Owner's",
  );

  // Put to the operator: his act, a message of his on the card that the operator owes an answer to
  assert.equal((await req(port, 'POST', `/api/advice/${a1.id}/put`, {}, 'OPS')).status, 403, 'only Owner');
  r = await req(port, 'POST', `/api/advice/${a1.id}/put`, {}, 'OWNER');
  assert.equal(r.status, 201);
  const put = (await req(port, 'GET', '/api/comments?cardId=s-importer', null, 'OWNER')).body.comments.find(
    c => c.putAdvice === a1.id,
  );
  assert.ok(
    put &&
      put.author === 'advice' &&
      put.kind === 'advice-put' &&
      put.by === 'steward' &&
      !put.handled &&
      /wait for Monday/.test(put.text) &&
      /not his instruction/.test(put.text),
    "the steward's advice, owed an answer, never his message",
  );
  await line([{ label: 'REPLY', task: 'importer', text: 'Fair point: Monday it is, if Owner agrees.', uuid: 'u-put' }]);
  s = await state();
  assert.ok(
    s.cards['s-importer'].decisions.some(d => !d.resolvedAt),
    'answering the advice settles none of his asks',
  );
  assert.ok((await req(port, 'POST', `/api/advice/${a1.id}/put`, {}, 'OWNER')).body.already, 'once');

  // an ask settled before the steward ran is skipped, and says so
  await line([
    { label: 'TASK_CREATED', task: 'docs', title: 'Docs', text: 'x', uuid: 'u4' },
    { label: 'ACTION', task: 'docs', text: 'Publish the docs?', uuid: 'u5' },
  ]);
  await wait(400);
  await req(port, 'POST', '/api/cards/s-docs/resolve', {}, 'OWNER');
  for (let i = 0; i < 6; i++) {
    const j = (await claim()).job;
    if (!j) break;
    seen.push(j);
    await answer(
      j.kind === 'ask-check' || j.kind === 'review'
        ? { request: j.request, silent: true }
        : { request: j.request, oneLine: 'n', text: 'n', model: 't' },
    );
  }
  s = await state();
  const dk = s.cards['s-docs'].decisions[0].stewardCheck;
  assert.equal(s.stewardRequests.find(x => x.id === dk).state, 'skipped');

  // the digest clock releases held pings whatever the steward does, and writes a digest only when there is something
  await wait(3400);
  s = await state();
  assert.ok(s.cards['s-importer'].decisions.find(d => d.heldPing).heldReleased, "released at the slot's turn");
  if (!seen.some(j => j.kind === 'digest' && /held ask on s-importer/.test(j.text))) {
    job = await claimKind('digest');
    r = await answer({
      request: job.request,
      oneLine: 'One question waits: the importer.',
      text: 'x',
      claims: [{ text: 'held', record: 'card:s-importer' }],
      model: 't',
    });
    assert.equal(r.status, 200);
  }
  assert.ok(
    seen.some(j => j.kind === 'digest' && /held ask on s-importer/.test(j.text)),
    'a digest job carried the held ask',
  );
  s = await state();
  assert.ok(
    s.advice.some(a => a.kind === 'digest'),
    'and the digest is on the board',
  );
  assert.ok(
    s.stewardRequests.filter(x => x.kind === 'digest').every(x => x.items > 0),
    'never an empty digest',
  );
  // the end of the shift releases what is held
  await line([
    { label: 'TASK_CREATED', task: 'late', title: 'Late', text: 'x', uuid: 'u6' },
    { label: 'ACTION', task: 'late', text: 'Rename the queue?', uuid: 'u7', urgent: 'no', reversible: 'yes' },
  ]);
  await req(port, 'POST', '/api/boards/s/shift', { state: 'off' }, 'OPS');
  await wait(500);
  s = await state();
  assert.ok(s.cards['s-late'].decisions[0].heldReleased, 'released at the end of the shift');

  // memory and skill review: conflicts at once, the rest for the digest
  r = await req(
    port,
    'POST',
    '/api/steward/review',
    { files: [{ path: '/workspace/memory/review.md', side: 'operator', change: 'changed' }] },
    ST,
  );
  assert.equal(r.status, 201);
  job = await claimKind('review');
  assert.match(job.text, /memory\/review\.md/);
  await answer({
    request: job.request,
    category: 'conflict',
    oneLine: 'a.md contradicts ruling 1.',
    text: 'x',
    cites: [1],
    model: 't',
  });
  s = await state();
  assert.equal(s.advice.find(a => a.requestId === job.request).forDigest, false, 'a conflict is posted at once');

  // a tool-mode ask: the brief is marked when missing; the board compares the two recommendations
  r = await req(
    port,
    'POST',
    '/api/boards/t/calls',
    { calls: [{ id: 'o1', tool: 'board_open', args: { title: 'Window', context: 'x', slug: 'window' } }] },
    'TOOLS',
  );
  assert.ok(r.body.results[0].ok, r.raw);
  r = await req(
    port,
    'POST',
    '/api/boards/t/calls',
    {
      calls: [
        {
          id: 'o2',
          tool: 'board_ask',
          args: {
            card: 'window',
            question: 'Which window?',
            options: ['Friday', 'Monday'],
            reversible: 'yes',
            recommendation: 'B: Monday, after the freeze',
          },
        },
      ],
    },
    'TOOLS',
  );
  assert.ok(r.body.results[0].ok, r.raw);
  r = await req(
    port,
    'POST',
    '/api/boards/t/calls',
    { calls: [{ id: 'o3', tool: 'board_open', args: { title: 'Other', context: 'x', slug: 'other' } }] },
    'TOOLS',
  );
  r = await req(
    port,
    'POST',
    '/api/boards/t/calls',
    { calls: [{ id: 'o4', tool: 'board_ask', args: { card: 'other', question: 'Keep it?' } }] },
    'TOOLS',
  );
  s = await state();
  assert.ok(s.cards['t-other'].decisions[0].briefMissing, 'brief missing, still asked');
  assert.ok(!s.cards['t-window'].decisions[0].briefMissing);
  await press('t', { kind: 'second-opinion', cardId: 't-window' });
  job = await claimKind('second-opinion', 'STEWT');
  assert.ok(!/after the freeze/.test(job.text), "the operator's recommendation is not shown to a second opinion");
  await answer(
    {
      request: job.request,
      choice: 'B',
      oneLine: 'Monday.',
      text: 'x',
      claims: [{ text: 'on another board', record: 'card:s-importer' }],
      model: 't',
    },
    'STEWT',
  );
  s = await state();
  const tw = (
    await req(port, 'GET', '/api/advice/' + s.advice.find(a => a.requestId === job.request).id, null, 'OWNER')
  ).body.advice;
  assert.equal(tw.agrees, true, 'the board compares');
  assert.equal(tw.claims[0].record, null, 'a record from another board is never verified');
  // advice put to a tool-mode operator is owed an answer, and is never Owner's word: no relay, no prompt on it
  r = await req(port, 'POST', `/api/advice/${tw.id}/put`, {}, 'OWNER');
  const tput = (await req(port, 'GET', '/api/comments?cardId=t-window', null, 'OWNER')).body.comments.find(
    c => c.putAdvice === tw.id,
  );
  r = await req(port, 'GET', '/api/boards/t/status', null, 'TOOLS');
  assert.match(r.body.receipt, /the steward's advice, put to you by Owner/);
  r = await req(
    port,
    'POST',
    '/api/boards/t/calls',
    { calls: [{ id: 'o5', tool: 'board_relay', args: { source: tput.sid, to: 'firstmate' } }] },
    'TOOLS',
  );
  assert.equal(r.body.results[0].ok, false, 'never relayed as his words');
  assert.match(r.body.results[0].reason, /not Owner's words/);

  // the watch reads the stewards' health from the conduct report: counts and ages, never the advice
  const cr = (await req(port, 'GET', '/api/boards/s/conduct?minutes=60', null, 'OWNER')).body;
  assert.ok(
    cr.steward &&
      typeof cr.steward.pending === 'number' &&
      typeof cr.steward.failed24h === 'number' &&
      cr.steward.failed24h >= 1 &&
      cr.steward.withheld24h >= 1,
    JSON.stringify(cr.steward),
  );
  assert.ok(!JSON.stringify(cr.steward).includes('wait for Monday'), 'no advice in it');
  // the steward's heartbeat shows on the page
  await req(port, 'POST', '/api/steward/heartbeat', { model: 'codex-test' }, ST);
  s = await state();
  assert.equal(s.stewards.s.alive, true);
  assert.equal(s.stewards.n, undefined);
  // a check that is silent but finds the ask cannot be undone still sends its held ping
  await req(port, 'POST', '/api/boards/s/shift', { state: 'on' }, 'OPS');
  const lr = await line([
    { label: 'TASK_CREATED', task: 'irrev', title: 'Irrev', text: 'x', uuid: 'u8' },
    { label: 'ACTION', task: 'irrev', text: 'Drop the old table?', uuid: 'u9', urgent: 'no', reversible: 'yes' },
  ]);
  await wait(400);
  s = await state();
  assert.ok(s.cards['s-irrev'] && s.cards['s-irrev'].decisions[0].heldPing, JSON.stringify(lr.body));
  for (let i = 0; i < 20; i++) {
    const j = (await claim()).job;
    if (!j) {
      await wait(200);
      continue;
    }
    if (j.kind === 'ask-check' && /s-irrev/.test(j.text)) {
      await answer({ request: j.request, silent: true, irreversible: true });
      break;
    }
    await answer(
      j.kind === 'ask-check' || j.kind === 'review'
        ? { request: j.request, silent: true }
        : { request: j.request, oneLine: 'n', text: 'n', model: 't' },
    );
  }
  s = await state();
  assert.ok(s.cards['s-irrev'].decisions[0].heldReleased, 'released at once');
  // a ?token= link never replaces a signed-in session's cookie
  const home = await req(port, 'GET', '/?token=OWNER', null, null, { Cookie: 'lhtoken=OPS' });
  assert.ok(!home.headers['set-cookie'], 'no silent swap');
  const other = await req(port, 'GET', '/?token=OWNER', null, null, { Cookie: 'lhtoken=FROM-ANOTHER-BOARD' });
  assert.ok(other.headers['set-cookie'], 'a cookie this board does not know is replaced');

  // the steward turned off: whatever it was holding is released, with no steward to wait for
  await line([
    { label: 'TASK_CREATED', task: 'last', title: 'Last', text: 'x', uuid: 'u10' },
    { label: 'ACTION', task: 'last', text: 'Rename the queue?', uuid: 'u11', urgent: 'no', reversible: 'yes' },
  ]);
  s = await state();
  assert.ok(s.cards['s-last'].decisions[0].heldPing && !s.cards['s-last'].decisions[0].heldReleased);
  // the board saves a moment after a change: let it, then restart it with the steward off
  await wait(500);
  child.kill();
  await wait(500);
  cfg.boards.s.steward = false;
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(cfg));
  await start();
  await wait(500);
  try {
    s = await state();
  } catch (e) {
    throw new Error(
      'after the restart: ' +
        e.message +
        ' | exit ' +
        child.exitCode +
        ' ' +
        child.signalCode +
        ' pid ' +
        child.pid +
        ' | ' +
        out.slice(-300),
    );
  }
  assert.ok(s.cards['s-last'].decisions[0].heldReleased, 'released when the board has no steward');
});
