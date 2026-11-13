'use strict';
const { testPort, spawnServer } = require('../../tests/sandbox.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { req, rawReq, wait } = require('../../server/tests/helpers');

const SAFE_ENV = { ...process.env };
delete SAFE_ENV.TYPESAFE_API_KEY;
const SCRIPTS = path.join(__dirname, '..', 'scripts');
const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
  'base64',
);

test('tool attachments: local uploads and strict server ids', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-attachments-'));
  const port = await testPort();
  const home = path.join(dir, 'home');
  fs.mkdirSync(home);
  for (const file of [
    'lighthouse-mcp.cjs',
    'toolcalls-spec.json',
    'kit-version.cjs',
    'session-identity.cjs',
    'handoff.cjs',
    'dispatch-client.cjs',
    'dispatch-storage.cjs',
    'mcp-setup.cjs',
  ])
    fs.copyFileSync(path.join(SCRIPTS, file), path.join(home, file));
  fs.writeFileSync(
    path.join(dir, 'config.json'),
    JSON.stringify({
      port,
      bind: '127.0.0.1',
      storeFile: 'store.json',
      tokens: {
        OWNER: { name: 'owner', via: 'page' },
        OPS: { name: 'op-test', via: 'api', mode: 'tools' },
        SHADOW: { name: 'op-test', via: 'api', mode: 'tools', shadow: true },
      },
      boards: {
        t: { name: 'Test', protocol: 'tools', access: { owner: 'owner', 'op-test': 'operator' } },
        l: { name: 'Lines', access: { owner: 'owner', 'op-test': 'operator' } },
      },
    }),
  );
  fs.writeFileSync(
    path.join(dir, 'store.json'),
    JSON.stringify({
      cards: {
        'l-work': {
          id: 'l-work',
          board: 'l',
          title: 'Line work',
          status: 'inflight',
          decisions: [],
          log: [],
        },
      },
    }),
  );
  const child = spawnServer(path.join(dir, 'config.json'), {
    env: SAFE_ENV,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const stopped = new Promise(resolve => child.once('exit', resolve));
      child.kill();
      await stopped;
    }
    fs.rmSync(dir, { recursive: true, force: true });
  });
  let output = '';
  child.stdout.on('data', data => (output += data));
  child.stderr.on('data', data => (output += data));
  for (let attempt = 0; attempt < 50 && !output.includes('listening'); attempt++) await wait(100);
  assert.match(output, /listening/, output);

  const call = async (tool, args) => {
    const result = await req(
      port,
      'POST',
      '/api/boards/t/calls',
      { calls: [{ id: crypto.randomUUID(), tool, args }] },
      'OPS',
    );
    assert.equal(result.status, 200, result.raw);
    return result.body.results[0];
  };
  const kit = (tool, args, environment = {}) =>
    new Promise((resolve, reject) => {
      const subprocess = spawn(
        process.execPath,
        [path.join(home, 'lighthouse-mcp.cjs'), 'call', tool, JSON.stringify(args)],
        {
          cwd: dir,
          env: {
            ...SAFE_ENV,
            LH_SERVER: 'http://127.0.0.1:' + port,
            LH_BOARD: 't',
            LH_TOKEN: 'OPS',
            ...environment,
          },
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      );
      let text = '';
      subprocess.stdout.on('data', data => (text += data));
      subprocess.stderr.on('data', data => (text += data));
      subprocess.on('error', reject);
      subprocess.on('close', code => resolve({ code, text }));
    });
  const comments = async () => (await req(port, 'GET', '/api/comments?board=t', null, 'OWNER')).body.comments;
  const snapshot = async () => ({
    card: (await req(port, 'GET', '/api/state', null, 'OWNER')).body.cards['t-work'],
    comments: await comments(),
  });
  const argsFor = async tool => {
    if (tool === 'board_post') return { card: 'work', kind: 'status', text: 'The picture for this card.' };
    const question = 'Show the picture ' + crypto.randomUUID();
    await req(port, 'POST', '/api/comments', { cardId: 't-work', text: question }, 'OWNER');
    const message = (await comments()).find(row => row.text === question);
    return { card: 'work', to: message.sid, text: 'Here is the picture.' };
  };
  assert.equal(
    (
      await call('board_open', {
        title: 'Attachment work',
        context: 'Show the files on the card',
        slug: 'work',
        state: 'inflight',
      })
    ).ok,
    true,
  );

  const picture = path.join(dir, 'picture with spaces.PNG');
  fs.writeFileSync(picture, PIXEL);
  let knownId;
  for (const tool of ['board_post', 'board_reply']) {
    await t.test(tool + ' uploads a path onto its card', async () => {
      const result = await kit(tool, { ...(await argsFor(tool)), attachments: [picture] });
      assert.equal(result.code, 0, result.text);
      const row = (await comments()).filter(message => message.by === 'op-test').pop();
      assert.equal(row.cardId, 't-work');
      assert.equal(row.label, tool === 'board_post' ? 'STATUS' : 'REPLY');
      assert.equal(row.attachments.length, 1);
      const attachment = row.attachments[0];
      knownId = attachment.id;
      assert.equal(attachment.name, path.basename(picture));
      assert.equal(attachment.type, 'image/png');
      assert.equal(attachment.size, PIXEL.length);
      const download = await rawReq(port, 'GET', '/api/attachments/' + knownId, null, {}, 'OPS');
      assert.equal(download.status, 200);
      assert.deepEqual(download.buf, PIXEL);
    });
  }

  const wrong = path.join(dir, 'program.exe');
  const large = path.join(dir, 'large.pdf');
  const missing = path.join(dir, 'missing.png');
  const directory = path.join(dir, 'folder.png');
  const empty = path.join(dir, 'empty.png');
  fs.writeFileSync(wrong, 'not supported');
  fs.writeFileSync(large, Buffer.alloc(10 * 1024 * 1024 + 1));
  fs.mkdirSync(directory);
  fs.writeFileSync(empty, '');
  for (const tool of ['board_post', 'board_reply']) {
    for (const [file, reason] of [
      [wrong, /unsupported file type/],
      [large, /over 10 MB/],
      [missing, /ENOENT/],
      [directory, /not a readable file/],
      [empty, /empty body.*HTTP 400/],
    ]) {
      await t.test(tool + ' refuses ' + path.basename(file) + ' without posting or queuing', async () => {
        const args = await argsFor(tool);
        const before = await snapshot();
        const result = await kit(tool, { ...args, attachments: [picture, file] });
        assert.equal(result.code, 1, result.text);
        assert.ok(result.text.includes(path.basename(file)), result.text);
        assert.match(result.text, reason);
        assert.deepEqual(await snapshot(), before);
        assert.equal(fs.existsSync(path.join(home, 'calls-outbox.jsonl')), false);
      });
    }
    for (const invalid of ['0123456789abcdef', 'missing.png', '__proto__']) {
      await t.test(tool + ' server refuses unknown id ' + invalid + ' without changing the card', async () => {
        const args = await argsFor(tool);
        const before = await snapshot();
        const result = await call(tool, { ...args, attachments: [knownId, invalid], title: 'Do not change' });
        assert.equal(result.ok, false);
        assert.match(result.reason, /Unknown attachment/);
        assert.ok(result.reason.includes(invalid), result.reason);
        assert.deepEqual(await snapshot(), before);
      });
    }
    await t.test(tool + ' accepts an existing id in the kit and the server', async () => {
      let result = await kit(tool, { ...(await argsFor(tool)), attachments: [knownId] });
      assert.equal(result.code, 0, result.text);
      result = await call(tool, { ...(await argsFor(tool)), attachments: [knownId] });
      assert.equal(result.ok, true, result.reason);
      const rows = (await comments()).filter(message => message.by === 'op-test').slice(-2);
      assert.equal(rows.length, 2);
      for (const row of rows) assert.equal(row.attachments[0].id, knownId);
    });
  }

  for (const tool of ['board_post', 'board_reply']) {
    for (const shadow of [false, true]) {
      await t.test(tool + ' rehearsals refuse local paths and still accept ids; shadow=' + shadow, async () => {
        const environment = shadow ? { LH_BOARD: 'l', LH_TOKEN: 'SHADOW', LH_SHADOW: '1' } : {};
        const args = shadow
          ? tool === 'board_post'
            ? { card: 'work', kind: 'fyi', text: 'Rehearsal.' }
            : { general: true, to: 'chat', text: 'Rehearsal.' }
          : { ...(await argsFor(tool)), dry_run: true };
        const before = await snapshot();
        const lineBefore = (await req(port, 'GET', '/api/state', null, 'OWNER')).body.cards['l-work'];
        const filesBefore = fs.readdirSync(path.join(dir, 'attachments')).sort();
        let result = await kit(tool, { ...args, attachments: [knownId, picture] }, environment);
        assert.equal(result.code, 1, result.text);
        assert.ok(result.text.includes(path.basename(picture)), result.text);
        assert.match(result.text, /dry run or shadow session/);
        result = await kit(tool, { ...args, attachments: [knownId] }, environment);
        assert.equal(result.code, 0, result.text);
        assert.match(result.text, /DRY RUN/);
        assert.deepEqual(fs.readdirSync(path.join(dir, 'attachments')).sort(), filesBefore);
        assert.deepEqual(await snapshot(), before);
        const lineAfter = (await req(port, 'GET', '/api/state', null, 'OWNER')).body.cards['l-work'];
        assert.deepEqual(lineAfter, lineBefore);
      });
    }
  }

  await t.test('the collector file types and the exact 10 MB boundary are accepted', async () => {
    for (const [extension, type, data] of [
      ['jpg', 'image/jpeg', PIXEL],
      ['jpeg', 'image/jpeg', PIXEL],
      ['gif', 'image/gif', PIXEL],
      ['webp', 'image/webp', PIXEL],
      ['svg', 'image/svg+xml', '<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>'],
      ['csv', 'text/csv', 'name,value'],
      ['txt', 'text/plain', 'plain words'],
      ['pdf', 'application/pdf', Buffer.alloc(10 * 1024 * 1024, 32)],
    ]) {
      const file = path.join(dir, 'attachment.' + extension);
      fs.writeFileSync(file, data);
      const result = await kit('board_post', { ...(await argsFor('board_post')), attachments: [file] });
      assert.equal(result.code, 0, result.text);
      const row = (await comments()).filter(message => message.by === 'op-test').pop();
      assert.equal(row.cardId, 't-work');
      assert.equal(row.attachments[0].type, type);
      if (extension === 'pdf') assert.equal(row.attachments[0].size, 10 * 1024 * 1024);
    }
  });

  await t.test('batches upload post and reply paths together, including the exact size boundary', async () => {
    fs.truncateSync(large, 10 * 1024 * 1024);
    const calls = [];
    for (const tool of ['board_post', 'board_reply'])
      calls.push({ tool, args: { ...(await argsFor(tool)), attachments: [knownId, picture, large] } });
    const result = await kit('board_batch', { calls });
    assert.equal(result.code, 0, result.text);
    const rows = (await comments()).filter(message => message.by === 'op-test').slice(-2);
    assert.deepEqual(
      rows.map(row => row.label),
      ['STATUS', 'REPLY'],
    );
    for (const row of rows) {
      assert.equal(row.attachments[0].id, knownId);
      assert.equal(row.attachments[1].type, 'image/png');
      assert.equal(row.attachments[2].type, 'application/pdf');
      assert.equal(row.attachments[2].size, 10 * 1024 * 1024);
    }
    fs.truncateSync(large, 10 * 1024 * 1024 + 1);
  });

  for (const tool of ['board_post', 'board_reply']) {
    await t.test('batch ' + tool + ' refuses bad files without posting or queuing any calls', async () => {
      const args = await argsFor(tool);
      for (const [file, reason] of [
        [wrong, /unsupported file type/],
        [large, /over 10 MB/],
        [missing, /ENOENT/],
        [directory, /not a readable file/],
        [empty, /empty body.*HTTP 400/],
      ]) {
        const before = await snapshot();
        const result = await kit('board_batch', {
          calls: [
            { tool: 'board_post', args: { card: 'work', kind: 'status', text: 'Must not post.' } },
            { tool, args: { ...args, attachments: [picture, file] } },
          ],
        });
        assert.equal(result.code, 1, result.text);
        assert.ok(result.text.includes(path.basename(file)), result.text);
        assert.match(result.text, reason);
        assert.deepEqual(await snapshot(), before);
        assert.equal(fs.existsSync(path.join(home, 'calls-outbox.jsonl')), false);
      }
    });
    for (const shadow of [false, true])
      await t.test('batch ' + tool + ' rehearsals do not upload; shadow=' + shadow, async () => {
        const args = shadow
          ? tool === 'board_post'
            ? { card: 'work', kind: 'fyi', text: 'Rehearsal.' }
            : { general: true, to: 'chat', text: 'Rehearsal.' }
          : await argsFor(tool);
        const before = await snapshot();
        const filesBefore = fs.readdirSync(path.join(dir, 'attachments')).sort();
        const environment = shadow ? { LH_BOARD: 'l', LH_SHADOW: '1', LH_TOKEN: 'SHADOW' } : {};
        const batch = attachments => ({
          calls: [{ tool, args: { ...args, attachments } }],
          ...(shadow ? {} : { dry_run: true }),
        });
        const refused = await kit('board_batch', batch([picture]), environment);
        assert.equal(refused.code, 1, refused.text);
        assert.match(refused.text, /dry run or shadow session/);
        const accepted = await kit('board_batch', batch([knownId]), environment);
        assert.equal(accepted.code, 0, accepted.text);
        assert.match(accepted.text, /DRY RUN/);
        assert.deepEqual(fs.readdirSync(path.join(dir, 'attachments')).sort(), filesBefore);
        assert.deepEqual(await snapshot(), before);
      });
  }

  const offlineArgs = { board_post: await argsFor('board_post'), board_reply: await argsFor('board_reply') };
  const stopped = new Promise(resolve => child.once('exit', resolve));
  child.kill();
  await stopped;
  for (const tool of ['board_post', 'board_reply']) {
    await t.test(tool + ' queues an existing id when the board is offline', async () => {
      const result = await kit(tool, { ...offlineArgs[tool], attachments: [knownId] });
      assert.equal(result.code, 0, result.text);
      assert.match(result.text, /Queued/);
      const queued = fs.readFileSync(path.join(home, 'calls-outbox.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
      const item = queued.find(entry => entry.tool === tool);
      assert.ok(item);
      assert.deepEqual(item.args.attachments, [knownId]);
    });
  }
});
