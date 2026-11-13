// The steward's board side, hardened: a second opinion that sees nothing of the operator's, earlier answers fed back
// only as his question and the old one-line answer, every ruling whole and quoted, the secret net in any case and
// backwards and again at Put, the cap on automatic checks, the watch's health measures, fixed error codes, and the
// failure flag that says no more than the request.
// Run: node --test lighthouse/server/tests/steward-review.test.js
'use strict';
const { testPort, spawnServer } = require('../../tests/sandbox.cjs');
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs'),
  os = require('node:os'),
  path = require('node:path'),
  http = require('node:http');
const wait = ms => new Promise(r => setTimeout(r, ms));
function req(port, method, p, body, token) {
  return new Promise((resolve, reject) => {
    const data = body == null ? null : Buffer.from(JSON.stringify(body));
    const r = http.request(
      {
        host: '127.0.0.1',
        port,
        method,
        path: p,
        headers: Object.assign(
          { 'Content-Type': 'application/json' },
          token ? { Authorization: 'Bearer ' + token } : {},
        ),
      },
      res => {
        let d = '';
        res.on('data', c => (d += c));
        res.on('end', () => {
          let j = null;
          try {
            j = JSON.parse(d);
          } catch {}
          resolve({ status: res.statusCode, body: j, raw: d });
        });
      },
    );
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

test('the steward hardened: second opinions, earlier answers, rulings, the secret net, checks, health', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lhsr-'));
  const port = await testPort();
  const ST = 'STEWARDTOKENFORREVIEW1',
    LATER = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6';
  const cfg = {
    port,
    bind: '127.0.0.1',
    storeFile: 'store.json',
    stewardClockMs: 150,
    stewardRunLimitMs: 60000,
    stewardRetryMs: 0,
    stewardChecksPerHour: 2,
    tokens: {
      OWNERPAGETOKEN: { name: 'owner', via: 'page' },
      OPERATORTOKEN: { name: 'op-s', via: 'api' },
      [ST]: { name: 'steward-s', via: 'api', mode: 'steward', board: 's' },
    },
    boards: { s: { name: 'Signal', steward: true, access: { owner: 'owner', 'op-s': 'operator' } } },
  };
  const policies = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'rulings.json'), 'utf8'));
  policies.rulings[0].supersededBy = [policies.rulings[1].n];
  policies.rulings[2].scene = true;
  cfg.rulingsFile = 'review-policies.json';
  fs.writeFileSync(path.join(dir, cfg.rulingsFile), JSON.stringify(policies));
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
  };
  await start();
  t.after(() => child.kill());
  const J = 'OWNERPAGETOKEN',
    OP = 'OPERATORTOKEN';
  const state = async () => (await req(port, 'GET', '/api/state', null, J)).body;
  const line = rows => req(port, 'POST', '/api/boards/s/events', { rows }, OP);
  const press = body => req(port, 'POST', '/api/boards/s/steward', body, J);
  const claim = async () => (await req(port, 'GET', '/api/steward/next', null, ST)).body;
  const answer = b => req(port, 'POST', '/api/steward/result', b, ST);
  const health = async () => (await req(port, 'GET', '/api/boards/s/conduct?minutes=60', null, J)).body.steward;
  async function claimKind(kind) {
    for (let i = 0; i < 20; i++) {
      const j = (await claim()).job;
      if (!j) {
        await wait(150);
        continue;
      }
      if (j.kind === kind) return j;
      await answer(
        j.kind === 'ask-check' || j.kind === 'review'
          ? { request: j.request, silent: true }
          : { request: j.request, oneLine: 'noted', text: 'noted', model: 'test' },
      );
    }
    throw new Error('no ' + kind + ' job came');
  }

  // a steward never seen is not installed: the watch hears nothing about it
  let h = await health();
  assert.equal(h.installed, false);
  assert.equal(h.offMin, 0);
  await req(port, 'POST', '/api/steward/heartbeat', { model: 'codex-test', error: 'claim-refused' }, ST);
  h = await health();
  assert.ok(h.installed && h.alive);
  assert.equal(h.lastError, 'claim-refused', 'a fixed code passes');
  await req(
    port,
    'POST',
    '/api/steward/heartbeat',
    { model: 'codex-test', error: 'refused: ' + ST + ' see /etc/passwd' },
    ST,
  );
  h = await health();
  assert.equal(h.lastError, 'other', 'free text never rides on the heartbeat');

  // a card whose context, status and detail carry the operator's leaning
  await req(port, 'POST', '/api/boards/s/shift', { state: 'on' }, OP);
  await wait(300);
  await line([
    {
      label: 'TASK_CREATED',
      task: 'importer',
      title: 'Importer',
      text: 'CONTEXT-LEANS-B: the operator thinks Monday is safer',
      uuid: 'u0',
    },
  ]);
  await line([
    {
      label: 'ACTION',
      task: 'importer',
      text: 'Ship now or Monday? A. now B. Monday',
      uuid: 'u1',
      reversible: 'yes',
      rec: 'B',
    },
  ]);
  await line([{ label: 'STATUS', task: 'importer', text: 'STATUS-LEANS-B', uuid: 'u2' }]);

  // an explainer first: its answer echoes the operator, and it may be wrong
  await press({ kind: 'explain', cardId: 's-importer' });
  let job = await claimKind('explain');
  assert.match(job.text, /CONTEXT-LEANS-B/, 'an explainer sees the context');
  assert.match(job.text, /The operator recommends: «B»/, 'and the recommendation');
  // an explainer gets two tries, not three: twenty minutes each
  assert.equal(
    (await answer({ request: job.request, failed: true, detail: 'no PNG this time' })).body.state,
    'pending',
  );
  job = await claimKind('explain');
  assert.equal(
    (await answer({ request: job.request, failed: true, detail: 'still no PNG' })).body.state,
    'failed',
    'two tries for an explainer',
  );
  await req(port, 'POST', '/api/comments', { cardId: 's-importer', text: 'Why Monday?' }, J);
  let r;

  await press({ kind: 'ask', text: 'Is Monday right?', cardId: 's-importer' });
  job = await claimKind('ask');
  await answer({
    request: job.request,
    oneLine: 'EARLIER-ONE-LINE: the operator is right, B.',
    text: 'EARLIER-LONG-TEXT that repeats the operator recommends B',
    model: 'codex-test',
  });

  // a second opinion: Owner's words, the question, the options and the record; nothing of the operator's, nothing
  // said before
  await press({ kind: 'second-opinion', cardId: 's-importer' });
  job = await claimKind('second-opinion');
  for (const leak of [
    'CONTEXT-LEANS-B',
    'STATUS-LEANS-B',
    'EARLIER-ONE-LINE',
    'EARLIER-LONG-TEXT',
    'The operator recommends',
  ])
    assert.ok(!job.text.includes(leak), 'a second opinion never sees ' + leak);
  assert.match(job.text, /Ship now or Monday/);
  assert.match(job.text, /Why Monday\?/, "Owner's own words on the card are there");
  await answer({ request: job.request, choice: 'A', oneLine: 'Now.', text: 'x', model: 'codex-test' });

  // a later ask on the card sees the earlier question and its one-line answer, marked as model output, never the
  // long text
  await press({ kind: 'ask', text: 'And now?', cardId: 's-importer' });
  job = await claimKind('ask');
  assert.match(job.text, /earlier model output[\s\S]*it may be wrong/);
  assert.match(job.text, /Owner asked «Is Monday right\?»/);
  assert.match(job.text, /EARLIER-ONE-LINE/);
  assert.ok(!job.text.includes('EARLIER-LONG-TEXT'), 'only the one-line answer comes back');

  // every ruling, whole, quoted, in number order, with the record's hash; superseded and scene marked
  const R = policies.rulings;
  const longest = R.slice().sort((a, b) => b.text.length - a.text.length)[0],
    last = R[R.length - 1];
  assert.ok(
    job.text.includes(longest.text.slice(-200).replace(/\s+/g, ' ').trim()),
    'the longest ruling arrives to its last words',
  );
  assert.ok(job.text.includes(last.text.slice(-120).replace(/\s+/g, ' ').trim()), 'and the last ruling');
  assert.ok(
    job.text.indexOf('Ruling 1: «') < job.text.indexOf('Ruling 2: «') &&
      job.text.indexOf('Ruling 2: «') < job.text.indexOf(`Ruling ${last.n}: «`),
    'in number order',
  );
  assert.match(job.text, /record [0-9a-f]{12}\)/, "the record's hash");
  assert.match(job.text, /Ruling 1: [^\n]*superseded by ruling 2/);
  assert.match(job.text, /Ruling 3: [^\n]*; scene/);
  assert.match(job.text, /chief developer's record of what Owner decided/);
  await answer({ request: job.request, oneLine: 'fine', text: 'fine', model: 'codex-test' });

  // advice put to the operator never comes back as a message; the operator's answer to it does, labelled
  const adv = (await state()).advice.find(a => a.kind === 'ask' && /EARLIER-ONE-LINE/.test(a.oneLine));
  assert.equal((await req(port, 'POST', `/api/advice/${adv.id}/put`, {}, J)).status, 201);
  const put = (await req(port, 'GET', '/api/comments?cardId=s-importer', null, J)).body.comments.find(
    c => c.putAdvice === adv.id,
  );
  await line([
    { label: 'REPLY', task: 'importer', text: 'OPERATOR-ANSWER-TO-ADVICE: I still think B.', uuid: 'u3', re: put.sid },
  ]);
  await press({ kind: 'state', cardId: 's-importer' });
  job = await claimKind('state');
  assert.ok(!job.text.includes('put to you by Owner'), 'the put advice is not in the sheet');
  assert.match(
    job.text,
    /answering the steward's advice Owner put to it REPLY: «OPERATOR-ANSWER-TO-ADVICE/,
    "the operator's answer to it is, labelled as the operator's",
  );
  await answer({ request: job.request, oneLine: 'n', text: 'n', model: 'codex-test' });

  // the secret net: any case, backwards, padded; and again at Put, against keys the board knows now
  for (const [why, s] of [
    ['uppercased', 'see ' + ST.toLowerCase()],
    ['reversed', [...ST].reverse().join('')],
    ['padded', [...ST].map(c => c + '.').join('')],
  ]) {
    await press({ kind: 'ask', text: 'q ' + why });
    job = await claimKind('ask');
    assert.equal(
      (await answer({ request: job.request, oneLine: s, text: 'x', model: 't' })).status,
      422,
      'a key ' + why + ' is still a key',
    );
  }
  await press({ kind: 'ask', text: 'q later' });
  job = await claimKind('ask');
  assert.equal(
    (await answer({ request: job.request, oneLine: 'harmless today: ' + LATER, text: 'x', model: 't' })).status,
    200,
  );
  const laterId = (await state()).advice.find(a => a.requestId === job.request).id;

  // a failure whose detail held a key: the flag says withheld, never the key
  await press({ kind: 'ask', text: 'will fail' });
  job = await claimKind('ask');
  for (let i = 0; i < 3; i++) {
    await answer({ request: job.request, failed: true, detail: 'boom ' + ST });
    if (i < 2) job = await claimKind('ask');
  }
  let s = await state();
  const fl = s.advice.filter(a => a.kind === 'flag');
  assert.ok(
    fl.some(a => /could not answer[\s\S]*withheld/.test(a.oneLine)) && !JSON.stringify(s.advice).includes(ST),
    'the flag says it was withheld',
  );

  // automatic checks: at most two an hour here, one per card; the rest marked unchecked
  await line([
    { label: 'TASK_CREATED', task: 'c1', title: 'C1', text: 'x', uuid: 'c1' },
    { label: 'ACTION', task: 'c1', text: 'One?', uuid: 'c1a', reversible: 'yes' },
    { label: 'TASK_CREATED', task: 'c2', title: 'C2', text: 'x', uuid: 'c2' },
    { label: 'ACTION', task: 'c2', text: 'Two?', uuid: 'c2a', reversible: 'yes' },
    { label: 'TASK_CREATED', task: 'c3', title: 'C3', text: 'x', uuid: 'c3' },
    { label: 'ACTION', task: 'c3', text: 'Three?', uuid: 'c3a', reversible: 'yes' },
  ]);
  await wait(400);
  s = await state();
  const checks = s.stewardRequests.filter(x => x.kind === 'ask-check');
  assert.ok(checks.length <= 2, 'never more than the cap: ' + checks.length);
  h = await health();
  assert.ok(h.unchecked >= 2, 'the asks past the cap are counted: ' + h.unchecked);

  // stalled: ready jobs and no claim or answer, counted from the shift's 15th minute: a fresh shift is not stalled
  h = await health();
  assert.equal(h.stalledMin, 0, "not in the shift's first 15 minutes");

  // a send repeated after a restart is still caught: the board keeps what it made in its store
  const first = await req(
    port,
    'POST',
    '/api/comments',
    { cardId: 's-importer', text: 'Once, please.', sendId: 'restart-test-123' },
    J,
  );
  // keys change: the advice that was harmless is not put once it holds one the board now knows
  await wait(500);
  child.kill();
  await wait(400);
  cfg.tokens[LATER] = { name: 'new-op', via: 'api' };
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(cfg));
  await start();
  await wait(300);
  const again = await req(
    port,
    'POST',
    '/api/comments',
    { cardId: 's-importer', text: 'Once, please.', sendId: 'restart-test-123' },
    J,
  );
  assert.equal(again.status, 200);
  assert.equal(again.body.id, first.body.id, 'the same message, not a second one');
  r = await req(port, 'POST', `/api/advice/${laterId}/put`, {}, J);
  assert.equal(r.status, 422, 'scanned again at Put: ' + r.raw);
});

