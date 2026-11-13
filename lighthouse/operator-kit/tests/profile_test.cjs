'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { fixture, python, bash, env, git } = require('../../verification/update/bootstrap-replay.cjs');
const kit = path.resolve(__dirname, '..');
const repository = path.resolve(kit, '../..');
const baseline = path.join(repository, 'private/compatibility/expected.json');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const base = () =>
  Object.fromEntries(Object.keys(read(path.join(kit, 'config.example.json'))).map(key => [key, 'fixture']));
function scratch(context) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-profile-kit-'));
  context.after(() => fs.rmSync(home, { recursive: true, force: true }));
  return home;
}
test('repository polling is optional and only queries an explicit repository', context => {
  const home = scratch(context);
  const source = fs.readFileSync(path.join(kit, 'scripts/lighthouse-sweep.sh'), 'utf8');
  const section = source.slice(source.indexOf('  last=$(prev board_id)'), source.indexOf('  # ---- 3b.'));
  assert.ok(section.includes('gh api'));
  for (const repository of ['none', 'example/board']) {
    const marker = path.join(home, repository === 'none' ? 'none.txt' : 'explicit.txt');
    const script = [
      'prev() { echo 1; }; lease_check() { :; }; FIRST=0',
      'gh() { printf "%s" "$*" > "$POLL_MARKER"; }; timeout() { shift; "$@"; }',
      'NEW="$POLL_MARKER.cursor"',
      section.replaceAll('__BOARD_REPO__', repository),
    ].join('\n');
    const result = spawnSync(bash, ['-c', script], {
      env: { ...env, POLL_MARKER: marker.replace(/\\/g, '/') },
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(fs.existsSync(marker), repository !== 'none');
    if (repository !== 'none') assert.match(fs.readFileSync(marker, 'utf8'), /repos\/example\/board\/issues/);
  }
});

test('command-line clock overrides reach normalized collector settings', context => {
  const home = scratch(context);
  const config = path.join(home, 'input.json');
  const output = path.join(home, 'operator');
  fs.writeFileSync(config, JSON.stringify(base()));
  const result = spawnSync(
    python,
    [
      path.join(kit, 'install.py'),
      '--config',
      config,
      '--out',
      output,
      '--set',
      '__TIME_ZONE__=America/Los_Angeles',
      '--set',
      '__TIME_ZONE_LABEL__=PT',
    ],
    { env, encoding: 'utf8', timeout: 60000 },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(read(path.join(output, 'config.json')).timeZone, 'America/Los_Angeles');
  assert.equal(read(path.join(output, 'config.json')).timeZoneLabel, 'PT');
});
function install(config, output, kept) {
  const filename = path.join(path.dirname(output), 'source-config.json');
  fs.writeFileSync(filename, JSON.stringify(config));
  const args = [path.join(kit, 'install.py'), '--config', filename, '--out', output];
  if (kept) args.push('--keep-from', kept);
  const result = spawnSync(python, args, { env, encoding: 'utf8', timeout: 60000 });
  assert.equal(result.status, 0, result.stderr);
}
for (const source of ['server', 'kit', 'override', 'installed']) {
  test('installation carries owner aliases from ' + source, context => {
    const home = scratch(context);
    const profile = path.join(home, 'profile.json');
    fs.writeFileSync(
      profile,
      JSON.stringify({
        server: { ownerAliases: ['server-alias'] },
        kit: source === 'kit' ? { ownerAliases: ['kit-alias'] } : {},
      }),
    );
    const config = { ...base(), profile: 'profile.json' };
    if (source === 'override') config.ownerAliases = [];
    const output = path.join(home, 'operator');
    const kept = path.join(home, 'kept.json');
    if (source === 'installed') fs.writeFileSync(kept, JSON.stringify({ ownerAliases: ['installed-alias'] }));
    install(config, output, source === 'installed' ? kept : undefined);
    const expected = source === 'override' ? [] : [source + '-alias'];
    assert.deepEqual(read(path.join(output, 'config.json')).ownerAliases, expected);
  });
}
test(
  'private machine configurations preserve roles, polling and compatibility clocks',
  { skip: !fs.existsSync(baseline) },
  () => {
    const expected = read(baseline);
    const profile = read(path.join(path.dirname(baseline), 'profile.json'));
    for (const machine of expected.machines) {
      const file = path.join(repository, machine.file);
      const code =
        'import json,sys; from profile import configure; ' +
        'print(json.dumps(configure(json.load(open(sys.argv[1])),sys.argv[1])))';
      const result = spawnSync(python, ['-c', code, file], { cwd: kit, env, encoding: 'utf8' });
      assert.equal(result.status, 0, 'private configuration resolves');
      const config = JSON.parse(result.stdout);
      assert.equal(config.__BOARD_ID__, machine.board);
      assert.equal(config.__WATCH_BOARDS__, machine.watch);
      assert.equal(config.__BOARD_REPO__, machine.repository);
      assert.equal(config.ownerId, profile.server.ownerId);
      assert.equal(config.timeZone, profile.server.timeZone);
      assert.equal(config.__WINDOWS_TIME_ZONE__, profile.server.windowsTimeZone);
      assert.equal(!!config.roleContent?.length, machine.roleContent);
      for (const role of config.roleContent || []) assert.ok(fs.existsSync(role));
    }
  },
);

test('role content is explicit and installed briefs use the configured clock', context => {
  const home = scratch(context);
  const config = base();
  config.__BOARD_ID__ = 'lighthouse';
  config.__TIME_ZONE__ = 'UTC';
  config.__TIME_ZONE_LABEL__ = 'UTC';
  config.__OWNER_NAME__ = 'Captain Example';
  install(config, path.join(home, 'operator'));
  assert.equal(fs.existsSync(path.join(home, 'operator/START-HERE.md')), false);
  const document = fs.readFileSync(path.join(home, 'operator/OPERATOR-BRIEF.md'), 'utf8');
  assert.match(document, /AM\/PM UTC/);
  assert.doesNotMatch(document, /__TIME_ZONE/);
  for (const name of ['SETUP.md', 'README.md']) {
    const installed = fs.readFileSync(path.join(home, 'operator', name), 'utf8');
    assert.match(installed, /__OWNER_NAME__/);
    assert.doesNotMatch(installed, /Captain Example/);
  }
  fs.writeFileSync(path.join(home, 'START-HERE.md'), 'Explicit role sentinel');
  config.roleContent = ['START-HERE.md'];
  install(config, path.join(home, 'operator'));
  assert.equal(fs.readFileSync(path.join(home, 'operator/START-HERE.md'), 'utf8'), 'Explicit role sentinel');
});

test('bootstrap selects private machine profile without replacing any filled installed value', context => {
  const setup = fixture();
  context.after(setup.cleanup);
  const root = path.resolve(setup.source, '../..');
  const machine = path.join(root, 'private/machines/fixture');
  fs.mkdirSync(machine, { recursive: true });
  const old = read(path.join(setup.home, 'config.json'));
  const config = { ...base(), profile: '../../compatibility/profile.json', roleContent: ['START-HERE.md'] };
  config.__BOARD_SERVER__ = 'http://127.0.0.1:19999';
  fs.writeFileSync(path.join(machine, 'operator-config.json'), JSON.stringify(config));
  fs.writeFileSync(path.join(machine, 'START-HERE.md'), 'Private role sentinel');
  const profile = path.join(root, 'private/compatibility');
  fs.mkdirSync(profile, { recursive: true });
  fs.writeFileSync(path.join(profile, 'profile.json'), JSON.stringify({ kit: { addedProfileValue: 'selected' } }));
  fs.writeFileSync(path.join(setup.home, 'LH-TOKEN.txt'), 'synthetic-token-preserved');
  const result = setup.run();
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const current = read(path.join(setup.home, 'config.json'));
  for (const [key, value] of Object.entries(old)) assert.deepEqual(current[key], value, key);
  assert.equal(current.addedProfileValue, 'selected');
  assert.equal(fs.readFileSync(path.join(setup.home, 'LH-TOKEN.txt'), 'utf8'), 'synthetic-token-preserved');
  assert.equal(fs.readFileSync(path.join(setup.home, 'START-HERE.md'), 'utf8'), 'Private role sentinel');
  assert.ok(fs.existsSync(path.join(setup.home, 'WATCH-BRIEF.md')));
});

test('the line collector reads the configured zone and owner display label', context => {
  const home = scratch(context);
  for (const file of ['collector.py', 'collector_usage.py', 'helper_generation.py'])
    fs.copyFileSync(path.join(kit, 'scripts', file), path.join(home, file));
  fs.writeFileSync(
    path.join(home, 'config.json'),
    JSON.stringify({ timeZoneLabel: 'UTC', ownerName: 'Captain Example' }),
  );
  const check = [
    'import collector',
    'assert collector.parse_line("⏱ 1:20 PM UTC · STATUS · work: ready") is not None',
    'assert collector.woke_targets("Captain Example (board, card work): proceed") == ["work"]',
    'assert collector.woke_targets("Owner (board, card other): text") == []',
    'assert collector.collector_usage.wake_source("Captain Example (board): text", None) == "board"',
    'assert collector.collector_usage.wake_source("Owner (board): text", None) == "human"',
  ].join('; ');
  const result = spawnSync(python, ['-c', check], { cwd: home, env, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});

test(
  'the already-running base bootstrap resolves the fetched private profile on its first update',
  {
    skip: !require('../../verification/update/bootstrap-replay.cjs').historical,
  },
  context => {
    const setup = fixture();
    context.after(setup.cleanup);
    const sourceRoot = path.resolve(setup.source, '../..');
    const machine = path.join(sourceRoot, 'private/machines/fixture');
    const profiles = path.join(sourceRoot, 'private/compatibility');
    fs.mkdirSync(machine, { recursive: true });
    fs.mkdirSync(profiles, { recursive: true });
    const old = read(path.join(setup.home, 'config.json'));
    for (const key of Object.keys(old)) if (/OWNER|TIME_ZONE/.test(key)) delete old[key];
    fs.writeFileSync(path.join(setup.home, 'config.json'), JSON.stringify(old));
    fs.writeFileSync(
      path.join(machine, 'operator-config.json'),
      JSON.stringify({
        ...old,
        profile: '../../compatibility/profile.json',
        roleContent: ['START-HERE.md'],
      }),
    );
    fs.writeFileSync(path.join(machine, 'START-HERE.md'), 'Historical bootstrap role');
    fs.writeFileSync(
      path.join(profiles, 'profile.json'),
      JSON.stringify({
        kit: {
          __OWNER_NAME__: 'Captain Example',
          __OWNER_ID__: 'captain-42',
          __TIME_ZONE__: 'America/Chicago',
          __TIME_ZONE_LABEL__: 'ET',
          __WINDOWS_TIME_ZONE__: 'Central Standard Time',
        },
      }),
    );
    const result = setup.runLegacy();
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const current = read(path.join(setup.home, 'config.json'));
    assert.equal(current.ownerName, 'Captain Example');
    assert.equal(current.timeZone, 'America/Chicago');
    assert.equal(current.timeZoneLabel, 'ET');
    assert.equal(fs.readFileSync(path.join(setup.home, 'START-HERE.md'), 'utf8'), 'Historical bootstrap role');
    for (const [key, value] of Object.entries(old)) assert.deepEqual(current[key], value, key);
  },
);

test(
  'every private machine installs its selected historical protocol, not the neutral document set',
  { skip: !fs.existsSync(baseline) },
  context => {
    const home = scratch(context);
    const names = ['OPERATOR-BRIEF.md', 'OPERATOR-BRIEF-TOOLS.md', 'SETUP.md', 'README.md'];
    const original = git([
      'show',
      'f8fff1ab64b1289b77e798b72d17787806d53237:' + 'lighthouse/operator-kit/OPERATOR-BRIEF.md',
    ]).replaceAll('\r\n', '\n');
    const historicalProtocol = text =>
      text
        .replace(/\n## Coordinator notices\n[\s\S]*?(?=\nLine mode is frozen:)/, '')
        .replace(
          /\n3[.] \x60bash shift[.]sh kill-watchers\x60[\s\S]*?(?=\n   When firstmate directly asks)/,
          '\nLeased Monitor launch instructions',
        );
    for (const machine of read(baseline).machines) {
      const file = path.join(repository, machine.file);
      const output = path.join(home, path.basename(path.dirname(file)));
      const result = spawnSync(
        python,
        [
          path.join(kit, 'install.py'),
          '--config',
          file,
          '--out',
          output,
          '--set',
          '__BOARD_SERVER__=http://127.0.0.1:19999',
        ],
        { env, encoding: 'utf8', timeout: 60000 },
      );
      assert.equal(result.status, 0, result.stderr);
      const docs = machine.watch && machine.watch !== 'none' ? [...names, 'WATCH-BRIEF.md'] : names;
      for (const name of docs)
        assert.equal(
          fs.readFileSync(path.join(output, name), 'utf8'),
          fs
            .readFileSync(path.join(repository, 'private/lighthouse/operator-kit', name), 'utf8')
            .replaceAll('\r\n', '\n'),
          name,
        );
      assert.equal(
        historicalProtocol(fs.readFileSync(path.join(output, 'OPERATOR-BRIEF.md'), 'utf8')),
        historicalProtocol(original),
      );
      const setup = fs.readFileSync(path.join(output, 'SETUP.md'), 'utf8');
      assert.ok(setup.includes('__OPERATOR_TRANSCRIPT_DIR__'));
      assert.ok(!setup.includes('http://127.0.0.1:19999'));
    }
  },
);
