// The overview: the steward's reading of the whole board at the head of General, on a two-hour clock counted from
// the last one (his press restarts it), the first of a shift twenty minutes in, none off shift; it reads the open
// cards, General, the operator's chat and its own last overview; its advice goes to the operator one piece at a time.
// The clock runs here in seconds.
// Run: node --test lighthouse/server/tests/steward-overview.test.js
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
          resolve({ status: res.statusCode, body: j });
        });
      },
    );
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

test('the overview: its clock, what it reads, its parts, its advice put one piece at a time', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lhov-'));
  const port = await testPort();
  const cfg = {
    port,
    bind: '127.0.0.1',
    storeFile: 'store.json',
    stewardClockMs: 100,
    stewardOverviewMinutes: 0.05,
    stewardOverviewFirstMinutes: 0.03,
    stewardRunLimitMs: 60000,
    stewardRetryMs: 0,
    stewardChecksPerHour: 50,
    tokens: {
      OWNER: { name: 'owner', via: 'page' },
      OPS: { name: 'op-s', via: 'api' },
      STEWARDSTOKEN1: { name: 'steward-s', via: 'api', mode: 'steward', board: 's' },
    },
    boards: { s: { name: 'Signal', steward: true, access: { owner: 'owner', 'op-s': 'operator' } } },
  };
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(cfg));
  fs.writeFileSync(path.join(dir, 'store.json'), JSON.stringify({ cards: {}, comments: {} }));
  let out = '';
  const child = spawnServer(path.join(dir, 'config.json'), {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', d => (out += d));
  child.stderr.on('data', d => (out += d));
  t.after(() => child.kill());
  for (let i = 0; i < 60 && !out.includes('listening'); i++) await wait(100);
  const ST = 'STEWARDSTOKEN1';
  const state = async () => (await req(port, 'GET', '/api/state', null, 'OWNER')).body;
  const line = rows => req(port, 'POST', '/api/boards/s/events', { rows }, 'OPS');
  const claim = async () => (await req(port, 'GET', '/api/steward/next', null, ST)).body.job;
  const answer = b => req(port, 'POST', '/api/steward/result', b, ST);
  async function nextOverview(ms) {
    // the next overview job; anything else queued is answered plainly
    for (const end = Date.now() + ms; Date.now() < end; ) {
      const j = await claim();
      if (!j) {
        await wait(100);
        continue;
      }
      if (j.kind === 'state') return j;
      await answer(
        j.kind === 'ask-check' || j.kind === 'review'
          ? { request: j.request, silent: true }
          : { request: j.request, oneLine: 'n', text: 'n', model: 't' },
      );
    }
    return null;
  }

  // off shift, the clock asks for nothing
  await req(port, 'POST', '/api/steward/heartbeat', { model: 'codex-test' }, ST);
  await wait(600);
  assert.equal(await nextOverview(300), null, 'no overview off shift');
  let s = await state();
  assert.equal(s.stewards.s.overviewNext, null);

  // the shift starts; the board fills; the first overview comes about 1.8 seconds in (twenty minutes, in this clock)
  await line([{ label: 'SHIFT', text: 'shift started', uuid: 'a0' }]);
  const started = Date.now();
  await line([
    { label: 'TASK_CREATED', task: 'importer', title: 'Importer_fix', text: 'Fix the importer', uuid: 'a1' },
    { label: 'CONTEXT', task: 'importer', text: 'The nightly import drops rows with a null region.', uuid: 'a2' },
    { label: 'ACTION', task: 'importer', text: 'Ship the fix now or Monday? A. now B. Monday', uuid: 'a3', rec: 'B' },
  ]);
  await line([{ label: 'TASK_CREATED', task: 'docs', title: 'Docs', text: 'Write the docs', uuid: 'a4' }]);
  await req(
    port,
    'POST',
    '/api/boards/s/transcript',
    {
      rows: [
        { role: 'operator', text: 'Firstmate is on its third try at the importer test.', t: new Date().toISOString() },
        { role: 'owner', text: 'keep me posted on the importer', t: new Date().toISOString() },
      ],
    },
    'OPS',
  );
  {
    const pc = await req(port, 'POST', '/api/comments', { board: 's', text: 'How is the night going?' }, 'OWNER');
    assert.equal(pc.status, 201, JSON.stringify(pc.body));
  }
  s = await state();
  assert.ok(s.stewards.s.overviewNext, 'the next one is shown on shift');
  let job = await nextOverview(4000);
  assert.ok(job, 'the first overview of the shift');
  assert.ok(
    Date.now() - started >= 700,
    'not before twenty minutes (here 1.8 s, from a start the board stamps to the second) of shift',
  );
  assert.match(job.text, /== The overview ==/);
  assert.match(job.text, /The board asked for it on its two-hour clock/);
  assert.match(job.text, /== The open cards \(2\) ==/);
  assert.match(job.text, /null region/, "each card's context");
  assert.match(job.text, /Open ask since .*Ship the fix now or Monday/);
  assert.match(job.text, /The operator recommends/);
  assert.match(job.text, /== General since/);
  assert.match(job.text, /How is the night going\?.*not answered yet|not answered yet.*How is the night going\?/);
  assert.match(job.text, /== The operator's own chat since/);
  assert.match(job.text, /third try at the importer test/);
  assert.match(job.text, /Owner: «keep me posted/);
  assert.ok(!/Your last overview/.test(job.text), 'no earlier overview yet');
  assert.ok(!/== The board now ==/.test(job.text), 'the cards are listed once');
  s = await state();
  assert.equal(s.stewards.s.overviewNext, null, 'none due while one is under way');

  // its parts: a card it names is kept only when it is one the job offered; the board asked, so it never pings
  let r = await answer({
    request: job.request,
    oneLine: 'The importer is stuck on its test and waits on you.',
    text: '',
    model: 't',
    claims: [{ text: 'an ask waits', record: 'card:s-importer' }],
    overview: {
      stands: 'Two tasks open; the importer waits on your choice.',
      struggles: [
        { text: 'Third try at the importer test.', card: 's-importer' },
        { text: 'Made up.', card: 's-nope' },
      ],
      advice: [
        { text: 'Choose Monday for the importer.', card: 'card:s-importer' },
        { text: 'Ask for a docs outline.', card: '' },
      ],
      since: 'The shift began.',
    },
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  s = await state();
  const first = s.advice.find(a => a.requestId === job.request);
  assert.equal(first.kind, 'state');
  assert.equal(first.auto, true);
  assert.ok(first.since);
  assert.equal(first.overview.struggles[0].card, 's-importer');
  assert.equal(first.overview.struggles[1].card, null, 'a card the job did not offer is dropped');
  assert.equal(first.overview.advice[0].card, 's-importer', 'card: is read either way');
  assert.equal(first.overview.advice[1].card, null);
  assert.equal(first.claims, undefined, 'claims come when he opens it');
  const due = Date.parse(s.stewards.s.overviewNext);
  assert.ok(due > Date.now() && due - Date.parse(first.t) > 2000, 'the next is two hours (here 3 s) after this one');

  // his press restarts the clock; the job carries the last overview whole, as earlier output
  r = await req(port, 'POST', '/api/boards/s/steward', { kind: 'state' }, 'OWNER');
  assert.equal(r.status, 201);
  job = await nextOverview(2000);
  assert.ok(job);
  assert.match(job.text, /Owner pressed for it/);
  assert.match(job.text, /Your last overview, .*earlier model output/);
  assert.match(job.text, /Headline: «The importer is stuck/);
  assert.match(job.text, /Struggle point on s-importer: «Third try/);
  assert.match(job.text, /Advice 1 on s-importer/);
  // an older kit answers in text alone: kept, and shown as it came
  r = await answer({
    request: job.request,
    oneLine: 'Quieter now.',
    text: '**Where things stand** Quiet.',
    model: 't',
  });
  assert.equal(r.status, 200);
  s = await state();
  const second = s.advice.find(a => a.requestId === job.request),
    was = s.advice.find(a => a.id === first.id);
  assert.equal(second.overview, undefined);
  assert.equal(second.text, '**Where things stand** Quiet.', 'the newest rides whole');
  assert.equal(second.auto, undefined, 'he asked for it');
  assert.equal(was.overview, undefined, 'an earlier one comes when opened');
  assert.equal(was.more, true);
  assert.ok(Date.parse(s.stewards.s.overviewNext) - Date.parse(second.t) > 2000, 'counted from his press');
  assert.equal(
    (await req(port, 'GET', '/api/advice/' + first.id, null, 'OWNER')).body.advice.overview.advice.length,
    2,
    'whole when opened',
  );

  // one piece of advice goes to the operator alone, on the card it names, or in General
  r = await req(port, 'POST', `/api/advice/${first.id}/put`, { item: 0 }, 'OPS');
  assert.equal(r.status, 403, 'only Owner');
  r = await req(port, 'POST', `/api/advice/${first.id}/put`, { item: 0 }, 'OWNER');
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const onCard = (await req(port, 'GET', '/api/comments?cardId=s-importer', null, 'OWNER')).body.comments.find(
    c => c.putAdvice === first.id,
  );
  assert.ok(onCard && onCard.kind === 'advice-put' && onCard.putItem === 0);
  assert.match(onCard.text, /from its overview of the board/);
  assert.match(onCard.text, /«Choose Monday for the importer\.»/);
  assert.ok(!/Ask for a docs outline/.test(onCard.text), 'that piece alone');
  assert.ok((await req(port, 'POST', `/api/advice/${first.id}/put`, { item: 0 }, 'OWNER')).body.already, 'once');
  r = await req(port, 'POST', `/api/advice/${first.id}/put`, { item: 1 }, 'OWNER');
  assert.equal(r.status, 201);
  const gen = (await req(port, 'GET', '/api/comments?board=s&general=true', null, 'OWNER')).body.comments.find(
    c => c.putAdvice === first.id,
  );
  assert.ok(gen && gen.cardId === null && /docs outline/.test(gen.text), 'no card: General');
  assert.equal((await req(port, 'POST', `/api/advice/${first.id}/put`, { item: 7 }, 'OWNER')).status, 400);
  const firstNow = (await req(port, 'GET', '/api/advice/' + first.id, null, 'OWNER')).body.advice;
  assert.ok(firstNow.puts[0] && firstNow.puts[1]);

  // the clock's next one comes by itself, three seconds (two hours) after his press, with his overview as the last one
  job = await nextOverview(6000);
  assert.ok(job, 'the clock again');
  assert.match(job.text, /two-hour clock/);
  assert.match(job.text, /Headline: «Quieter now\.»/);
  assert.match(job.text, /It said: «\*\*Where things stand\*\* Quiet\.»/);
  // pressed while the clock's is under way: the same request, and his now
  r = await req(port, 'POST', '/api/boards/s/steward', { kind: 'state' }, 'OWNER');
  assert.ok(r.body.already);
  await answer({ request: job.request, oneLine: 'n', text: 'n', model: 't' });
  s = await state();
  assert.equal(s.advice.find(a => a.requestId === job.request).auto, undefined, 'his once he pressed');

  // the shift ends: nothing more
  await line([{ label: 'SHIFT', text: 'shift ended', uuid: 'a9' }]);
  s = await state();
  assert.equal(s.stewards.s.overviewNext, null);
  await wait(3500);
  assert.equal(await nextOverview(300), null, 'none off shift');
});
