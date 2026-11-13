'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { assertNoPaidKey, assertTestConfig, home, spawnServer, testPort } = require('./sandbox.cjs');

test('test homes and session discovery never use the caller configuration', () => {
  assert.equal(os.homedir(), home);
  for (const name of ['HOME', 'USERPROFILE', 'CLAUDE_CONFIG_DIR', 'CODEX_HOME', 'XDG_CONFIG_HOME']) {
    const relative = path.relative(home, process.env[name]);
    assert.ok(!relative.startsWith('..') && !path.isAbsolute(relative));
  }
  assert.ok(!fs.existsSync(path.join(process.env.CLAUDE_CONFIG_DIR, '.claude.json')));
});

test('a set paid key refuses server startup, including an explicit child environment', () => {
  assert.throws(() => assertNoPaidKey({ TYPESAFE_API_KEY: '' }), /refuse/);
  assert.throws(() => spawnServer('not-a-config', { env: { TYPESAFE_API_KEY: 'synthetic' } }), /refuse/);
  const result = spawnSync(
    process.execPath,
    ['-e', `require(${JSON.stringify(__filename.replace(/test\.cjs$/, 'cjs'))})`],
    {
      env: { ...process.env, TYPESAFE_API_KEY: 'synthetic' },
      encoding: 'utf8',
    },
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /test servers refuse a set TYPESAFE_API_KEY/);
  assert.ok(!result.stderr.includes('synthetic'));
});

test('server fixtures require temporary configuration, loopback and a non-live port', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-guard-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'config.json');
  const port = await testPort();
  fs.writeFileSync(file, JSON.stringify({ port, bind: '127.0.0.1', storeFile: 'store.json' }));
  assert.doesNotThrow(() => assertTestConfig(file));
  for (const invalid of [{ port: 7700 }, { port: 0 }, { bind: '0.0.0.0' }, { storeFile: '../store.json' }]) {
    fs.writeFileSync(file, JSON.stringify({ port, bind: '127.0.0.1', storeFile: 'store.json', ...invalid }));
    assert.throws(() => assertTestConfig(file));
  }
  const keyFile = path.join(dir, 'typesafe.env');
  fs.writeFileSync(keyFile, 'TYPESAFE_API_KEY=synthetic\n');
  fs.writeFileSync(file, JSON.stringify({ port, bind: '127.0.0.1', typesafeEnvFile: keyFile }));
  for (const url of ['https://example.invalid/judge', 'http://127.0.0.1:7700/judge', 'http://127.0.0.1/judge']) {
    assert.throws(() => spawnServer(file, { env: { LH_JEV_URL: url } }));
  }
  fs.writeFileSync(file, JSON.stringify({ port, bind: '127.0.0.1', typesafeEnvFile: __filename }));
  assert.throws(() => assertTestConfig(file));
});
