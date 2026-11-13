'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { PassThrough } = require('node:stream');
const zlib = require('node:zlib');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const makeWeb = require('../web');
const fixture = require('./release-fixture');
const { readBody, readRaw } = makeWeb({ cfg: {} });

test('readBody preserves a multibyte character split across network chunks', async () => {
  const request = new PassThrough();
  const result = readBody(request);
  const body = Buffer.from(JSON.stringify({ text: 'Clock 🕒 — café' }));
  const split = body.indexOf(Buffer.from('🕒')) + 1;
  request.write(body.subarray(0, split));
  request.end(body.subarray(split));
  assert.deepEqual(await result, { text: 'Clock 🕒 — café' });
});

for (const [name, read] of [
  ['JSON', readBody],
  ['raw upload', request => readRaw(request, 100)],
]) {
  for (const event of ['aborted', 'error']) {
    test(`${name} rejects an ${event} instead of waiting for end`, async () => {
      const request = new PassThrough();
      request.on('error', () => {});
      const result = read(request);
      request.write('{');
      request.emit(event, new Error('fixture stream failure'));
      let deadline;
      try {
        await assert.rejects(
          Promise.race([result, new Promise(resolve => (deadline = setTimeout(() => resolve('still waiting'), 100)))]),
          /aborted|fixture stream failure/,
        );
      } finally {
        clearTimeout(deadline);
        request.destroy();
      }
    });
  }
}

test('malformed sign-in cookies behave like an absent cookie and a valid link repairs them', async test => {
  const board = await fixture(test);
  const broken = { Cookie: 'lhtoken=%E0%A4%A' };
  const anonymous = await board.raw('GET', '/api/whoami', null, broken, null);
  const absent = await board.raw('GET', '/api/whoami', null, {}, null);
  assert.equal(anonymous.status, absent.status);
  assert.deepEqual(anonymous.body, absent.body);
  const page = await board.raw('GET', '/?token=OWNER', null, broken, null);
  assert.equal(page.status, 200);
  assert.match(page.headers['set-cookie'][0], /^lhtoken=OWNER;/);
});

test('index negotiates async gzip while preserving type, freshness and sign-in cookies', async test => {
  const board = await fixture(test);
  const plain = await board.raw('GET', '/?token=OWNER', null, {}, null);
  const compressed = await board.raw('GET', '/index.html?token=OWNER', null, { 'Accept-Encoding': 'gzip' }, null);
  assert.equal(plain.status, 200);
  assert.equal(compressed.status, 200);
  assert.equal(plain.headers['content-encoding'], undefined);
  assert.equal(compressed.headers['content-encoding'], 'gzip');
  assert.deepEqual(zlib.gunzipSync(compressed.buf), plain.buf);
  for (const result of [plain, compressed]) {
    assert.equal(result.headers['content-type'], 'text/html; charset=utf-8');
    assert.equal(result.headers['cache-control'], 'no-store');
    assert.match(result.headers['set-cookie'][0], /^lhtoken=OWNER;/);
  }
  const declined = await board.raw('GET', '/', null, { 'Accept-Encoding': 'gzip;q=0, identity' }, null);
  assert.equal(declined.headers['content-encoding'], undefined);
  const signedIn = await board.raw(
    'GET',
    '/?token=ALPHA',
    null,
    { Cookie: 'lhtoken=OWNER', 'Accept-Encoding': 'gzip' },
    null,
  );
  assert.equal(signedIn.headers['set-cookie'], undefined);
  assert.equal(compressed.headers.vary, 'Accept-Encoding');
});

test('routes use URL query parsing without legacy url.parse warnings', async test => {
  const board = await fixture(test);
  const result = await board.raw('GET', '/api/whoami?token=ALPHA', null, {}, null);
  assert.equal(result.status, 200);
  assert.equal(result.body.principal, 'alpha');
  assert.doesNotMatch(board.output(), /DEP0169/);
});

test('spent claims log a marker without exposing the claim credential', async test => {
  const board = await fixture(test);
  const code = crypto.randomBytes(4).toString('hex').toUpperCase();
  const claims = path.join(board.directory, 'claims');
  fs.mkdirSync(claims, { recursive: true });
  fs.writeFileSync(path.join(claims, code + '.json'), JSON.stringify({ name: 'alpha', exp: Date.now() + 60000 }));
  const result = await board.request('POST', '/api/claim', { code }, null);
  assert.equal(result.status, 200);
  assert.equal(result.body.name, 'alpha');
  assert.equal(fs.existsSync(path.join(claims, code + '.json')), false);
  assert.ok(!board.output().includes(code), 'claim credential must not appear in the server log');
  assert.match(board.output(), /claim \[used\] \(lines\) spent by alpha/);
});

test('receipts neutralize nested angle quotes in outside text', async test => {
  const board = await fixture(test);
  assert.equal(
    (
      await board.request(
        'POST',
        '/api/comments',
        {
          board: 'alpha',
          text: 'Read «inside» then continue',
        },
        'OWNER',
      )
    ).status,
    201,
  );
  const result = await board.request('GET', '/api/boards/alpha/status?detail=full');
  assert.equal(result.status, 200);
  assert.match(result.body.receipt, /«Read ‹inside› then continue»/);
});
