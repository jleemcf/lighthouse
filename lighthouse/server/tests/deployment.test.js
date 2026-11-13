'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { fixture, linuxOnly, pause, run, source } = require('./deploy-fixture.cjs');
const { realLogError, config, healthy, storeState } = require('../release-check');
const unsupportedSchema = require('../release.json').storeSchema.max + 1;

test('ReplacementHasBackup: first flat-layout deploy retains code and flushed store', linuxOnly, async context => {
  const board = await fixture(context);
  const result = await board.controlled();
  assert.equal(result.code, 0, result.output);
  assert.equal((await board.request()).body, 'new');
  const previous = JSON.parse(fs.readFileSync(path.join(board.home, 'previous-release.json'))).release;
  assert.match(fs.readFileSync(path.join(previous, 'server.js'), 'utf8'), /"old"/);
  const backups = fs.readdirSync(path.join(board.home, 'backups'));
  assert.equal(backups.length, 1);
  const backup = JSON.parse(fs.readFileSync(path.join(board.home, 'backups', backups[0], 'store.json')));
  assert.ok(backup.cards.kept);
  assert.equal((await board.manager('restart')).code, 0);
  assert.equal((await board.request()).body, 'new');
  const restored = await board.controlled({ action: 'rollback', target: previous });
  assert.equal(restored.code, 0, restored.output);
  assert.equal(board.active(), previous);
  assert.equal((await board.request()).body, 'old');
  assert.ok(JSON.parse(fs.readFileSync(path.join(board.home, 'store.json'))).cards.kept);
});

test('deployment restores old code for a fault before and after every stage', linuxOnly, async context => {
  const stages = [
    'stage',
    'validate',
    'backup',
    'quiet',
    'stop',
    'snapshot',
    'migrate',
    'switch',
    'start',
    'health',
    'commit',
  ];
  for (const stage of stages) {
    for (const boundary of ['before', 'after']) {
      const fault = stage + '.' + boundary;
      await context.test(fault, async child => {
        const board = await fixture(child);
        const result = await board.controlled({ fault });
        assert.notEqual(result.code, 0, result.output);
        assert.match(result.output, /injected/);
        assert.equal((await board.request()).body, 'old', result.output);
        assert.match(fs.readFileSync(path.join(board.active(), 'server.js'), 'utf8'), /"old"/);
        assert.ok(!fs.existsSync(path.join(board.home, '.board-deploy.json')));
        assert.equal((await board.manager('restart')).code, 0);
        assert.equal((await board.request()).body, 'old');
      });
    }
  }
});

test('legacy flat-home recovery survives stop and migration interruptions', linuxOnly, async context => {
  const faults = ['stop.after', 'snapshot.before', 'snapshot.after', 'migrate.before'];
  for (const fault of [...faults, 'manager-written', 'migration-pointer']) {
    for (const crash of faults.includes(fault) ? [false, true] : [true]) {
      await context.test(fault + (crash ? ' crash' : ' failure'), async child => {
        const board = await fixture(child, { legacyManager: true });
        assert.ok(!fs.existsSync(path.join(board.home, 'release.json')));
        const result = await board.controlled({ fault, crash });
        assert.notEqual(result.code, 0, result.output);
        if (crash) {
          assert.equal(result.code, 87, result.output);
          assert.ok(fs.existsSync(path.join(board.home, '.board-deploy.json')));
          const recovery = await board.controlled({ action: 'recover' });
          assert.equal(recovery.code, 0, recovery.output);
        } else assert.match(result.output, /injected/);
        assert.equal((await board.request()).body, 'old', result.output);
        assert.ok(!fs.existsSync(path.join(board.home, '.board-deploy.json')));
        assert.equal((await board.manager('restart')).code, 0);
        assert.equal((await board.request()).body, 'old');
      });
    }
  }
});

