'use strict';
require('../../tests/sandbox.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const { spawnSync } = require('node:child_process');
const { migrate } = require('../registry-migrate');
const { makeRegistry } = require('../registry');
const { compatible, legacyManifest } = require('../release-check');
const { acquire } = require('../registry-lease');

async function fixture(context) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-registry-migration-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const home = path.join(root, 'home');
  fs.mkdirSync(home);
  const listener = net.createServer();
  await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
  const port = listener.address().port;
  await new Promise(resolve => listener.close(resolve));
  assert.notEqual(port, 7700);
  const cfg = {
    profile: 'core',
    bind: '127.0.0.1',
    port,
    storeFile: '../external.json',
    attachmentsDir: '../attachments',
    archiveDir: path.join(root, 'archive'),
    boards: { retained: { name: 'Retained', access: { captain: 'owner' }, protocol: 'lines' } },
    tokens: { syntheticLegacy: { name: 'captain' } },
  };
  const config = path.join(home, 'config.json');
  fs.writeFileSync(config, JSON.stringify(cfg));
  const store = path.join(root, 'external.json');
  const raw = {
    seq: 7,
    cards: { old: { id: 'old', board: 'retained', by: 'untouched-author' } },
    comments: { words: { by: 'original-author', text: 'unchanged' } },
    boards: { retained: { id: 'retained' } },
  };
  fs.writeFileSync(store, JSON.stringify(raw));
  for (const name of ['attachments', 'archive']) {
    fs.mkdirSync(path.join(root, name));
    fs.writeFileSync(path.join(root, name, 'kept'), 'retained bytes');
  }
  fs.mkdirSync(path.join(home, 'claims'));
  fs.writeFileSync(path.join(home, 'claims', 'retained'), 'retained claim');
  const backup = path.join(root, 'backup');
  return { root, home, cfg, config, store, raw, backup };
}

test('offline migration backs up home and external data before its additive schema-2 marker', async context => {
  const board = await fixture(context);
  const legacy = makeRegistry(board.cfg, board.config);
  assert.equal(legacy.persistent, false);
  assert.throws(() => legacy.transact(() => {}), /offline registry migration/);
  assert.ok(!fs.existsSync(board.store + '.registry'));
  compatible(path.resolve(__dirname, '..'), board.store);
  const result = await migrate(board.config, { backup: board.backup });
  assert.deepEqual(result, {
    schema: 2,
    migrated: true,
    boards: 1,
    enrollmentEnabled: false,
    backupComplete: true,
    rollbackReady: true,
  });
  assert.deepEqual(JSON.parse(fs.readFileSync(board.store)), { ...board.raw, schemaVersion: 2 });
  assert.deepEqual(JSON.parse(fs.readFileSync(board.config)), board.cfg);
  const manifest = JSON.parse(fs.readFileSync(path.join(board.backup, 'complete.json')));
  for (const entry of manifest.entries) {
    const copy = path.join(board.backup, entry.copy);
    if (entry.source === board.store) assert.deepEqual(JSON.parse(fs.readFileSync(copy)), board.raw);
    if (entry.source === board.home)
      assert.equal(fs.readFileSync(path.join(copy, 'claims', 'retained'), 'utf8'), 'retained claim');
    if (['attachments', 'archive'].includes(path.basename(entry.source)))
      assert.equal(fs.readFileSync(path.join(copy, 'kept'), 'utf8'), 'retained bytes');
  }
  const receipt = JSON.parse(fs.readFileSync(board.store + '.registry-migration.json'));
  compatible(receipt.rollbackRelease, board.store);
  compatible(path.resolve(__dirname, '..'), board.store);
  const oldRelease = path.join(board.root, 'old-release');
  fs.mkdirSync(oldRelease);
  fs.writeFileSync(path.join(oldRelease, 'release.json'), JSON.stringify(legacyManifest));
  assert.throws(() => compatible(oldRelease, board.store), /schema incompatible/);
  const oldGuard = spawnSync(process.execPath, [
    '-e',
    'const fs=require("fs");const contract=JSON.parse(fs.readFileSync(process.argv[1]));' +
      'const schema=JSON.parse(fs.readFileSync(process.argv[2])).schemaVersion||1;' +
      'const support=contract.storeSchema;if(schema<support.min||schema>support.max||support.write!==schema)' +
      'process.exit(2);',
    path.join(oldRelease, 'release.json'),
    board.store,
  ]);
  assert.equal(oldGuard.status, 2);
  assert.equal(makeRegistry(board.cfg, board.config).persistent, true);
  const repeated = await migrate(board.config);
  assert.equal(repeated.migrated, false);
  assert.equal(repeated.rollbackReady, true);
});

test('migration refuses active writers, unsafe backups and unknown schemas without changes', async context => {
  const board = await fixture(context);
  const unlock = acquire(board.store + '.runtime.lock');
  await assert.rejects(migrate(board.config, { backup: board.backup }), /runtime or migration is active/);
  unlock();
  const listener = net.createServer();
  await new Promise(resolve => listener.listen(board.cfg.port, '127.0.0.1', resolve));
  await assert.rejects(migrate(board.config, { backup: board.backup }), /port is active/);
  await new Promise(resolve => listener.close(resolve));
  await assert.rejects(migrate(board.config, { backup: path.join(board.home, 'bad-backup') }), /outside/);
  assert.deepEqual(JSON.parse(fs.readFileSync(board.store)), board.raw);
  assert.ok(!fs.existsSync(board.store + '.registry'));
  fs.writeFileSync(board.store, JSON.stringify({ ...board.raw, schemaVersion: 3 }));
  await assert.rejects(migrate(board.config, { backup: board.backup }), /unsupported source/);
});

test('migration crashes preserve old compatibility or complete schema-2 registry and rollback', async context => {
  for (const stage of [
    'backup-complete',
    'metadata-flushed',
    'credentials-flushed',
    'pointer-flushed',
    'pointer-renamed',
    'committed',
    'registry-ready',
    'store-flushed',
    'schema-committed',
  ]) {
    await context.test(stage, async child => {
      const board = await fixture(child);
      const env = { ...process.env };
      delete env.TYPESAFE_API_KEY;
      const stopped = spawnSync(
        process.execPath,
        [path.join(__dirname, 'registry-migration-worker.cjs'), board.config, board.backup, stage],
        { env, windowsHide: true, timeout: 30000 },
      );
      assert.equal(stopped.status, 87);
      assert.ok(fs.existsSync(path.join(board.backup, 'complete.json')));
      const registry = makeRegistry(board.cfg, board.config);
      assert.equal(registry.board('retained').id, 'retained');
      const retry = await migrate(board.config, { backup: path.join(board.root, 'retry-backup') });
      assert.equal(retry.schema, 2);
      assert.equal(retry.migrated, stage !== 'schema-committed');
    });
  }
});

module.exports = { fixture };
