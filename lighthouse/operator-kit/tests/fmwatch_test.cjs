// fmwatch.cjs against a stand-in firstmate: what firstmate asks the operator goes first on its FM REPLY line, the
// line keeps its key however long the reply, and FM WAITING reminds the operator when firstmate has had no input
// 15 minutes after asking. The clock is moved ahead by a preload so the test takes seconds.
// Run: node --test lighthouse/operator-kit/tests/fmwatch_test.cjs
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SRC = path.join(__dirname, '..', 'scripts', 'fmwatch.cjs');
const wait = ms => new Promise(r => setTimeout(r, ms));

function start(jumpAfterMs) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fmw-'));
  const home = path.join(dir, 'home');
  const conv = path.join(home, '.claude', 'projects', 'conv');
  const state = path.join(home, 'fm', 'state');
  fs.mkdirSync(conv, { recursive: true });
  fs.mkdirSync(state, { recursive: true });
  fs.writeFileSync(path.join(state, '.lock'), '4242');
  const file = path.join(conv, 'fm.jsonl');
  fs.writeFileSync(file, '');
  const script = fs
    .readFileSync(SRC, 'utf8')
    .replace("'//wsl.localhost/__WSL_DISTRO__/home/__WSL_USER__'", JSON.stringify(home))
    .replace('__FM_CONV_DIR__', 'conv')
    .replace('__FM_HOME_REL__', '/fm');
  fs.writeFileSync(path.join(dir, 'fmwatch.cjs'), script);
  fs.copyFileSync(path.join(path.dirname(SRC), 'watch-output.cjs'), path.join(dir, 'watch-output.cjs'));
  fs.copyFileSync(path.join(path.dirname(SRC), 'watch-lease.cjs'), path.join(dir, 'watch-lease.cjs'));
  // the clock moves 16 minutes ahead once jumpAfterMs have passed
  const pre = path.join(dir, 'clock.cjs');
  fs.writeFileSync(
    pre,
    `const real = Date.now, t0 = real();\n` +
      `Date.now = () => { const r = real(); return r - t0 > ${jumpAfterMs} ? r + 16 * 60000 : r; };\n`,
  );
  const child = spawn(process.execPath, ['--require', pre, path.join(dir, 'fmwatch.cjs')], { stdio: 'pipe' });
  let out = '';
  child.stdout.on('data', d => (out += d));
  child.stderr.on('data', d => (out += d));
  const add = o =>
    fs.appendFileSync(file, JSON.stringify(Object.assign({ timestamp: new Date().toISOString() }, o)) + '\n');
  const reply = (id, text) =>
    add({
      type: 'assistant',
      uuid: 'a-' + id,
      message: { id, model: 'claude-opus-5-5', stop_reason: 'end_turn', content: [{ type: 'text', text }] },
    });
  const input = (id, text) => add({ type: 'user', uuid: 'u-' + id, message: { role: 'user', content: text } });
  return { child, reply, input, lines: () => out.split('\n').filter(Boolean) };
}

const LONG =
  'Built the August test package and ran the first half of the comparison. '.repeat(12) +
  'Still waiting on you to upload the August test ZIP so I can finish the comparison.';

test('an oversized multiline reply is capped on the pipe and preserved whole in its file', async context => {
  const watcher = start(60000);
  context.after(() => watcher.child.kill());
  await wait(1200);
  const text = 'The comparison result is ready.\n'.repeat(900) + 'Can you send the final package?';
  watcher.reply('large', text);
  await wait(2500);
  const line = watcher.lines().find(value => value.startsWith('FM REPLY'));
  assert.ok(line.length <= 16000);
  assert.match(line, /asks you: «Can you send the final package\?/);
  assert.ok(line.endsWith('[key reply:large]'));
  const file = line.match(/\[exact text saved: (.*?)\]/)[1];
  assert.ok(!line.includes('[file:'), 'the saved reply is not an upload instruction');
  assert.equal(fs.readFileSync(file, 'utf8'), text);
});

test('an ask goes first on the line, keeps its key, and is reminded after 15 minutes without input', async t => {
  const w = start(4000);
  t.after(() => w.child.kill());
  await wait(1200);
  w.reply('m1', LONG);
  await wait(2500);
  const r = w.lines().find(l => l.startsWith('FM REPLY'));
  assert.ok(r, w.lines().join('\n'));
  assert.match(r, /^FM REPLY \d\d:\d\d \| asks you: «Still waiting on you to upload the August test ZIP/);
  assert.ok(r.length <= 16000 && r.endsWith('[key reply:m1]'), 'the reply keeps its key');
  assert.ok(r.includes(LONG), 'a normal reply is carried in one notification');
  const file = r.match(/\[exact text saved: (.*?)\]/)[1];
  assert.equal(fs.readFileSync(file, 'utf8'), LONG, 'the complete original is readable, not flattened');
  await wait(3500);
  const remind = w.lines().filter(l => l.startsWith('FM WAITING'));
  assert.equal(remind.length, 1, w.lines().join('\n'));
  assert.match(remind[0], /firstmate asked you at \d\d:\d\d and has had no input in 15 min: «Still waiting on you/);
  assert.ok(remind[0].endsWith('[key waiting:m1:15]'), remind[0]);
});

