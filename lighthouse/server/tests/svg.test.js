// SVG attachments, for charts such as the statechart skill's: the board takes an SVG as it takes a PNG, cleans it on
// the way in as it cleans the steward's diagrams, and serves it alone under a sandbox; one with its own declarations,
// or not an SVG at all, is refused.
// Run: node --test lighthouse/server/tests/svg.test.js
'use strict';
const { testPort, spawnServer } = require('../../tests/sandbox.cjs');
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs'),
  os = require('node:os'),
  path = require('node:path'),
  http = require('node:http');
const wait = ms => new Promise(r => setTimeout(r, ms));
function req(port, method, p, body, token, type) {
  return new Promise((resolve, reject) => {
    const data =
      body == null
        ? null
        : Buffer.isBuffer(body)
          ? body
          : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
    const r = http.request(
      {
        host: '127.0.0.1',
        port,
        method,
        path: p,
        headers: Object.assign(
          { Authorization: 'Bearer ' + token },
          data ? { 'Content-Type': type || 'application/json', 'X-Name': 'chart.svg' } : {},
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
          resolve({ status: res.statusCode, headers: res.headers, raw: d, body: j });
        });
      },
    );
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

test('an SVG attachment: taken, cleaned, served as an image only', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lhsvg-'));
  const port = await testPort();
  fs.writeFileSync(
    path.join(dir, 'config.json'),
    JSON.stringify({
      port,
      bind: '127.0.0.1',
      storeFile: 'store.json',
      tokens: { OWNER: { name: 'owner', via: 'page' }, OPS: { name: 'op-s', via: 'api' } },
      boards: { s: { name: 'Signal', access: { owner: 'owner', 'op-s': 'operator' } } },
    }),
  );
  fs.writeFileSync(path.join(dir, 'store.json'), JSON.stringify({ cards: {}, comments: {} }));
  let out = '';
  const child = spawnServer(path.join(dir, 'config.json'), {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', d => (out += d));
  child.stderr.on('data', d => (out += d));
  t.after(() => child.kill());
  for (let i = 0; i < 60 && !out.includes('listening'); i++) await wait(100);
  const up = svg => req(port, 'POST', '/api/attachments', svg, 'OPS', 'image/svg+xml');

  // a chart as a drawing tool writes it, document type and all
  const chart =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">\n' +
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 40" onload="alert(1)"><script>alert(2)</script>' +
    '<a href="javascript:alert(3)"><rect width="100" height="40" fill="#eee"/></a>' +
    '<text x="10" y="25">Idle</text></svg>\n';
  let r = await up(chart);
  assert.equal(r.status, 201, r.raw);
  assert.equal(r.body.type, 'image/svg+xml');
  assert.equal(r.body.name, 'chart.svg');
  assert.equal((await req(port, 'GET', '/api/attachments/' + r.body.id, null, 'OWNER')).status, 403);
  const got = await req(port, 'GET', '/api/attachments/' + r.body.id, null, 'OPS');
  assert.equal(got.status, 200);
  assert.equal(got.headers['content-type'], 'image/svg+xml');
  assert.equal(got.headers['x-content-type-options'], 'nosniff');
  assert.match(got.headers['content-security-policy'], /sandbox/);
  assert.match(got.headers['content-security-policy'], /default-src 'none'/);
  assert.ok(/<text x="10" y="25">Idle<\/text>/.test(got.raw), 'the chart itself kept');
  assert.ok(
    !/<script|onload|javascript:|DOCTYPE/i.test(got.raw),
    'no script, handler, script link or document type: ' + got.raw,
  );

  // refused: declarations of its own, or not an SVG
  assert.equal(
    (await up('<!DOCTYPE svg [<!ENTITY a "aaaa">]><svg xmlns="http://www.w3.org/2000/svg">&a;</svg>')).status,
    415,
    'no entities',
  );
  assert.equal((await up('<html><body>hello</body></html>')).status, 415, 'an SVG document only');
  assert.equal((await up('<svg xmlns="http://www.w3.org/2000/svg"><script')).status, 415, 'not a whole SVG');
  // a message can carry it, as any picture
  r = await up('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 4"><circle cx="2" cy="2" r="2"/></svg>');
  assert.equal(r.status, 201);
  const m = await req(
    port,
    'POST',
    '/api/comments',
    { board: 's', text: 'the chart', attachments: [r.body.id] },
    'OPS',
  );
  assert.equal(m.status, 201);
  assert.equal(m.body.attachments[0].type, 'image/svg+xml');
  assert.equal((await req(port, 'GET', '/api/attachments/' + r.body.id, null, 'OWNER')).status, 200);
});
