'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { noticeFixture } = require('./coordinator-fixture.cjs');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

test('a real coordinator post wakes the real watcher once and an api operator comment stays quiet', async context => {
  const f = await noticeFixture(context);
  await f.open('inbox');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'coordinator-watch-'));
  const source = path.resolve(__dirname, '../../operator-kit/scripts');
  for (const file of ['boardwatch.cjs', 'watch-output.cjs', 'watch-lease.cjs'])
    fs.copyFileSync(path.join(source, file), path.join(home, file));
  const cursor = path.join(home, 'boardwatch-t.json');
  fs.writeFileSync(cursor, JSON.stringify({ seq: 1, said: [] }));
  const env = { ...process.env };
  delete env.TYPESAFE_API_KEY;
  delete env.LH_MONITOR_LEASE;
  delete env.LH_MONITOR_LEASE_TOKEN;
  const watcher = spawn(
    process.execPath,
    [path.join(home, 'boardwatch.cjs'), '--server', 'http://127.0.0.1:' + f.port, '--board', 't', '--interval', '0.04'],
    {
      env: { ...env, LH_TOKEN: 'LEGACY' },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let output = '';
  watcher.stdout.on('data', bytes => {
    output += bytes;
  });
  context.after(async () => {
    if (watcher.exitCode === null && watcher.signalCode === null) {
      const stopped = once(watcher, 'exit');
      watcher.kill();
      await stopped;
    }
    fs.rmSync(home, { recursive: true, force: true });
  });
  const notice = await f.notice({ cardId: 't-inbox', text: 'Notice delivered from board.' });
  await f.request('POST', '/api/comments', { cardId: 't-inbox', text: 'Quiet operator api comment.' }, 'LEGACY');
  await f.request('POST', '/api/comments', { cardId: 't-inbox', text: 'Owner unchanged.' }, 'CAPTAIN');
  const deadline = Date.now() + 5000;
  while (!output.includes('Notice delivered from board.') || !output.includes('Owner unchanged.')) {
    assert.ok(Date.now() < deadline, 'watcher announces both messages');
    await pause(20);
  }
  await pause(200);
  assert.equal(output.split('Notice delivered from board.').length - 1, 1);
  assert.match(output, /NOTICE from coordinator \(coordinator, not the owner\)/);
  assert.match(output, /the captain \(.*board, card inbox\): Owner unchanged/);
  assert.doesNotMatch(output, /Quiet operator api comment/);
  assert.ok(JSON.parse(fs.readFileSync(cursor, 'utf8')).said.includes('m:' + notice.body.id));
});
