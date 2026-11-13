'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const scripts = path.join(__dirname, '../scripts');
const keys = ['one', 'two', 'three', 'four'];

function fixture(context, kind, reversed = false) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'fm-delivery-'));
  context.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const conversation = path.join(home, '.claude/projects/fixture');
  const state = path.join(home, 'fm/state');
  fs.mkdirSync(conversation, { recursive: true });
  fs.mkdirSync(state, { recursive: true });
  const side = kind === 'agent' ? 'agent-copy.jsonl' : 'side.jsonl';
  const names = reversed ? ['main.jsonl', side] : [side, 'main.jsonl'];
  for (const name of names) fs.writeFileSync(path.join(conversation, name), '');
  if (kind === 'id') fs.writeFileSync(path.join(home, 'fmwatch-ignore.txt'), 'side');
  if (kind === 'prompt') {
    fs.writeFileSync(path.join(home, 'fmwatch-ignore.txt'), 'prompt: supervision fixture');
    fs.writeFileSync(
      path.join(conversation, side),
      JSON.stringify({
        type: 'user',
        message: { content: 'supervision fixture' },
      }) + '\n',
    );
  }
  const source = fs
    .readFileSync(path.join(scripts, 'fmwatch.cjs'), 'utf8')
    .replace("'//wsl.localhost/__WSL_DISTRO__/home/__WSL_USER__'", JSON.stringify(home))
    .replace('__FM_CONV_DIR__', 'fixture')
    .replace('__FM_HOME_REL__', '/fm');
  const lines = [];
  let saved = null;
  let failed = false;
  const output = line => lines.push(line);
  output.replay = () => {};
  const filesystem = {
    ...fs,
    readdirSync: directory => (directory === conversation ? names : fs.readdirSync(directory)),
    openSync: (file, ...args) => {
      if (failed && file === path.join(conversation, side))
        throw Object.assign(new Error('fixture read failure'), { code: 'EACCES' });
      return fs.openSync(file, ...args);
    },
  };
  const launch = (resume = null) =>
    vm.runInNewContext(source + '\n({ poll });', {
      require: name =>
        name === 'fs'
          ? filesystem
          : name === './watch-output.cjs'
            ? () => output
            : name === './watch-lease.cjs'
              ? {
                  check() {},
                  load: () => resume,
                  save: (_home, _source, value) => {
                    saved = structuredClone(value);
                  },
                }
              : require(name),
      __dirname: home,
      __filename: path.join(home, 'fmwatch.cjs'),
      Buffer,
      process: {
        pid: process.pid,
        on() {},
        exit() {
          throw new Error('unexpected process exit');
        },
      },
      setInterval() {},
    });
  const append = (name, records) =>
    fs.appendFileSync(
      path.join(conversation, name),
      records.map(record => JSON.stringify({ ...record, timestamp: new Date().toISOString() }) + '\n').join(''),
    );
  const replies = keys.map(identity => ({
    type: 'assistant',
    uuid: 'uuid-' + identity,
    timestamp: new Date().toISOString(),
    message: { id: identity, stop_reason: 'end_turn', content: [{ type: 'text', text: 'main reply ' + identity }] },
  }));
  const copies = replies.map(record => ({
    ...record,
    uuid: kind === 'unique' ? 'side-' + record.uuid : record.uuid,
    isSidechain: kind === 'sidechain' || kind === 'unique',
    message: {
      ...record.message,
      content: [{ type: 'text', text: kind === 'fork' ? record.message.content[0].text : 'suppressed copy' }],
    },
  }));
  return {
    launch,
    lines,
    side,
    append,
    replies,
    copies,
    state,
    saved: () => saved,
    fail: value => {
      failed = value;
    },
    delivered: () =>
      lines.filter(line => line.startsWith('FM REPLY')).map(line => line.split('[key reply:')[1].split(']')[0]),
  };
}

for (const kind of ['sidechain', 'agent', 'id', 'prompt', 'fork', 'unique']) {
  for (const reversed of [false, true]) {
    test(kind + (reversed ? ': main first' : ': copy first'), context => {
      const watch = fixture(context, kind, reversed);
      const running = watch.launch();
      watch.append(watch.side, watch.copies);
      watch.append('main.jsonl', watch.replies);
      running.poll();
      running.poll();
      assert.deepEqual(watch.delivered(), keys);
      assert.ok(watch.lines.every(line => !line.includes('suppressed copy')));
      assert.deepEqual(
        watch.saved().order,
        keys.map(identity => 'uuid-' + identity),
      );
    });
  }
}

for (const kind of ['sidechain', 'agent', 'id', 'prompt', 'unique']) {
  test(kind + ': a resumed cursor cannot be poisoned by suppressed copies', context => {
    const watch = fixture(context, kind);
    const running = watch.launch();
    watch.append(watch.side, watch.copies);
    running.poll();
    assert.deepEqual(watch.delivered(), []);
    assert.deepEqual(watch.saved().order, []);
    watch.append('main.jsonl', watch.replies);
    const resumed = watch.launch(watch.saved());
    resumed.poll();
    assert.deepEqual(watch.delivered(), keys);
    assert.deepEqual(
      watch.saved().order,
      keys.map(identity => 'uuid-' + identity),
    );
  });
}

test('one unreadable transcript does not starve replies, tasks or locks; recovery is truthful', context => {
  const watch = fixture(context, 'sidechain');
  const running = watch.launch();
  watch.append(watch.side, watch.copies);
  watch.append('main.jsonl', watch.replies);
  fs.writeFileSync(path.join(watch.state, 'fixture.status'), 'done: fixture finished');
  fs.writeFileSync(path.join(watch.state, '.lock'), 'fixture-pid');
  watch.fail(true);
  running.poll();
  running.poll();
  assert.deepEqual(watch.delivered(), keys);
  assert.equal(watch.lines.filter(line => line.includes('cannot read some firstmate files')).length, 1);
  assert.ok(watch.lines.some(line => line.startsWith('FM TASK')));
  assert.ok(watch.lines.some(line => line.startsWith('FM RESTART')));
  assert.ok(watch.lines.every(line => !line.includes('readable again')));
  watch.fail(false);
  running.poll();
  running.poll();
  assert.equal(watch.lines.filter(line => line.includes('readable again')).length, 1);
  assert.deepEqual(watch.delivered(), keys);
});
