'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const http = require('node:http');
const scripts = path.join(__dirname, '../scripts');
const text = '⏱ · “café” — 한글 🚢';
function functionSource(file, name) {
  const source = fs.readFileSync(path.join(scripts, file), 'utf8');
  const start = source.indexOf('function ' + name + '(');
  assert.ok(start >= 0, file + ' contains ' + name);
  const prefix = source.slice(Math.max(0, start - 6), start) === 'async ' ? 'async ' : '';
  return prefix + source.slice(start, source.indexOf('\n}', start) + 2);
}
const readers = [
  ['lighthouse-mcp.cjs', ['request'], 'return (await request("GET", "/fixture")).body.text;'],
  ['boardwatch.cjs', ['request', 'get'], 'return (await get("/fixture")).body.text;'],
  ['conductwatch.cjs', ['get'], 'return (await get("/fixture")).body.text;'],
  ['stwake.cjs', ['request'], 'return (await request("GET", "/fixture")).body.text;'],
  ['gate.cjs', ['refreshTracked'], 'await refreshTracked(Date.now()); return tracked[0].task;'],
  ['gate.cjs', ['judge'], 'return (await judge({ source: "fixture", line: "fixture" }, "fixture")).kind;'],
];
for (const [file, names, result] of readers) {
  test(file + ' ' + names.at(-1) + ' decodes a response split inside a UTF-8 character', async context => {
    const server = http.createServer((request, response) => {
      request.resume();
      const bytes = Buffer.from(
        JSON.stringify({
          text,
          cards: { fixture: { board: 'fixture', title: text, status: 'doing' } },
          answers: { attention: { noul: 0.1 }, repeat: { noul: 0.9 }, kind: { choice: text, confidence: 0.9 } },
        }),
      );
      response.writeHead(200, { 'Content-Type': 'application/json' });
      let offset = 0;
      const next = () => {
        const found = bytes.indexOf(Buffer.from(text), offset);
        if (found < 0) return response.end(bytes.subarray(offset));
        const split = found + 1;
        response.write(bytes.subarray(offset, split));
        offset = split;
        setTimeout(next, 25);
      };
      next();
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    context.after(() => new Promise(resolve => server.close(resolve)));
    const url = 'http://127.0.0.1:' + server.address().port;
    const definitions = names.map(name => functionSource(file, name)).join('\n');
    const code = '(async () => { let tracked = [], trackedAt = 0; ' + definitions + '\n' + result + ' })()';
    const value = await vm.runInNewContext(code, {
      http,
      https: require('node:https'),
      URL,
      Buffer,
      SERVER: url,
      JEV_URL: url,
      BOARD: 'fixture',
      TOKEN: 'fixture',
      SESSION: null,
      token: () => 'fixture',
      recent: [],
      lease: { check() {} },
      OPT: { trackedRefreshS: 0, recent: 1, jevTimeoutMs: 2000 },
      QUESTIONS: { kind: { criteria: { [text]: 'fixture' } } },
    });
    assert.equal(value, text);
    assert.doesNotMatch(value, /�/);
  });
}
