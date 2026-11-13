'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { noticeFixture } = require('./coordinator-fixture.cjs');
const { cardFixture } = require('./card-fixture');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const texts = [
  'Checks 3/3: (c) In firstmate transcript fd06f5ea, list each assistant entry from 16:53Z to 17:21Z ' +
    'on Nov 11 with uuid, stop_reason and text length (no text); then search the other .jsonl files there ' +
    '(incl. 7cbbaf62, d78cf73d) for those uuids: file, line, isSidechain. (d) In any raw fmwatch capture ' +
    'from then: matches only for EPIPE, blind, WATCH LEASE, replaced a leftover copy.',
  'Checks 3/3, (d), reposted: in any raw fmwatch capture from Nov 11 around 11:53 to 12:26 ET, ' +
    'report matches only (no other text) for EPIPE, blind, WATCH LEASE and replaced a leftover copy. ' +
    'If no raw capture survives, say so. Thank you, this is very useful.',
];

async function instruments(context, fixture) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'message-completeness-'));
  const source = path.resolve(__dirname, '../../operator-kit/scripts');
  for (const file of fs.readdirSync(source)) {
    if (fs.statSync(path.join(source, file)).isFile()) fs.copyFileSync(path.join(source, file), path.join(home, file));
  }
  fs.writeFileSync(path.join(home, 'boardwatch-t.json'), JSON.stringify({ seq: 1, said: [] }));
  const server = 'http://127.0.0.1:' + fixture.port;
  fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ server, board: 't' }));
  const env = { ...process.env, LH_TOKEN: 'LEGACY' };
  delete env.TYPESAFE_API_KEY;
  for (const name of Object.keys(env)) if (/^LH_(HELPER|MONITOR)_LEASE/.test(name)) delete env[name];
  const children = [];
  context.after(async () => {
    for (const child of children) {
      if (child.exitCode === null && child.signalCode === null) {
        const stopped = once(child, 'exit');
        child.kill();
        await stopped;
      }
    }
    fs.rmSync(home, { recursive: true, force: true });
  });
  const start = (file, args = []) => {
    const child = spawn(process.execPath, [path.join(home, file), ...args], {
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    children.push(child);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    let stdout = '',
      stderr = '';
    child.stdout.on('data', bytes => (stdout += bytes));
    child.stderr.on('data', bytes => (stderr += bytes));
    return { child, stdout: () => stdout, stderr: () => stderr };
  };
  const gate = start('gate.cjs', ['--home', home, '--mode', 'hold', '--server', server, '--board', 't']);
  const watcher = start('boardwatch.cjs', ['--server', server, '--board', 't', '--interval', '0.04']);
  watcher.child.stdout.pipe(gate.child.stdin);
  const mcp = start('lighthouse-mcp.cjs');
  let nextId = 0;
  const until = async predicate => {
    const deadline = Date.now() + 10000;
    while (!predicate()) {
      assert.ok(
        Date.now() < deadline,
        'instrument output: ' + watcher.stderr() + gate.stderr() + mcp.stderr() + watcher.stdout() + gate.stdout(),
      );
      await pause(20);
    }
  };
  const status = async (detail = 'brief') => {
    const id = ++nextId;
    mcp.child.stdin.write(
      JSON.stringify({
        jsonrpc: '2.0',
        id,
        method: 'tools/call',
        params: { name: 'board_status', arguments: { detail } },
      }) + '\n',
    );
    let reply;
    await until(() => {
      reply = mcp
        .stdout()
        .split('\n')
        .slice(0, -1)
        .filter(Boolean)
        .map(line => JSON.parse(line))
        .find(message => message.id === id);
      return reply;
    });
    assert.equal(reply.result.isError, false);
    return reply.result.content.map(part => part.text).join('\n');
  };
  return { home, watcher, gate, until, status };
}

for (const [index, text] of texts.entries()) {
  test('reported notice ' + (index + 1) + ' survives watcher, hold gate, HTTP and MCP receipts', async context => {
    const fixture = await noticeFixture(context);
    const route = await instruments(context, fixture);
    const posted = await fixture.notice({ text });
    assert.equal(posted.status, 201);
    await route.until(() => route.gate.stdout().includes(text));
    assert.ok(route.watcher.stdout().includes(text), 'raw boardwatch carries the complete notice');
    let record;
    await route.until(() => {
      try {
        record = fs
          .readFileSync(path.join(route.home, 'gate-log.jsonl'), 'utf8')
          .split('\n')
          .slice(0, -1)
          .map(line => JSON.parse(line))
          .find(entry => entry.line.includes(text));
        return record;
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        return false;
      }
    });
    assert.equal(record.decision, 'wake');
    assert.equal(record.reason, 'Owner or the board route');
    await pause(150);
    assert.equal(route.gate.stdout().split(text).length - 1, 1, 'one notice, one immediate wake');
    const receipt = (await fixture.request('GET', '/api/boards/t/status')).body.receipt;
    const mcp = await route.status();
    assert.ok(mcp.includes(text), 'real MCP receipt carries the complete notice');
    assert.ok(receipt.includes(text), 'HTTP receipt carries the complete notice');
    assert.ok(mcp.includes('coordinator, not the owner'));
  });
}

test('4000-character notices and owner messages remain whole in every operator path', async context => {
  const fixture = await noticeFixture(context);
  const route = await instruments(context, fixture);
  for (const [kind, token] of [
    ['notice', 'COORD'],
    ['comment', 'CAPTAIN'],
  ]) {
    const text = kind + ': ' + 'whole words; '.repeat(400);
    const words = text.slice(0, 3980) + ' COMPLETE END'.padStart(20, '.');
    assert.equal(words.length, 4000);
    const posted = await fixture.request('POST', '/api/comments', { board: 't', kind, text: words }, token);
    assert.equal(posted.status, 201);
    await route.until(() => route.gate.stdout().includes(words));
    assert.ok((await route.status()).includes(words), kind + ' complete in MCP');
    assert.ok((await fixture.request('GET', '/api/boards/t/status')).body.receipt.includes(words));
    if (token === 'CAPTAIN') {
      const saved = path.join(route.home, 'inbox', posted.body.id + '.txt');
      assert.equal(fs.readFileSync(saved, 'utf8'), words + '\n');
      assert.ok(route.gate.stdout().includes(saved), 'existing exact owner copy is readable');
    }
  }
});

test('an open ask stays whole in full status and duplicate-ask refusal', async context => {
  const fixture = await noticeFixture(context);
  const route = await instruments(context, fixture);
  await fixture.open('ask');
  const question = 'May I proceed only after this qualification? ' + 'Do not change approved scope. '.repeat(8);
  assert.equal((await fixture.call('board_ask', { card: 'ask', question })).ok, true);
  const status = await fixture.request('GET', '/api/boards/t/status?detail=full');
  assert.ok(status.body.receipt.includes(question.trim()), 'full status carries the complete ask');
  assert.ok((await route.status('full')).includes(question.trim()), 'real MCP full status carries the complete ask');
  const duplicate = await fixture.call('board_ask', { card: 'ask', question: 'May I do something else?' });
  assert.equal(duplicate.ok, false);
  assert.ok(duplicate.reason.includes(question.trim()), 'refusal carries the complete existing ask');
});

test('standing authorities retain their complete scope and owner instructions', async context => {
  const fixture = await noticeFixture(context);
  const ownerWords = 'Permitted instructions. '.repeat(90).slice(0, 1980) + ' OWNER EXCLUSION END';
  const covers = 'Permitted scope. '.repeat(30).slice(0, 380) + ' SCOPE EXCLUSION END';
  assert.equal(ownerWords.length, 2000);
  assert.equal(covers.length, 400);
  const created = await fixture.request(
    'POST',
    '/api/boards/t/authorities',
    { owner_words: ownerWords, covers, relay: true, target: 'firstmate' },
    'CAPTAIN',
  );
  assert.equal(created.status, 201);
  const listed = await fixture.call('board_authorities', {});
  assert.equal(listed.ok, true);
  assert.ok(listed.summary.includes(covers), 'authority lists the whole scope including exclusions');
  assert.ok(listed.summary.includes(ownerWords), 'authority lists the whole owner instruction');
  const scope = 'Only the approved release-note work, excluding every other project and operation'.padEnd(80, 'x');
  assert.equal(scope.length, 80);
  const switched = await fixture.request('POST', '/api/comments', { board: 't', text: '/yolo on ' + scope }, 'CAPTAIN');
  assert.equal(switched.status, 201);
  const expected =
    `/yolo, ${scope} only: the operator prompts firstmate on that without my Send each time; ` +
    'anything else waits for my Send. Critical direction decisions still come to me as asks: ' +
    'choosing between directions (which approach, what to build, whether to stop), anything touching reps ' +
    "or distribution, and anything that deletes data or can't be taken back.";
  assert.ok(expected.length > 400, 'scoped yolo instructions exceed the ordinary scope cap');
  const handoff = await fixture.call('board_handoff', {});
  assert.equal(handoff.ok, true);
  const standing = handoff.handoff.split('## People and channels')[0];
  assert.ok(standing.includes(expected), 'handoff retains the complete yolo exclusions');
  assert.ok(standing.includes(ownerWords), 'handoff retains the complete ordinary owner instruction');
});

test('a watch conduct notice is also complete in watcher, gate and MCP receipt', async context => {
  const fixture = await cardFixture(context, undefined, {
    tokens: {
      OPS: { name: 'operator', via: 'api', mode: 'tools' },
      LEGACY: { name: 'operator', via: 'api' },
      WATCH: { name: 'watch', via: 'api' },
    },
    boards: {
      t: { name: 'Test', protocol: 'tools', access: { operator: 'operator', watch: 'watch' } },
      w: { name: 'Watch', access: { watch: 'operator' } },
    },
  });
  const route = await instruments(context, fixture);
  const text =
    ('Conduct notice: ' + 'Keep the instruction whole. '.repeat(146)).slice(0, 3980) +
    ' WATCH NOTICE END'.padStart(20, '.');
  assert.equal(text.length, 4000);
  const posted = await fixture.request(
    'POST',
    '/api/boards/w/calls',
    { calls: [{ id: 'long-notice', tool: 'board_notice', args: { board: 't', text } }] },
    'WATCH',
  );
  assert.equal(posted.body.results[0].ok, true);
  await route.until(() => route.gate.stdout().includes(text.trim()));
  assert.ok(route.watcher.stdout().includes(text.trim()));
  assert.ok((await route.status()).includes(text.trim()), 'watch-notice receipt carries the complete instruction');
});
