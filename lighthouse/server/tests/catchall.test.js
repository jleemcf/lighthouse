// A busy card is a catch-all only when Jev reads more than one piece of work in its posts.
// Run: node --test lighthouse/server/tests/catchall.test.js
'use strict';
const { testPort, spawnServer } = require('../../tests/sandbox.cjs');
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs'),
  os = require('node:os'),
  path = require('node:path'),
  http = require('node:http');
const wait = ms => new Promise(r => setTimeout(r, ms));
function req(port, method, p, token) {
  return new Promise((resolve, reject) => {
    const r = http.request(
      { host: '127.0.0.1', port, method, path: p, headers: { Authorization: 'Bearer ' + token } },
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
    r.end();
  });
}
// the stand-in Jev: posts that mention both an invoice and a migration are two jobs; posts saying "boom" fail
function fakeJev() {
  const calls = [];
  const srv = http.createServer((q, res) => {
    let d = '';
    q.on('data', c => (d += c));
    q.on('end', () => {
      const body = JSON.parse(d),
        posts = (body.state.posts || []).join(' ');
      calls.push({
        auth: q.headers.authorization,
        task: body.state.task,
        posts: body.state.posts,
        questions: Object.keys(body.questions),
      });
      if (/boom/.test(posts)) {
        res.writeHead(500);
        return res.end('{}');
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({ answers: { many: { noul: /invoice/.test(posts) && /migration/.test(posts) ? 0.9 : 0.1 } } }),
      );
    });
  });
  return new Promise(r =>
    srv.listen(0, '127.0.0.1', () =>
      r({ srv, calls, url: 'http://127.0.0.1:' + srv.address().port + '/v1/systemone' }),
    ),
  );
}
const entries = (n, text) =>
  Array.from({ length: n }, (_, i) => ({
    t: new Date(Date.now() - (n - i) * 60000).toISOString(),
    kind: 'STATUS',
    who: 'op-test',
    text: typeof text === 'function' ? text(i) : text,
  }));

test('catch-all: Jev decides whether a busy card holds more than one job', async t => {
  const jev = await fakeJev();
  t.after(() => jev.srv.close());
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lhca-'));
  const port = await testPort();
  const cfg = {
    port,
    bind: '127.0.0.1',
    storeFile: 'store.json',
    typesafeEnvFile: path.join(dir, 'typesafe.env'),
    tokens: { OWNER: { name: 'owner', via: 'page' } },
    boards: {
      c: { name: 'Busy', access: { owner: 'owner', 'op-test': 'operator' } },
      d: { name: 'Failing', access: { owner: 'owner', 'op-test': 'operator' } },
      e: { name: 'Talk', access: { owner: 'owner', 'op-test': 'operator' } },
    },
  };
  const at = min => new Date(Date.now() - min * 60000).toISOString();
  const post = (min, kind, text) => ({ t: at(min), kind, who: 'op-test', text });
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(cfg));
  fs.writeFileSync(
    path.join(dir, 'store.json'),
    JSON.stringify({
      cards: {
        // one narrow job, simply busy
        'c-one': {
          id: 'c-one',
          board: 'c',
          title: 'Rebuild the search index',
          status: 'inflight',
          decisions: [],
          log: entries(9, i => `search index: step ${i} of the rebuild`),
        },
        // two jobs on one card
        'c-mix': {
          id: 'c-mix',
          board: 'c',
          title: 'Odds and ends',
          status: 'inflight',
          decisions: [],
          log: entries(9, i => (i % 2 ? `invoice export fixed for client ${i}` : `migration ${i} applied on dev`)),
        },
        'd-fail': {
          id: 'd-fail',
          board: 'd',
          title: 'Anything',
          status: 'inflight',
          decisions: [],
          log: entries(12, 'boom'),
        },
        // a long conversation about one change: asks and replies are not work news, so this card is not busy
        'e-talk': {
          id: 'e-talk',
          board: 'e',
          title: 'Rename the export column',
          status: 'inflight',
          decisions: [],
          log: entries(4, 'export column: renamed in the schema').concat(
            Array.from({ length: 10 }, (_, i) => post(30 - i, i % 2 ? 'REPLY' : 'ACTION', `column name choice ${i}`)),
          ),
        },
        'e-other': {
          id: 'e-other',
          board: 'e',
          title: 'Rebuild the search index',
          status: 'inflight',
          decisions: [],
          log: entries(9, i => `search index: step ${i} of the rebuild`),
        },
        // new work on a finished card
        'e-reuse': {
          id: 'e-reuse',
          board: 'e',
          title: 'Weekly summary',
          status: 'inflight',
          decisions: [],
          log: [
            post(50, 'STATUS', 'summary drafted'),
            { ...post(40, 'FYI', 'Delivered the weekly summary.'), event: 'task_finished' },
            post(20, 'ACTION', 'Shall I start on the follow-up export as well?'),
          ],
        },
        // a step said done is not the task finished
        'e-step': {
          id: 'e-step',
          board: 'e',
          title: 'Parser update',
          status: 'inflight',
          decisions: [],
          log: [post(25, 'STATUS', 'tests done for the parser'), post(15, 'ACTION', 'Promote it to Production?')],
        },
      },
      comments: {},
    }),
  );
  fs.writeFileSync(cfg.typesafeEnvFile, 'TYPESAFE_API_KEY=test-key\n');
  const env = Object.assign({}, process.env, { LH_JEV_URL: jev.url });
  const child = spawnServer(path.join(dir, 'config.json'), {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout.on('data', d => (out += d));
  child.stderr.on('data', d => (out += d));
  t.after(() => child.kill());
  for (let i = 0; i < 40 && !out.includes('listening'); i++) await wait(100);
  const conduct = async b => (await req(port, 'GET', `/api/boards/${b}/conduct?minutes=60`, 'OWNER')).body;

  let cd = await conduct('c');
  assert.equal(
    cd.signals.catchAll,
    0,
    'nothing is said while Jev has not read the busy cards: ' + JSON.stringify(cd.examples.catchAll),
  );
  await wait(400);
  assert.equal(jev.calls.length, 2, 'one reading per busy card');
  assert.ok(
    jev.calls.every(
      c => c.auth === 'Bearer test-key' && c.questions.join() === 'many' && c.task && c.posts.length === 9,
    ),
    JSON.stringify(jev.calls),
  );
  assert.ok(
    jev.calls.some(c => c.task.title === 'Rebuild the search index' && /^STATUS: search index/.test(c.posts[0])),
    'Jev reads the card title and its posts',
  );
  cd = await conduct('c');
  assert.deepEqual(
    cd.examples.catchAll.map(x => x.id),
    ['c-mix'],
    'the card holding two jobs is flagged, the busy single job is not: ' + JSON.stringify(cd.examples.catchAll),
  );
  assert.equal(cd.examples.catchAll[0].many, 0.9);
  await conduct('c');
  await wait(200);
  assert.equal(jev.calls.length, 2, 'the reading is remembered: no second call within the hour');

  // Jev failing: the busy card is flagged on volume alone, marked unjudged, and not asked again for ten minutes
  cd = await conduct('d');
  assert.equal(cd.signals.catchAll, 0, 'nothing while the reading is out');
  await wait(400);
  cd = await conduct('d');
  assert.deepEqual(
    cd.examples.catchAll.map(x => [x.id, x.judged]),
    [['d-fail', false]],
    'a failed reading falls back to the volume rule, marked: ' + JSON.stringify(cd.examples.catchAll),
  );
  await wait(200);
  assert.equal(jev.calls.length, 3, 'a failed reading is not retried at once');

  // busy is counted in work news only: the long conversation is not busy, and Jev reads only the work news
  cd = await conduct('e');
  await wait(400);
  assert.equal(jev.calls.length, 4, 'one reading, of the one busy card: ' + JSON.stringify(jev.calls.slice(3)));
  assert.equal(jev.calls[3].task.title, 'Rebuild the search index');
  assert.ok(
    jev.calls[3].posts.every(p => /^STATUS: /.test(p)),
    'Jev reads work news only',
  );
  cd = await conduct('e');
  assert.equal(cd.signals.catchAll, 0, 'no catch-all: ' + JSON.stringify(cd.examples.catchAll));
  // new work on a finished card is its own signal; a step said done is not the task finished
  assert.equal(cd.signals.afterDone, 1, JSON.stringify(cd.examples.afterDone));
  assert.equal(cd.examples.afterDone[0].id, 'e-reuse');
  assert.match(cd.examples.afterDone[0].text, /follow-up export.*after «Delivered the weekly summary\.»/);
});