test('stalled means no progress while jobs are ready, during the shift', () => {
  const ago = min => new Date(Date.now() - min * 60000).toISOString();
  const store = {
    boards: { s: { shift: { state: 'on', since: ago(120) } } },
    cards: {},
    comments: {},
    attachments: {},
    stewardRequests: {},
    advice: {},
    stewards: { s: { at: ago(0), lastClaim: ago(50) } },
  };
  const ST = require('../steward.js')({
    cfg: { boards: { s: { steward: true } }, stewardClockMs: 3600000 },
    now: () => new Date().toISOString(),
    newId: () => Math.random().toString(16).slice(2, 18),
    store: () => store,
    change() {},
    notify() {},
    save() {},
    saveNow() {},
    secrets: () => [],
    rulingsFile: path.join(__dirname, '..', 'rulings.json'),
  });
  store.stewardRequests.a = { id: 'a', board: 's', kind: 'ask', state: 'pending', t: ago(55), attempts: 0 };
  let h = ST.health('s');
  assert.ok(h.stalledMin >= 49 && h.stalledMin <= 51, 'from the last claim: ' + h.stalledMin);
  store.stewards.s.lastAnswer = ago(5);
  h = ST.health('s');
  assert.ok(h.stalledMin <= 6, 'an answer is progress: ' + h.stalledMin);
  store.stewardRequests.a.notBefore = ago(-30);
  store.stewards.s.lastAnswer = null;
  h = ST.health('s');
  assert.equal(h.stalledMin, 0, 'a job paused for its retry is not ready');
  store.stewardRequests.a.notBefore = null;
  store.boards.s.shift = { state: 'off' };
  h = ST.health('s');
  assert.equal(h.stalledMin, 0, 'never outside the shift');
});

