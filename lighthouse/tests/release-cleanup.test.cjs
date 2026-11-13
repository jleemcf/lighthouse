'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8').replace(/\r\n/g, '\n');

test('release cleanup: rule owners explain their boundaries before their implementation', () => {
  for (const name of [
    ...[
      'card-transitions',
      'prompt-transitions',
      'crm-state',
      'shift',
      'shift-presence',
      'doorbells',
      'board-release',
      'release-check',
    ].map(name => 'server/' + name + '.js'),
    ...['shift-session', 'steward-outbox', 'kit-version'].map(name => 'operator-kit/scripts/' + name + '.cjs'),
  ]) {
    assert.match(read(name), /^'use strict';\n\/\/[^\n]+\n\/\/[^\n]+/, name);
  }
  assert.match(read('server/conduct.js'), /\/\/[^\n]+\nconst LEGACY_FINISHED/);
});

test('release cleanup: retired scripts and install-only configuration no longer ship', () => {
  for (const name of ['lhwake.sh', 'stwatch.cjs']) {
    assert.equal(fs.existsSync(path.join(root, 'operator-kit/scripts', name)), false, name);
  }
  const config = JSON.parse(read('operator-kit/config.example.json'));
  assert.equal(Object.hasOwn(config, '__STEWARD_THREAD_ID__'), false);
  assert.equal(Object.hasOwn(config, '__CODEX_EXE__'), false);
  assert.ok(fs.existsSync(path.join(root, 'operator-kit/scripts/stwake.cjs')), 'advice runner stays available');
});

test('release cleanup: legacy fleet switch cannot enable a line prompt destination', () => {
  const grammar = require('../server/grammar')({
    cfg: { boards: { legacy: { fleetSteward: true } } },
    store: {},
  });
  assert.equal(grammar.promptTo('legacy', { to: 'steward' }), null);
  assert.equal(grammar.promptTo('legacy', { to: 'FIRSTMATE' }), 'firstmate');
  assert.equal(grammar.promptTo('legacy', {}), null);
});

test('release cleanup: obsolete relay destination refuses before reading or writing files', context => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-retired-relay-'));
  context.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const script = path.join(home, 'relay.sh');
  const words = path.join(home, 'words.txt');
  fs.writeFileSync(script, read('operator-kit/scripts/relay.sh'));
  fs.writeFileSync(words, 'fixture words only\n');
  const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash';
  const result = spawnSync(bash, [script, 'steward', words], {
    encoding: 'utf8',
    env: { ...process.env, TYPESAFE_API_KEY: '' },
  });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /usage:.*firstmate <file/);
  assert.doesNotMatch(result.stderr, /steward\|firstmate|firstmate\|steward/);
  assert.deepEqual(fs.readdirSync(home).sort(), ['relay.sh', 'words.txt']);
});

test('release cleanup: firstmate relay keeps verbatim delivery and duplicate refusal', context => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-firstmate-relay-'));
  context.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const script = path.join(home, 'relay.sh');
  const words = path.join(home, 'words.txt');
  const text = 'Fixture "quoted" words.\nA second line.\n';
  fs.writeFileSync(
    script,
    read('operator-kit/scripts/relay.sh').replace(
      'FM_SEND="__FM_SEND__"',
      `FM_SEND='cat "{file}" > delivered.txt; printf accepted'`,
    ),
  );
  fs.writeFileSync(words, text);
  const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash';
  const send = () =>
    spawnSync(bash, [script, 'firstmate', words], {
      cwd: home,
      encoding: 'utf8',
      env: { ...process.env, TYPESAFE_API_KEY: '' },
    });
  const first = send();
  assert.equal(first.status, 0, first.stderr);
  assert.equal(fs.readFileSync(path.join(home, 'delivered.txt'), 'utf8'), text);
  assert.equal(send().status, 3);
});

test('release cleanup: command help lists supported shift and board actions', () => {
  const shift = read('operator-kit/scripts/shift.sh');
  const board = read('server/board.sh');
  for (const command of ['update', 'steward', 'kit-status']) {
    assert.ok(shift.slice(0, shift.indexOf('set -u')).includes(command), command + ' header');
    assert.ok(shift.slice(shift.lastIndexOf('usage:')).includes(command), command + ' usage');
  }
  assert.match(shift.slice(shift.lastIndexOf('usage:')), / \| update \|/);
  assert.match(shift.slice(shift.lastIndexOf('usage:')), /status \| kit-status/);
  for (const command of ['claim', 'archive', 'clear-cards']) {
    assert.ok(board.slice(0, board.indexOf('set -u')).includes(command), command + ' header');
    assert.ok(board.slice(board.lastIndexOf('usage:')).includes(command), command + ' usage');
  }
  const mcp = read('operator-kit/scripts/lighthouse-mcp.cjs').split('\n').slice(0, 30).join('\n');
  assert.match(mcp, /lighthouse-mcp\.cjs shift/);
  assert.match(mcp, /lighthouse-mcp\.cjs relay-reconcile <id> --delivered\|--not-delivered --evidence '<evidence>'/);
  assert.match(read('server/toolcalls.js').split('\n').slice(0, 10).join('\n'), /grammar\.js/);
});

test('release cleanup: the server page has one builder and matches its committed source output', () => {
  assert.equal(fs.existsSync(path.join(root, 'board/artifact-layer.js')), false);
  const builder = read('server/make-page.py');
  assert.doesNotMatch(builder, /--artifact|artifact-layer|def build\(artifact\)/);
  const python = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
  const result = spawnSync(
    python,
    ['-c', 'import runpy; print(runpy.run_path("server/make-page.py")["build"](), end="")'],
    {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONDONTWRITEBYTECODE: '1' },
      maxBuffer: 4 * 1024 * 1024,
    },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.replace(/\r\n/g, '\n'), read('server/public/index.html'));
});

test('release cleanup: new operators use tools while the line watch remains supported', () => {
  for (const name of ['operator-kit/README.md', 'operator-kit/SETUP.md']) {
    assert.match(read(name), /[Ll]ine mode is frozen/);
    assert.match(read(name), /[Tt]ool mode is the path for new operators/);
  }
  assert.match(read('operator-kit/WATCH-BRIEF.md'), /line mode.*fixes|fixes.*line mode/);
});
