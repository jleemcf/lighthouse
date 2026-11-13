'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn, spawnSync } = require('node:child_process');
const { python, env } = require('../../verification/update/bootstrap-replay.cjs');
const scripts = path.join(__dirname, '../scripts');
const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
async function until(predicate) {
  const deadline = Date.now() + 5000;
  while (!predicate()) {
    assert.ok(Date.now() < deadline, 'watcher reaches expected state');
    await pause(15);
  }
}
async function fixture(context, handler, initial = 1, settings = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'board-inbox-'));
  for (const name of [
    'boardwatch.cjs',
    'watch-output.cjs',
    'watch-lease.cjs',
    'collector.py',
    'collector_usage.py',
    'helper_generation.py',
  ])
    fs.copyFileSync(path.join(scripts, name), path.join(home, name));
  const cursor = path.join(home, 'boardwatch-fixture.json');
  fs.writeFileSync(cursor, typeof initial === 'string' ? initial : JSON.stringify({ seq: initial, said: [] }));
  fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify(settings));
  const server = http.createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const environment = { ...process.env };
  delete environment.TYPESAFE_API_KEY;
  delete environment.LH_MONITOR_LEASE;
  delete environment.LH_MONITOR_LEASE_TOKEN;
  const child = spawn(
    process.execPath,
    [
      path.join(home, 'boardwatch.cjs'),
      '--server',
      'http://127.0.0.1:' + server.address().port,
      '--board',
      'fixture',
      '--interval',
      '0.04',
    ],
    { env: environment, stdio: 'pipe' },
  );
  let output = '';
  child.stdout.setEncoding('utf8').on('data', text => (output += text));
  context.after(async () => {
    child.kill();
    await until(() => child.exitCode !== null || child.signalCode !== null);
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(home, { recursive: true, force: true });
  });
  return {
    output: () => output,
    cursor: () => JSON.parse(fs.readFileSync(cursor, 'utf8')),
    targets: () => {
      const code = 'import collector,json,sys; print(json.dumps(collector.woke_targets(sys.stdin.read())))';
      const result = spawnSync(python, ['-c', code], { cwd: home, env, input: output, encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr);
      return JSON.parse(result.stdout);
    },
  };
}
const json = (response, body, status = 200) => {
  response.writeHead(status, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(body));
};
test('boardwatch announces coordinator notices once with their principal and inbox target', async context => {
  let polls = 0;
  const watcher = await fixture(
    context,
    (request, response) => {
      if (request.url === '/api/whoami') return json(response, { principal: 'fixture' });
      if (request.url.startsWith('/api/changes')) {
        polls++;
        return json(response, { seq: 9, changes: [] });
      }
      return json(response, {
        comments: [
          {
            id: 'notice',
            sid: 'mabcdef',
            by: 'coordinating-login',
            author: 'coordinator',
            kind: 'notice',
            via: 'api',
            cardId: 'fixture-inbox',
            text: 'Review existing work.',
          },
          { id: 'ordinary', by: 'operator', via: 'api', handled: true, text: 'Ordinary api reply.' },
        ],
      });
    },
    9,
  );
  await until(() => watcher.cursor().said.includes('m:notice') && polls >= 4);
  assert.equal(watcher.output().split('Review existing work.').length - 1, 1);
  assert.match(watcher.output(), /NOTICE from coordinating-login \(coordinator, not the owner\)/);
  assert.doesNotMatch(watcher.output(), /Watch \(operator\)|Ordinary api reply/);
  assert.deepEqual(watcher.targets(), ['inbox']);
});