test('input to firstmate after the ask means no reminder; a reply without an ask stays unmarked', async t => {
  const w = start(4000);
  t.after(() => w.child.kill());
  await wait(1200);
  w.reply('m2', 'Ready to promote. Can you confirm the release window?');
  await wait(300);
  w.input('i2', 'Yes: tonight after 10 PM.');
  await wait(300);
  w.reply('m3', 'Promotion queued for 10 PM.');
  await wait(6000);
  const l = w.lines();
  assert.ok(
    l.some(x => /^FM REPLY .*\| Promotion queued for 10 PM\. \[exact text saved: .*\] \[key reply:m3\]$/.test(x)),
    l.join('\n'),
  );
  assert.ok(
    l.some(x => /^FM REPLY .*asks you: «Can you confirm the release window\?»/.test(x)),
    l.join('\n'),
  );
  assert.ok(!l.some(x => x.startsWith('FM WAITING')), 'answered: no reminder\n' + l.join('\n'));
});

test('status and reported asks never tag or start reminders', { concurrency: true }, async t => {
  const replies = [
    "When it's ready, it'll ask you to upload its test file.",
    'Captain, both tests are under way with your go-ahead. ' +
      '- Each test: it confirms its own upload and preparation',
    "When ready, it'll ask you to please upload its test file.",
    'When ready, it will ask you to please upload its test file.',
    'It asked you to please upload its test file.',
  ];
  await Promise.all(
    replies.map((text, index) =>
      t.test(text, async t => {
        const w = start(4000);
        t.after(() => w.child.kill());
        await wait(1200);
        w.reply('status-' + index, text);
        await wait(6000);
        const lines = w.lines();
        const reply = lines.find(line => line.startsWith('FM REPLY'));
        assert.ok(reply, lines.join('\n'));
        assert.ok(!reply.includes('asks you:'), reply);
        assert.ok(!lines.some(line => line.startsWith('FM WAITING')), lines.join('\n'));
      }),
    ),
  );
});

test('quoted and fenced questions never tag or start reminders', { concurrency: true }, async t => {
  const excerpts = [
    '> Next questions: which sample should Rowan prepare?',
    '> > Next questions: which sample should Rowan prepare?',
    '   > Next questions: which sample should Rowan prepare?',
    '```text\nPlease upload the sample. Which sample should Rowan prepare?\n```',
    '~~~~text\n~~~\nPlease upload the sample. Which sample should Rowan prepare?\n~~~~',
  ];
  await Promise.all(
    excerpts.map((excerpt, index) =>
      t.test('excerpt ' + index, async t => {
        const w = start(4000);
        t.after(() => w.child.kill());
        await wait(1200);
        w.reply('excerpt-' + index, `Mira's sample view:\n\n${excerpt}\n\nPaused until automated checks finish.`);
        await wait(6000);
        const lines = w.lines();
        const reply = lines.find(line => line.startsWith('FM REPLY'));
        assert.ok(reply, lines.join('\n'));
        assert.ok(!reply.includes('asks you:'), reply);
        assert.ok(!lines.some(line => line.startsWith('FM WAITING')), lines.join('\n'));
      }),
    ),
  );
});

test('a real ask before or after a quote is still tagged and reminded', { concurrency: true }, async t => {
  const ask = 'Can you confirm the sample label?';
  const quote = '> Next questions: which sample should Rowan prepare?';
  const replies = [
    `${ask}\n\n${quote}`,
    `${quote}\n\n${ask}`,
    '> ```text\n' + quote + '\n\n' + ask,
    '```npm test``` finished.\n\n' + quote + '\n\n' + ask,
    '```text\nPlease upload the sample.\n```\n\n' + ask + '\n\n' + quote,
  ];
  await Promise.all(
    replies.map((text, index) =>
      t.test('position ' + index, async t => {
        const w = start(4000);
        t.after(() => w.child.kill());
        await wait(1200);
        w.reply('adjacent-' + index, text);
        await wait(6000);
        const lines = w.lines();
        const reply = lines.find(line => line.startsWith('FM REPLY'));
        assert.ok(reply && reply.includes(`asks you: \u00ab${ask}\u00bb`), lines.join('\n'));
        const reminder = lines.find(line => line.startsWith('FM WAITING'));
        assert.ok(reminder && reminder.includes(ask), lines.join('\n'));
        assert.ok(!reminder.includes('Rowan') && !reminder.includes('upload'), reminder);
      }),
    ),
  );
});

test('direct requests still tag and start reminders', { concurrency: true }, async t => {
  const replies = [
    'Please upload the test file.',
    'Your call: ship or hold?',
    'Upload the test file for me.',
    'Upload test.zip for me.',
    'I need your go-ahead before deploying.',
  ];
  await Promise.all(
    replies.map((text, index) =>
      t.test(text, async t => {
        const w = start(4000);
        t.after(() => w.child.kill());
        await wait(1200);
        w.reply('ask-' + index, text);
        await wait(6000);
        const lines = w.lines();
        const reply = lines.find(line => line.startsWith('FM REPLY'));
        assert.ok(reply && reply.includes('asks you:'), lines.join('\n'));
        assert.ok(
          lines.some(line => line.startsWith('FM WAITING')),
          lines.join('\n'),
        );
      }),
    ),
  );
});