test('legacy manager runtime failure restores the flat restart path', linuxOnly, async context => {
  for (const interrupted of [false, true]) {
    await context.test(interrupted ? 'explicit recovery' : 'automatic restoration', async child => {
      const board = await fixture(child, { legacyManager: true });
      const original = fs.readFileSync(path.join(board.home, 'board.sh'), 'utf8');
      const candidateManager = path.join(board.candidate, 'board.sh');
      const content = fs.readFileSync(candidateManager, 'utf8');
      const broken = content.replace('  start)\n', '  start)\n    exit 42\n');
      assert.notEqual(broken, content);
      fs.writeFileSync(candidateManager, broken);
      const result = await board.controlled(interrupted ? { fault: 'start.before', crash: true } : {});
      assert.notEqual(result.code, 0, result.output);
      if (interrupted) {
        assert.equal(result.code, 87, result.output);
        const recovery = await board.controlled({ action: 'recover' });
        assert.equal(recovery.code, 0, recovery.output);
      } else assert.match(result.output, /board start failed/);
      assert.equal(fs.readFileSync(path.join(board.home, 'board.sh'), 'utf8'), original);
      assert.equal(board.active(), board.home);
      assert.ok(!fs.existsSync(path.join(board.home, '.board-deploy.json')));
      assert.equal((await board.request()).body, 'old');
      assert.equal((await board.manager('restart')).code, 0);
      assert.equal((await board.request()).body, 'old');
    });
  }
});

test('runtime startup failure restores the previous runnable release', linuxOnly, async context => {
  const board = await fixture(context);
  fs.writeFileSync(path.join(board.candidate, 'server.js'), 'throw new Error("runtime fault");\n');
  const result = await board.controlled();
  assert.notEqual(result.code, 0);
  assert.match(result.output, /start failed/);
  assert.equal((await board.request()).body, 'old');
});

test('health refuses HTTP errors, lost cards and real error logs', linuxOnly, async context => {
  for (const fault of ['http', 'cards', 'log']) {
    await context.test(fault, async child => {
      const board = await fixture(child);
      let content = board.server('new');
      if (fault === 'http')
        content = content.replace('response.end("new")', '(response.statusCode = 503, response.end())');
      if (fault === 'cards')
        content += '\nfs.writeFileSync(require("node:path").join(__dirname, "../../store.json"), "{}");';
      if (fault === 'log') content += '\nconsole.error("Error: real startup failure");';
      fs.writeFileSync(path.join(board.candidate, 'server.js'), content);
      const result = await board.controlled();
      assert.notEqual(result.code, 0, result.output);
      assert.match(result.output, /HTTP 200|card count dropped|logged an error/);
      assert.equal((await board.request()).body, 'old');
      assert.equal(fs.readdirSync(path.join(board.home, 'backups')).length, 1);
    });
  }
});

test('DEP0169 and its trace companion do not roll back a healthy release', linuxOnly, async context => {
  const board = await fixture(context);
  const warning = '(node:123) [DEP0169] DeprecationWarning: url.parse() behavior is not standardized';
  const companion =
    '(Use ' +
    String.fromCharCode(96) +
    'node --trace-deprecation ...' +
    String.fromCharCode(96) +
    ' to show where the warning was created)';
  fs.appendFileSync(
    path.join(board.candidate, 'server.js'),
    '\nconsole.error(' + JSON.stringify(warning + '\n' + companion) + ');',
  );
  const result = await board.controlled();
  assert.equal(result.code, 0, result.output);
  assert.equal((await board.request()).body, 'new');
  assert.equal(realLogError(warning + '\n' + companion), false);
  assert.equal(realLogError(warning + '\nError: failed'), true);
});

test('CRLF candidate manager is normalized before validation and migration', linuxOnly, async context => {
  const board = await fixture(context);
  const manager = path.join(board.candidate, 'board.sh');
  fs.writeFileSync(manager, fs.readFileSync(manager, 'utf8').replace(/\n/g, '\r\n'));
  fs.rmSync(path.join(board.home, 'release.json'));
  const result = await board.controlled();
  assert.equal(result.code, 0, result.output);
  assert.ok(!fs.readFileSync(path.join(board.active(), 'board.sh'), 'utf8').includes('\r'));
  assert.ok(!fs.readFileSync(path.join(board.home, 'board.sh'), 'utf8').includes('\r'));
  assert.equal((await board.manager('restart')).code, 0);
  assert.equal((await board.request()).body, 'new');
});

