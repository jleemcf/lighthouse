'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');

function assertNoPaidKey(env = process.env) {
  assert.ok(!Object.hasOwn(env, 'TYPESAFE_API_KEY'), 'test servers refuse a set TYPESAFE_API_KEY');
}

assertNoPaidKey();
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-test-home-'));
for (const name of Object.keys(process.env)) if (name.startsWith('LH_')) delete process.env[name];
for (const name of ['HOME', 'USERPROFILE']) process.env[name] = home;
for (const name of ['CLAUDE_CONFIG_DIR', 'CODEX_HOME', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME']) {
  process.env[name] = path.join(home, name.toLowerCase());
  fs.mkdirSync(process.env[name]);
}
process.on('exit', () => fs.rmSync(home, { recursive: true, force: true }));

async function testPort() {
  assertNoPaidKey();
  const listener = net.createServer();
  await new Promise((resolve, reject) => {
    listener.once('error', reject);
    listener.listen(0, '127.0.0.1', resolve);
  });
  const port = listener.address().port;
  await new Promise(resolve => listener.close(resolve));
  assert.notEqual(port, 7700);
  return port;
}

function assertTestConfig(config) {
  const file = fs.realpathSync(config);
  const relative = path.relative(fs.realpathSync(os.tmpdir()), file);
  assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative), 'config must be temporary');
  const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(cfg.bind, '127.0.0.1', 'test servers bind only loopback');
  assert.ok(Number.isInteger(cfg.port) && cfg.port > 0 && cfg.port !== 7700, 'use an ephemeral test port');
  const store = path.resolve(path.dirname(file), cfg.storeFile || 'store.json');
  const storeRelative = path.relative(path.dirname(file), store);
  assert.ok(storeRelative && !storeRelative.startsWith('..') && !path.isAbsolute(storeRelative));
  if (cfg.typesafeEnvFile) {
    const relativeKey = path.relative(path.dirname(file), fs.realpathSync(cfg.typesafeEnvFile));
    assert.ok(relativeKey && !relativeKey.startsWith('..') && !path.isAbsolute(relativeKey));
  }
  return cfg;
}

function spawnServer(config, options = {}) {
  assertNoPaidKey();
  assertNoPaidKey(options.env || process.env);
  const cfg = assertTestConfig(config);
  if (cfg.typesafeEnvFile) {
    const judge = new URL((options.env || process.env).LH_JEV_URL);
    assert.equal(judge.protocol, 'http:');
    assert.equal(judge.hostname, '127.0.0.1', 'fixture keys can reach only a loopback stand-in');
    assert.ok(judge.port && judge.port !== '7700');
  }
  const server = path.join(__dirname, '..', 'server', 'server.js');
  return spawn(process.execPath, [server, '--config', config], options);
}

module.exports = { assertNoPaidKey, assertTestConfig, home, spawnServer, testPort };
