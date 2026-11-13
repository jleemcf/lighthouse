// What the scenario groups of server.test.js and toolcalls.test.js share: where the server is, and two small HTTP
// clients for it (JSON, and raw bytes with headers). Not a test file itself: the runner reads only *.test.js.
'use strict';
require('../../tests/sandbox.cjs');
const http = require('node:http');
function req(port, method, p, body, token) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
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
const wait = ms => new Promise(r => setTimeout(r, ms));
function rawReq(port, method, p, buf, headers, token) {
  return new Promise((resolve, reject) => {
    const r = http.request(
      {
        host: '127.0.0.1',
        port,
        method,
        path: p,
        headers: Object.assign({}, headers || {}, token ? { Authorization: 'Bearer ' + token } : {}),
      },
      res => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => {
          const b = Buffer.concat(chunks);
          let j = null;
          try {
            j = JSON.parse(b.toString('utf8'));
          } catch {}
          resolve({ status: res.statusCode, body: j, raw: b.toString('utf8'), buf: b, headers: res.headers });
        });
      },
    );
    r.on('error', reject);
    if (buf) r.write(buf);
    r.end();
  });
}

module.exports = { req, rawReq, wait };