test('incompatible code-only rollback is refused without stopping or changing the store', linuxOnly, async context => {
  const board = await fixture(context);
  assert.equal((await board.controlled()).code, 0);
  const active = board.active();
  const previous = JSON.parse(fs.readFileSync(path.join(board.home, 'previous-release.json'))).release;
  const store = path.join(board.home, 'store.json');
  const data = JSON.parse(fs.readFileSync(store));
  data.schemaVersion = unsupportedSchema;
  fs.writeFileSync(store, JSON.stringify(data));
  const before = fs.readFileSync(store, 'utf8');
  const result = await board.controlled({ action: 'rollback', target: previous });
  assert.notEqual(result.code, 0);
  assert.match(result.output, /store schema incompatible/);
  assert.equal(board.active(), active);
  assert.equal(fs.readFileSync(store, 'utf8'), before);
  assert.equal((await board.request()).body, 'new');
});

test('a schema changed by failed activation blocks unsafe automatic restoration', linuxOnly, async context => {
  const board = await fixture(context);
  fs.appendFileSync(
    path.join(board.candidate, 'server.js'),
    '\nconst file = require("node:path").join(__dirname, "../../store.json");' +
      '\nconst store = JSON.parse(fs.readFileSync(file)); store.schemaVersion = ' +
      unsupportedSchema +
      ';' +
      '\nfs.writeFileSync(file, JSON.stringify(store));',
  );
  const result = await board.controlled();
  assert.notEqual(result.code, 0);
  assert.match(result.output, /recovery refused.*schema incompatible.*journal retained/);
  assert.equal((await board.request()).body, 'new');
  assert.ok(fs.existsSync(path.join(board.home, '.board-deploy.json')));
  assert.notEqual((await board.manager('restart')).code, 0);
});

test(
  'migration then deployment retains a schema-2 fallback; rollback never replaces newer store work',
  linuxOnly,
  async context => {
    const board = await fixture(context);
    assert.equal((await board.manager('stop')).code, 0);
    const { legacyManifest, compatible } = require('../release-check');
    fs.writeFileSync(path.join(board.home, 'release.json'), JSON.stringify(legacyManifest));
    const { migrate } = require('../registry-migrate');
    const storeFile = path.join(board.home, 'store.json');
    await migrate(path.join(board.home, 'config.json'), {
      backup: path.join(board.root, 'full-backup'),
      release: board.candidate,
    });
    const receipt = JSON.parse(fs.readFileSync(storeFile + '.registry-migration.json'));
    compatible(receipt.rollbackRelease, storeFile);
    const failure = await board.controlled({ fault: 'snapshot.after' });
    assert.notEqual(failure.code, 0);
    assert.equal(board.active(), receipt.rollbackRelease);
    const deployed = await board.controlled();
    assert.equal(deployed.code, 0, deployed.output);
    const newer = JSON.parse(fs.readFileSync(storeFile));
    newer.cards.newer = { id: 'newer', board: 'test', by: 'newer-author' };
    fs.writeFileSync(storeFile, JSON.stringify(newer));
    const bytes = fs.readFileSync(storeFile, 'utf8');
    const rolled = await board.controlled({ action: 'rollback', target: receipt.rollbackRelease });
    assert.equal(rolled.code, 0, rolled.output);
    assert.equal(fs.readFileSync(storeFile, 'utf8'), bytes);
    const old = path.join(board.home, 'releases', 'schema1');
    require('../board-release').copyRelease(board.home, old);
    fs.writeFileSync(path.join(old, 'release.json'), JSON.stringify(legacyManifest));
    const refused = await board.controlled({ action: 'rollback', target: old });
    assert.notEqual(refused.code, 0);
    assert.match(refused.output, /store schema incompatible/);
    assert.equal(board.active(), receipt.rollbackRelease);
    assert.equal(fs.readFileSync(storeFile, 'utf8'), bytes);
  },
);

