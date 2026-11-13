'use strict';
require('../../tests/sandbox.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');

test('the waker replays a saved answer after restart without another Codex run or claim', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-stwake-recovery-'));
  const home = path.join(directory, 'home');
  const steward = path.join(directory, 'steward');
  const codexHome = path.join(directory, 'codex');
  for (const folder of [home, steward, codexHome]) fs.mkdirSync(folder);
  const scripts = path.join(__dirname, '..', 'scripts');
  for (const file of ['stwake.cjs', 'steward-outbox.cjs', 'STEWARD-BRIEF.md', 'steward-schema.json'])
    fs.copyFileSync(path.join(scripts, file), path.join(home, file));
  fs.writeFileSync(path.join(home, 'LH-STEWARD-TOKEN.txt'), 'fixture-only');
  let claims = 0;
  let available = false;
  let accepted = false;
  let interrupted = false;
  let posts = 0;
  const posted = [];
  const requestId = '0123456789abcdef';
  const board = http.createServer((request, response) => {
    let raw = '';
    request.on('data', data => (raw += data));
    request.on('end', () => {
      const reply = (status, body) => {
        response.writeHead(status, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify(body));
      };
      if (request.url === '/api/steward/next') {
        claims++;
        return reply(200, {
          job: claims === 1 ? { request: requestId, kind: 'ask', text: 'ask request ' + requestId, attempt: 1 } : null,
        });
      }
      if (request.url === '/api/steward/result') {
        posts++;
        const body = JSON.parse(raw);
        posted.push(body);
        if (!available) return reply(503, { error: 'offline' });
        const duplicate = accepted;
        accepted = true;
        if (!duplicate) return request.socket.destroy();
        if (!interrupted) {
          interrupted = true;
          response.writeHead(200, { 'Content-Type': 'application/json' });
          response.write('{');
          return setImmediate(() => response.destroy());
        }
        return reply(200, { ok: true, request: body.request, duplicate: true });
      }
      return reply(200, { ok: true });
    });
  });
  await new Promise(resolve => board.listen(0, '127.0.0.1', resolve));
  const port = board.address().port;
  assert.notEqual(port, 7700);
  t.after(async () => {
    await new Promise(resolve => board.close(resolve));
    fs.rmSync(directory, { recursive: true, force: true });
  });
  fs.writeFileSync(
    path.join(home, 'steward-config.json'),
    JSON.stringify({
      server: 'http://127.0.0.1:' + port,
      board: 'test',
      stewardDir: steward,
      codexHome,
      codex: { node: process.execPath, js: path.join(__dirname, 'fake-codex.cjs') },
      pack: [],
    }),
  );
  const once = () =>
    new Promise((resolve, reject) => {
      let output = '';
      const child = spawn(process.execPath, [path.join(home, 'stwake.cjs'), '--once'], {
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 15000,
      });
      child.stdout.on('data', data => (output += data));
      child.stderr.on('data', data => (output += data));
      child.once('error', reject);
      child.once('exit', code => {
        if (code === 0) resolve();
        else reject(new Error(output));
      });
    });
  const pending = path.join(home, 'steward-state', 'pending-result.json');
  const ready = () => {
    const saved = JSON.parse(fs.readFileSync(pending, 'utf8'));
    saved.notBefore = 0;
    fs.writeFileSync(pending, JSON.stringify(saved));
  };
  await once();
  assert.equal(claims, 1);
  assert.ok(fs.existsSync(pending), 'the completed answer survives process exit');
  fs.writeFileSync(path.join(codexHome, 'help-broken'), 'unavailable');
  for (let attempt = 0; attempt < 4; attempt++) {
    ready();
    await once();
    assert.equal(claims, 1, 'a saved answer blocks another claim during an outage');
  }
  assert.equal(posts, 5, 'delivery continues beyond the old three-post limit');
  available = true;
  ready();
  await once();
  assert.equal(accepted, true);
  assert.ok(fs.existsSync(pending), 'a lost acknowledgement keeps the saved answer');
  ready();
  await once();
  assert.ok(fs.existsSync(pending), 'an interrupted acknowledgement also keeps the saved answer');
  ready();
  await once();
  assert.equal(fs.existsSync(pending), false);
  assert.ok(posted.every(body => JSON.stringify(body) === JSON.stringify(posted[0])));
  const calls = fs.readFileSync(path.join(codexHome, 'calls.jsonl'), 'utf8').trim().split(String.fromCharCode(10));
  assert.equal(calls.length, 1, 'the answer is paid for once, even if Codex later becomes unusable');
});