for (const author of ['coordinator', 'owner']) {
  test('boardwatch delivers ' + author + ' attachments once and reports unavailable images', async context => {
    let polls = 0;
    let downloads = 0;
    const watcher = await fixture(context, (request, response) => {
      if (request.url === '/api/whoami') return json(response, { principal: 'fixture' });
      if (request.url.startsWith('/api/changes')) {
        polls++;
        return json(response, { seq: 1, changes: [] });
      }
      if (request.url === '/api/attachments/picture') {
        downloads++;
        response.writeHead(200, { 'Content-Type': 'image/png' });
        return response.end('synthetic image bytes');
      }
      if (request.url === '/api/attachments/missing') return json(response, {}, 404);
      return json(response, {
        comments: [
          {
            id: 'image-only',
            by: author,
            author,
            via: 'page',
            cardId: 'fixture-inbox',
            text: '',
            ...(author === 'coordinator' ? { kind: 'notice' } : {}),
            attachments: [
              { id: 'picture', type: 'image/png' },
              { id: 'missing', name: 'missing.png' },
            ],
          },
        ],
      });
    });
    await until(() => watcher.cursor().said.includes('m:image-only') && polls >= 4);
    assert.equal(downloads, 1, 'an attachment-only message delivers its image before it is marked announced');
    const image = watcher.output().match(/\[image: ([^\]]+)\]/);
    assert.ok(image, watcher.output());
    assert.equal(fs.readFileSync(image[1], 'utf8'), 'synthetic image bytes');
    assert.match(watcher.output(), /image missing.png could not be fetched: attachment missing answered 404/);
    assert.deepEqual(watcher.targets(), ['inbox']);
    if (author === 'coordinator')
      assert.match(watcher.output(), /NOTICE from coordinator \(coordinator, not the owner\)/);
  });
}

for (const failure of ['503', 'disconnect']) {
  test('boardwatch retries an inbox ' + failure + ' without consuming its event or seen key', async context => {
    let recover = false;
    let polls = 0;
    const watcher = await fixture(context, (request, response) => {
      if (request.url === '/api/whoami') return json(response, { principal: 'fixture' });
      if (request.url.startsWith('/api/changes')) {
        polls++;
        return json(response, { seq: 2, changes: [{ board: 'fixture', kind: 'comment', id: 'one' }] });
      }
      if (!recover) {
        if (failure === '503') return json(response, { error: 'fixture outage' }, 503);
        response.writeHead(200);
        response.write('{"comments":');
        return setTimeout(() => response.destroy(), 5);
      }
      return json(response, { comments: [{ id: 'one', by: 'owner', text: 'recovered request' }] });
    });
    await until(() => watcher.output().includes('inbox read failed'));
    assert.deepEqual(watcher.cursor(), { seq: 1, said: [] });
    recover = true;
    await until(() => watcher.cursor().seq === 2);
    const deliveredAt = polls;
    await until(() => polls >= deliveredAt + 3);
    assert.equal(watcher.output().split('recovered request').length - 1, 1);
    assert.deepEqual(watcher.cursor().said, ['m:one']);
  });
}
test('boardwatch reconciles a multi-event catch-up with one inbox read per poll', async context => {
  let polls = 0;
  let inboxReads = 0;
  const comments = [
    { id: 'one', by: 'owner', text: 'first request' },
    { id: 'two', by: 'owner', text: 'second request' },
    { id: 'part-a', by: 'owner', text: 'bundle first', bundleId: 'bundle' },
    { id: 'part-b', by: 'owner', text: 'bundle second', bundleId: 'bundle' },
    { id: 'handled', by: 'owner', text: 'already handled', handled: true },
    { id: 'agent', by: 'operator', text: 'agent reply', via: 'api' },
  ];
  const watcher = await fixture(context, (request, response) => {
    if (request.url === '/api/whoami') return json(response, { principal: 'fixture' });
    if (request.url.startsWith('/api/changes')) {
      polls++;
      return json(response, {
        seq: 4,
        changes: [
          { board: 'fixture', kind: 'comment', id: 'one' },
          { board: 'fixture', kind: 'comment', id: 'two' },
          { board: 'fixture', kind: 'bundle', id: 'bundle' },
        ],
      });
    }
    inboxReads++;
    return json(response, { comments });
  });
  await until(() => watcher.cursor().seq === 4 && polls >= 4 && inboxReads === polls);
  for (const message of comments.slice(0, 4))
    assert.equal(watcher.output().split(message.text).length - 1, 1, message.id);
  assert.equal(watcher.output().split('sent one message in 2 parts').length - 1, 1);
  assert.doesNotMatch(watcher.output(), /already handled|agent reply/);
  assert.deepEqual(watcher.cursor().said, ['m:one', 'm:two', 'm:part-a', 'm:part-b']);
});
test('boardwatch reconciles pending messages when its saved change cursor is current', async context => {
  const watcher = await fixture(
    context,
    (request, response) => {
      if (request.url === '/api/whoami') return json(response, { principal: 'fixture' });
      if (request.url.startsWith('/api/changes')) return json(response, { seq: 9, changes: [] });
      return json(response, { comments: [{ id: 'pending', by: 'owner', text: 'old pending request' }] });
    },
    9,
  );
  await until(() => watcher.cursor().said.includes('m:pending'));
  assert.match(watcher.output(), /old pending request/);
  assert.equal(watcher.cursor().seq, 9);
});
for (const initial of ['', '{"seq":9,"said":[']) {
  test(
    'boardwatch recovers pending messages from a ' + (initial ? 'truncated' : 'empty') + ' cursor',
    async context => {
      let polls = 0;
      const watcher = await fixture(
        context,
        (request, response) => {
          if (request.url === '/api/whoami') return json(response, { principal: 'fixture' });
          if (request.url.startsWith('/api/changes')) {
            polls++;
            return json(response, { seq: 9, changes: [] });
          }
          return json(response, { comments: [{ id: 'pending', by: 'owner', text: 'recovered pending request' }] });
        },
        initial,
      );
      await until(() => watcher.output().includes('recovered pending request'));
      await until(() => polls >= 3);
      assert.ok(watcher.cursor().said.includes('m:pending'));
      assert.equal(watcher.cursor().seq, 9);
      assert.equal(watcher.output().split('recovered pending request').length - 1, 1);
    },
  );
}