test('an interrupted switch is visible and recoverable, never silently retried', linuxOnly, async context => {
  for (const fault of ['stop.after', 'migrate.after', 'switch.after', 'start.after']) {
    await context.test(fault, async child => {
      const board = await fixture(child);
      assert.equal((await board.controlled({ fault, crash: true })).code, 87);
      assert.ok(fs.existsSync(path.join(board.home, '.board-deploy.json')));
      const retry = await board.controlled();
      assert.notEqual(retry.code, 0);
      assert.match(retry.output, /unfinished deployment/);
      if (fault !== 'stop.after') assert.notEqual((await board.manager('start')).code, 0);
      const recovered = await board.controlled({ action: 'recover' });
      assert.equal(recovered.code, 0, recovered.output);
      assert.equal((await board.request()).body, 'old');
      assert.ok(!fs.existsSync(path.join(board.home, '.board-deploy.json')));
    });
  }
});

test('a busy store times out before stopping the old board', linuxOnly, async context => {
  const board = await fixture(context);
  const store = path.join(board.home, 'store.json');
  const timer = setInterval(() => fs.utimesSync(store, new Date(), new Date()), 5);
  context.after(() => clearInterval(timer));
  const result = await board.controlled();
  clearInterval(timer);
  assert.notEqual(result.code, 0);
  assert.match(result.output, /store did not become quiet/);
  assert.equal((await board.request()).body, 'old');
  assert.equal(board.active(), board.home);
});

test('a stop timeout leaves the old release and pid intact', linuxOnly, async context => {
  const board = await fixture(context);
  fs.writeFileSync(
    path.join(board.home, 'server.js'),
    board.server('old').replace('server.close(() => process.exit(0))', 'undefined'),
  );
  assert.equal((await board.manager('restart')).code, 0);
  const processId = fs.readFileSync(path.join(board.home, 'board.pid'), 'utf8');
  const result = await board.controlled();
  assert.notEqual(result.code, 0);
  assert.match(result.output, /stop failed/);
  assert.equal(board.active(), board.home);
  assert.equal(fs.readFileSync(path.join(board.home, 'board.pid'), 'utf8'), processId);
  assert.equal((await board.request()).body, 'old');
});

test('validation rejects missing assets, dependencies and invalid configuration', linuxOnly, async context => {
  for (const fault of ['asset', 'dependency', 'config', 'malformed JSON']) {
    await context.test(fault, async child => {
      const board = await fixture(child);
      if (fault === 'asset') fs.rmSync(path.join(board.candidate, 'public', 'index.html'));
      if (fault === 'dependency') fs.appendFileSync(path.join(board.candidate, 'server.js'), '\nrequire("./missing");');
      if (fault === 'config') fs.writeFileSync(path.join(board.home, 'config.json'), '{"port":"wrong"}');
      if (fault === 'malformed JSON') fs.writeFileSync(path.join(board.home, 'config.json'), 'PRIVATE-FIXTURE-CONTENT');
      const result = await board.controlled();
      assert.notEqual(result.code, 0);
      assert.ok(!result.output.includes('PRIVATE-FIXTURE-CONTENT'));
      assert.equal((await board.request()).body, 'old');
      assert.equal(board.active(), board.home);
    });
  }
});

test('the real dependency-free server activates with its assets on a scratch port', linuxOnly, async context => {
  const board = await fixture(context);
  fs.copyFileSync(path.join(source, 'server.js'), path.join(board.candidate, 'server.js'));
  const result = await board.deploy();
  assert.equal(result.code, 0, result.output);
  const response = await board.request();
  assert.equal(response.status, 200);
  assert.equal(JSON.parse(response.body).principal, null);
  assert.equal((await board.manager('restart')).code, 0);
  assert.equal((await board.request()).status, 200);
});

