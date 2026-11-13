// What the page reads at every change, kept small so that a busy board stays quick to operate: a reply over 16 KB
// compressed for a client that asks, a card done for over three days light in the state and whole from
// /api/cards/<id>, General's newest N with the whole count.
// Run: node --test lighthouse/server/tests/speed.test.js
'use strict';
const { testPort, spawnServer } = require('../../tests/sandbox.cjs');
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs'),
  os = require('node:os'),
  path = require('node:path'),
  http = require('node:http'),
  zlib = require('node:zlib');
const wait = ms => new Promise(r => setTimeout(r, ms));
function req(port, p, token, headers) {
  return new Promise((resolve, reject) => {
    const r = http.request(
      { host: '127.0.0.1', port, path: p, headers: Object.assign({ Authorization: 'Bearer ' + token }, headers || {}) },
      res => {
        const b = [];
        res.on('data', c => b.push(c));
        res.on('end', () => {
          const raw = Buffer.concat(b),
            enc = res.headers['content-encoding'];
          let j = null;
          try {
            j = JSON.parse((enc === 'gzip' ? zlib.gunzipSync(raw) : raw).toString('utf8'));
          } catch {}
          resolve({ status: res.statusCode, enc, bytes: raw.length, body: j });
        });
      },
    );
    r.on('error', reject);
    r.end();
  });
}

test("the page's reads stay small: compressed, old finished cards light, General's newest only", async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lhsp-'));
  const port = await testPort();
  const old = new Date(Date.now() - 5 * 86400000).toISOString(),
    recent = new Date(Date.now() - 3600000).toISOString();
  const log = Array.from({ length: 30 }, (_, i) => ({
    t: old,
    kind: 'STATUS',
    who: 'op-s',
    text: 'a long status line, number ' + i + ' '.repeat(200),
  }));
  const cards = {
    's-old': {
      id: 's-old',
      board: 's',
      title: 'Old',
      status: 'done',
      createdAt: old,
      updatedAt: old,
      context: 'what it was about',
      log,
      decisions: [],
    },
    's-new': {
      id: 's-new',
      board: 's',
      title: 'Recent',
      status: 'done',
      createdAt: recent,
      updatedAt: recent,
      context: 'kept',
      log,
      decisions: [],
    },
    's-open': {
      id: 's-open',
      board: 's',
      title: 'Open',
      status: 'inflight',
      createdAt: old,
      updatedAt: old,
      context: 'kept too',
      log,
      decisions: [],
    },
  };
  const comments = {};
  for (let i = 0; i < 250; i++) {
    const id = 'c' + String(i).padStart(4, '0');
    comments[id] = {
      id,
      board: 's',
      cardId: null,
      t: new Date(Date.now() - (250 - i) * 60000).toISOString(),
      text: 'general message ' + i,
      by: i === 3 ? 'owner' : 'op-s',
      handled: i !== 3,
      attachments: [],
    };
  }
  fs.writeFileSync(
    path.join(dir, 'config.json'),
    JSON.stringify({
      port,
      bind: '127.0.0.1',
      storeFile: 'store.json',
      tokens: { OWNER: { name: 'owner', via: 'page' }, OTHER: { name: 'other', via: 'page' } },
      boards: { s: { name: 'Signal', access: { owner: 'owner' } } },
    }),
  );
  fs.writeFileSync(path.join(dir, 'store.json'), JSON.stringify({ cards, comments }));
  let out = '';
  const child = spawnServer(path.join(dir, 'config.json'), {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', d => (out += d));
  child.stderr.on('data', d => (out += d));
  t.after(() => child.kill());
  for (let i = 0; i < 60 && !out.includes('listening'); i++) await wait(100);

  // compressed only when asked: the board's own scripts never ask, and get it plain as before
  const plain = await req(port, '/api/state', 'OWNER'),
    gz = await req(port, '/api/state', 'OWNER', { 'Accept-Encoding': 'gzip, deflate' });
  assert.equal(plain.enc, undefined);
  assert.equal(gz.enc, 'gzip');
  assert.ok(gz.bytes < plain.bytes / 3, `${gz.bytes} vs ${plain.bytes}`);
  assert.deepEqual(gz.body, plain.body, 'the same reply');
  const small = await req(port, '/api/whoami', 'OWNER', { 'Accept-Encoding': 'gzip' });
  assert.equal(small.enc, undefined, 'a small reply goes as it is');

  // a card done for over three days rides light; a recent one and an open one whole
  const s = plain.body.cards;
  assert.equal(s['s-old'].lite, true);
  assert.equal(s['s-old'].log, undefined);
  assert.equal(s['s-old'].context, undefined);
  assert.equal(s['s-old'].logN, 30);
  assert.equal(s['s-old'].title, 'Old');
  assert.ok(!s['s-new'].lite && s['s-new'].log.length === 30 && s['s-new'].context === 'kept');
  assert.ok(!s['s-open'].lite && s['s-open'].log.length === 30);
  const whole = await req(port, '/api/cards/s-old', 'OWNER');
  assert.equal(whole.status, 200);
  assert.equal(whole.body.card.log.length, 30);
  assert.equal(whole.body.card.context, 'what it was about');
  assert.equal((await req(port, '/api/cards/s-old', 'OTHER')).status, 404, 'only for who reads its board');
  assert.equal((await req(port, '/api/cards/nope', 'OWNER')).status, 404);

  // General: the newest N on request, with the whole count and what still waits on an answer; without it, all as before
  const last = (await req(port, '/api/comments?board=s&general=true&last=200', 'OWNER')).body;
  assert.equal(last.comments.length, 200);
  assert.equal(last.total, 250);
  assert.equal(last.waiting, 1, 'his unanswered message, though older than the newest 200');
  assert.equal(last.comments[199].text, 'general message 249', 'the newest, oldest first');
  assert.equal((await req(port, '/api/comments?board=s&general=true', 'OWNER')).body.comments.length, 250);
});
