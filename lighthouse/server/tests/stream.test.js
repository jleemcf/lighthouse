'use strict';
const { spawnServer } = require('../../tests/sandbox.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const http = require('node:http');
const { req, wait } = require('./helpers');

async function until(condition) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (condition()) return;
    await wait(50);
  }
  assert.ok(condition(), 'timed out waiting for the server or stream');
}

function subscribe(t, port, token) {
  const stream = { changes: [], raw: '', ready: false };
  const request = http.get(
    { host: '127.0.0.1', port, path: '/api/stream', headers: { Authorization: 'Bearer ' + token } },
    response => {
      assert.equal(response.statusCode, 200);
      let buffer = '';
      response.setEncoding('utf8');
      response.on('data', chunk => {
        stream.raw += chunk;
        buffer += chunk;
        let end;
        while ((end = buffer.indexOf('\n\n')) !== -1) {
          const frame = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          if (frame.startsWith('event: hello\n')) stream.ready = true;
          if (frame.startsWith('event: change\n')) stream.changes.push(JSON.parse(frame.split('\ndata: ')[1]));
        }
      });
      response.on('error', error => (stream.error = error));
    },
  );
  request.on('error', error => (stream.error = error));
  t.after(() => request.destroy());
  return stream;
}

test('streams expose only the same board changes as the authenticated poll feed', async t => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-stream-'));
  const listener = net.createServer();
  await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
  const port = listener.address().port;
  await new Promise(resolve => listener.close(resolve));
  const config = path.join(home, 'config.json');
  fs.writeFileSync(
    config,
    JSON.stringify({
      port,
      bind: '127.0.0.1',
      storeFile: 'store.json',
      tokens: { ONE: { name: 'single', via: 'page' }, BOTH: { name: 'both', via: 'page' } },
      boards: {
        alpha: { access: { single: 'viewer', both: 'owner' } },
        beta: { access: { both: 'owner' } },
      },
    }),
  );
  const env = { ...process.env };
  delete env.TYPESAFE_API_KEY;
  const child = spawnServer(config, { env });
  let output = '';
  child.stdout.on('data', data => (output += data));
  child.stderr.on('data', data => (output += data));
  t.after(async () => {
    if (child.exitCode === null) {
      await new Promise(resolve => {
        child.once('exit', resolve);
        child.kill();
      });
    }
    fs.rmSync(home, { recursive: true, force: true });
  });
  await until(() => output.includes('listening'));
  const single = subscribe(t, port, 'ONE');
  const both = subscribe(t, port, 'BOTH');
  await until(() => single.ready && both.ready);
  const hidden = await req(port, 'PUT', '/api/cards/beta-private', { board: 'beta', title: 'Private' }, 'BOTH');
  assert.equal(hidden.status, 200);
  const visible = await req(port, 'PUT', '/api/cards/alpha-visible', { board: 'alpha', title: 'Visible' }, 'BOTH');
  assert.equal(visible.status, 200);
  await until(() => both.changes.length === 2 && single.changes.some(change => change.board === 'alpha'));
  assert.equal(single.error, undefined);
  assert.equal(both.error, undefined);
  assert.deepEqual(
    both.changes.map(change => change.board),
    ['beta', 'alpha'],
  );
  assert.deepEqual(
    single.changes.map(change => change.board),
    ['alpha'],
  );
  assert.ok(!single.raw.includes('beta-private'), 'no private record, including its id, reaches the one-board reader');
  for (const [token, stream] of [
    ['ONE', single],
    ['BOTH', both],
  ]) {
    const poll = await req(port, 'GET', '/api/changes?since=0', null, token);
    assert.equal(poll.status, 200);
    assert.deepEqual(stream.changes, poll.body.changes);
  }
});