test('boardwatch cursor replacement never exposes an empty file and preserves its mode', context => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'board-cursor-'));
  context.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const cursor = path.join(home, 'cursor.json');
  const previous = JSON.stringify({ seq: 1, said: [] });
  fs.writeFileSync(cursor, previous, { mode: 0o640 });
  const mode = fs.statSync(cursor).mode & 0o777;
  const visible = [];
  let flushed = false;
  let attempts = 0;
  const observed = {
    ...fs,
    writeFileSync(file, content, options) {
      const descriptor = fs.openSync(file, 'w', options?.mode);
      try {
        visible.push(fs.readFileSync(cursor, 'utf8'));
        fs.writeFileSync(descriptor, content);
        if (options?.flush) {
          fs.fsyncSync(descriptor);
          flushed = true;
        }
      } finally {
        fs.closeSync(descriptor);
      }
    },
    renameSync(source, target) {
      assert.equal(flushed, true, 'new cursor is flushed before replacement');
      if (++attempts === 1) throw Object.assign(new Error('fixture sharing violation'), { code: 'EPERM' });
      fs.renameSync(source, target);
    },
  };
  const source = fs.readFileSync(path.join(scripts, 'boardwatch.cjs'), 'utf8').replace(/\r/g, '');
  const body = source.split('const saveCursor = () => {')[1].split('\n};')[0];
  const save = new Function('fs', 'lease', 'CURSOR', 'seq', 'said', 'Date', body);
  save(observed, { check() {} }, cursor, 9, new Set(['m:pending']), Date);
  assert.equal(attempts, 2, 'transient sharing violation is retried before publishing');
  assert.deepEqual(visible, [previous], 'a reader between truncation and writing sees the previous cursor');
  assert.deepEqual(JSON.parse(fs.readFileSync(cursor, 'utf8')), { seq: 9, said: ['m:pending'] });
  assert.equal(fs.statSync(cursor).mode & 0o777, mode);
  assert.deepEqual(fs.readdirSync(home), ['cursor.json']);
  for (const code of ['EIO', 'EPERM']) {
    fs.writeFileSync(cursor, previous);
    let failedAttempts = 0;
    let time = 0;
    const failure = Object.assign(new Error('fixture persistent failure'), { code });
    const failing = {
      ...observed,
      renameSync() {
        failedAttempts++;
        throw failure;
      },
    };
    assert.throws(
      () => save(failing, { check() {} }, cursor, 9, new Set(), { now: () => (time += 300) }),
      error => error === failure,
    );
    assert.equal(failedAttempts, code === 'EIO' ? 1 : 2, 'permanent failures are bounded and surfaced');
    assert.equal(fs.readFileSync(cursor, 'utf8'), previous);
    assert.deepEqual(fs.readdirSync(home), ['cursor.json']);
  }
});
test('boardwatch labels owner aliases with the configured display name', async context => {
  const watcher = await fixture(
    context,
    (request, response) => {
      if (request.url === '/api/whoami') return json(response, { principal: 'fixture' });
      if (request.url.startsWith('/api/changes')) return json(response, { seq: 2, changes: [] });
      return json(response, {
        comments: [
          { id: 'primary', by: 'captain-42', sid: 'primary', text: 'primary request' },
          { id: 'alias', by: 'captain-alias', sid: 'alias', text: 'alias request' },
          { id: 'other', by: 'operator', sid: 'other', text: 'operator request' },
        ],
      });
    },
    1,
    { ownerId: 'captain-42', ownerName: 'Casey', ownerAliases: ['captain-alias'] },
  );
  await until(() => watcher.cursor().said.includes('m:other'));
  assert.match(watcher.output(), /Casey \(primary, general\): primary request/);
  assert.match(watcher.output(), /Casey \(alias, general\): alias request/);
  assert.match(watcher.output(), /Operator \(other, general\): operator request/);
  assert.doesNotMatch(watcher.output(), /Captain-alias \(/);
});

async function messages(context, comments, settings = {}) {
  const watcher = await fixture(
    context,
    (request, response) => {
      if (request.url === '/api/whoami') return json(response, { principal: 'fixture' });
      if (request.url.startsWith('/api/changes')) return json(response, { seq: 2, changes: [] });
      return json(response, { comments });
    },
    1,
    settings,
  );
  await until(() => watcher.cursor().said.length === comments.length);
  return watcher;
}

for (const aliases of [{ alias: true }, 'alias']) {
  test('boardwatch ignores non-array ownerAliases: ' + typeof aliases, async context => {
    const watcher = await messages(context, [{ id: 'one', by: 'a', text: 'ordinary author' }], {
      ownerId: 'captain-42',
      ownerName: 'Casey',
      ownerAliases: aliases,
    });
    assert.equal(watcher.output(), 'A (general): ordinary author\n');
    assert.deepEqual(watcher.targets(), []);
  });
}

test('boardwatch distinguishes a non-owner display collision from collector owner routing', async context => {
  const watcher = await messages(
    context,
    [{ id: 'collision', by: 'casey', cardId: 'fixture-other', text: 'not the owner' }],
    { ownerId: 'captain-42', ownerName: 'Casey' },
  );
  assert.equal(watcher.output(), 'Casey [non-owner] (board, card other): not the owner\n');
  assert.deepEqual(watcher.targets(), []);
});

for (const principal of ['captain-42', 'captain-alias']) {
  test('boardwatch uses the owner display name in bundle headers: ' + principal, async context => {
    const watcher = await messages(
      context,
      [{ id: 'part', by: principal, bundleId: 'bundle', text: 'bundle request' }],
      { ownerId: 'captain-42', ownerName: 'Casey', ownerAliases: ['captain-alias'] },
    );
    assert.equal(
      watcher.output(),
      'Casey sent one message in 1 parts, each labelled with its task; answer each part with a line naming it:\n' +
        'Casey (general): bundle request\n',
    );
    assert.deepEqual(watcher.targets(), ['general']);
  });
}

test('boardwatch and collector share the unconfigured gate owner label', async context => {
  const watcher = await messages(context, [{ id: 'one', by: 'owner', text: 'default request' }]);
  assert.equal(watcher.output(), 'the captain (general): default request\n');
  assert.deepEqual(watcher.targets(), ['general']);
});

test('boardwatch keeps no-alias compatibility announcements byte-identical', async context => {
  const profile = path.resolve(__dirname, '../../../private/compatibility/profile.json');
  const settings = fs.existsSync(profile)
    ? JSON.parse(fs.readFileSync(profile, 'utf8')).server
    : { ownerId: 'casey', ownerName: 'Casey' };
  const owner = settings.ownerName;
  const watcher = await messages(
    context,
    [
      { id: 'general', by: settings.ownerId, text: 'general request' },
      { id: 'direct', by: settings.ownerId, kind: 'direct', text: 'direct request' },
      { id: 'card', by: settings.ownerId, cardId: 'fixture-work', text: 'card request' },
      { id: 'part-a', by: settings.ownerId, bundleId: 'bundle', text: 'part one' },
      { id: 'part-b', by: settings.ownerId, bundleId: 'bundle', cardId: 'fixture-work', text: 'part two' },
      { id: 'other', by: 'operator', text: 'operator request' },
    ],
    { ownerId: settings.ownerId, ownerName: owner },
  );
  assert.equal(
    watcher.output(),
    [
      owner + ' (general): general request',
      owner + ' (direct): direct request',
      owner + ' (board, card work): card request',
      owner + ' sent one message in 2 parts, each labelled with its task; answer each part with a line naming it:',
      owner + ' (general): part one',
      owner + ' (board, card work): part two',
      'Operator (general): operator request',
      '',
    ].join('\n'),
  );
  assert.deepEqual(watcher.targets(), ['general', 'work']);
});