test('configured bind health probes activate and restore real servers', linuxOnly, async context => {
  const cases = [
    { bind: '127.0.0.2' },
    { bind: '::1' },
    { bind: '0.0.0.0', loopback: '127.0.0.1' },
    { bind: '::', loopback: '::1' },
  ];
  for (const { bind, loopback } of cases) {
    await context.test(bind, async child => {
      const board = await fixture(child, { bind: loopback || bind });
      if (loopback) {
        const settings = { ...config(board.home), bind };
        await healthy(board.home, board.home, settings, storeState(settings.storeFile), 0);
        return;
      }
      fs.copyFileSync(path.join(source, 'server.js'), path.join(board.candidate, 'server.js'));
      assert.equal((await board.request()).status, 200);
      const activated = await board.deploy();
      assert.equal(activated.code, 0, activated.output);
      assert.equal(JSON.parse((await board.request()).body).principal, null);
      const previous = board.active();
      const rejected = await board.controlled({ fault: 'health.after' });
      assert.notEqual(rejected.code, 0, rejected.output);
      assert.match(rejected.output, /injected health.after/);
      assert.equal(board.active(), previous);
      assert.ok(!fs.existsSync(path.join(board.home, '.board-deploy.json')));
      assert.equal((await board.request()).status, 200);
    });
  }
});

test('concurrent deploy and manual starts respect the same control lock', linuxOnly, async context => {
  const board = await fixture(context);
  const marker = path.join(board.root, 'locked');
  const script = 'require("node:fs").writeFileSync(process.argv[1], "ready"); setTimeout(() => {}, 1500);';
  const holding = run('flock', [path.join(board.home, '.board-control.lock'), process.execPath, '-e', script, marker]);
  for (let attempt = 0; attempt < 100 && !fs.existsSync(marker); attempt++) await pause(10);
  assert.ok(fs.existsSync(marker));
  const deploy = await board.deploy();
  assert.notEqual(deploy.code, 0);
  assert.match(deploy.output, /control lock/);
  assert.notEqual((await board.manager('start')).code, 0);
  assert.equal((await board.request()).body, 'old');
  assert.equal((await holding).code, 0);
});

test('store safety copy includes the old process final shutdown write', linuxOnly, async context => {
  const board = await fixture(context);
  const content = board
    .server('old')
    .replace(
      'server.close(() => process.exit(0))',
      '(() => { const file = require("node:path").join(__dirname, "store.json");' +
        ' const store = JSON.parse(fs.readFileSync(file)); store.cards.drained = {board: "test"};' +
        ' fs.writeFileSync(file, JSON.stringify(store)); server.close(() => process.exit(0)); })()',
    );
  fs.writeFileSync(path.join(board.home, 'server.js'), content);
  assert.equal((await board.manager('restart')).code, 0);
  const result = await board.controlled();
  assert.equal(result.code, 0, result.output);
  const backup = fs.readdirSync(path.join(board.home, 'backups'))[0];
  const store = JSON.parse(fs.readFileSync(path.join(board.home, 'backups', backup, 'store.json')));
  assert.ok(store.cards.drained);
});

test('a real error logged by the HTTP probe rejects activation', linuxOnly, async context => {
  const board = await fixture(context);
  const content = board
    .server('new')
    .replace('response.end("new")', '(console.error("Error: health route failure"), response.end("new"))');
  fs.writeFileSync(path.join(board.candidate, 'server.js'), content);
  const result = await board.controlled();
  assert.notEqual(result.code, 0, result.output);
  assert.match(result.output, /logged an error/);
  assert.equal((await board.request()).body, 'old');
});

test('failed activation restores a previously stopped home without starting it', linuxOnly, async context => {
  const board = await fixture(context);
  assert.equal((await board.manager('stop')).code, 0);
  const result = await board.controlled({ fault: 'health.after' });
  assert.notEqual(result.code, 0, result.output);
  assert.match((await board.manager('status')).output, /not running/);
  assert.equal((await board.manager('start')).code, 0);
  assert.equal((await board.request()).body, 'old');
});

test('failed candidate stop retains the current pointer and recovery journal', linuxOnly, async context => {
  const board = await fixture(context);
  fs.writeFileSync(
    path.join(board.candidate, 'server.js'),
    board.server('new').replace('server.close(() => process.exit(0))', 'undefined'),
  );
  const result = await board.controlled({ fault: 'health.after' });
  assert.notEqual(result.code, 0, result.output);
  assert.match(result.output, /recovery refused\/failed.*stop failed.*journal retained/);
  assert.equal((await board.request()).body, 'new');
  assert.match(fs.readFileSync(path.join(board.active(), 'server.js'), 'utf8'), /"new"/);
  assert.ok(fs.existsSync(path.join(board.home, '.board-deploy.json')));
});