test("the advice he asked for pings him once; the board's own checks never do", async () => {
  const store = {
    boards: { s: { name: 'Signal', shift: { state: 'on' } } },
    cards: { 's-x': { id: 's-x', board: 's', title: 'Importer', status: 'waiting', decisions: [] } },
    comments: {},
    attachments: {},
    stewardRequests: {},
    advice: {},
    stewards: {},
  };
  const pings = [];
  const ST = require('../steward.js')({
    cfg: { boards: { s: { steward: true } }, stewardClockMs: 3600000 },
    now: () => new Date().toISOString(),
    newId: () => Math.random().toString(16).slice(2, 18).padEnd(16, '0'),
    store: () => store,
    change() {},
    notify: (b, m) => pings.push(m),
    save() {},
    saveNow() {},
    secrets: () => [],
    rulingsFile: path.join(__dirname, '..', 'rulings.json'),
  });
  const post = body =>
    ST.route(
      { method: 'POST' },
      '/api/steward/result',
      null,
      { board: 's', name: 'steward-s' },
      { body: async () => body },
    );
  store.stewardRequests.a = {
    id: 'a',
    board: 's',
    kind: 'ask',
    cardId: 's-x',
    by: 'owner',
    state: 'running',
    attempts: 1,
    t: new Date().toISOString(),
  };
  store.stewardRequests.b = {
    id: 'b',
    board: 's',
    kind: 'ask-check',
    cardId: 's-x',
    by: 'board',
    state: 'running',
    attempts: 1,
    t: new Date().toISOString(),
  };
  store.stewardRequests.c = {
    id: 'c',
    board: 's',
    kind: 'state',
    by: 'owner',
    state: 'running',
    attempts: 3,
    t: new Date().toISOString(),
  };
  assert.equal((await post({ request: 'a', oneLine: 'Monday is safer.', text: 'x', model: 't' })).status, 200);
  assert.equal(pings.length, 1);
  assert.match(pings[0].title, /Steward answered: your question/);
  assert.match(pings[0].body, /^Importer: Monday is safer\./);
  assert.equal(pings[0].url, '/#card=s-x');
  await post({ request: 'b', oneLine: 'It cannot be undone.', text: 'x', choice: 'A', model: 't' });
  assert.equal(pings.length, 1, 'an automatic check never pings this way');
  await post({ request: 'c', failed: true, detail: 'quota' });
  assert.equal(pings.length, 2);
  assert.match(pings[1].title, /could not answer/);
});
