'use strict';
const { fs, path, read, assertPrivate } = require('./common.cjs');
const { spawnSync } = require('node:child_process');
const { nodeCheck, nodeAdvisories } = require('../operator-kit/scripts/setup-runtime.cjs');
async function doctor(home) {
  if (fs.existsSync(path.join(home, 'lighthouse-mcp.cjs'))) {
    const result = await require('../operator-kit/scripts/setup-runtime.cjs').doctor(home);
    try {
      assertPrivate(home, true);
      if (fs.existsSync(path.join(home, 'binding.json'))) {
        assertPrivate(path.join(home, 'credential.json'));
        assertPrivate(path.join(home, 'binding.json'));
      }
      result.checks.push({ name: 'private storage', status: 'ok', detail: 'permissions verified' });
    } catch {
      result.checks.push({ name: 'private storage', status: 'fault', detail: 'repair permissions locally' });
    }
    return result;
  }
  const checks = [nodeCheck()];
  function record(name, status, detail) {
    checks.push({ name, status, detail });
  }
  for (const name of ['bash', 'flock', 'setsid', 'curl']) {
    const result = spawnSync('bash', ['-c', 'command -v "$1" >/dev/null', 'doctor', name], {
      stdio: 'ignore',
      timeout: 10000,
      windowsHide: true,
    });
    record(name, result.status === 0 ? 'ok' : 'fault', result.status === 0 ? 'available' : 'unavailable');
  }
  let cfg, registry;
  try {
    cfg = read(path.join(home, 'config.json'));
    const store = path.resolve(home, cfg.storeFile || 'store.json');
    registry = read(path.join(store + '.registry', 'current.json'));
    if (read(store).schemaVersion !== 2 || !registry.generation) throw new Error();
    record('registry', 'ok', 'schema 2 snapshot selected');
    assertPrivate(home, true);
    assertPrivate(path.join(home, 'admin.json'));
    record('private storage', 'ok', 'host and administrator protected');
  } catch {
    record('registry and storage', 'fault', 'configuration or private registry unavailable');
  }
  try {
    const current = path.join(home, 'current');
    if (!fs.lstatSync(current).isSymbolicLink()) throw new Error();
    const release = read(path.join(current, 'release.json'));
    if (!release.storeSchema?.writes?.includes(2)) throw new Error();
    record('release', 'ok', 'pinned schema 2 release');
  } catch {
    record('release', 'fault', 'active pinned release unavailable');
  }
  if (cfg) {
    try {
      const response = await fetch('http://127.0.0.1:' + cfg.port + '/', {
        redirect: 'error',
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) throw new Error();
      record('last board contact', 'ok', new Date().toISOString());
    } catch {
      record('last board contact', 'fault', 'host server not reachable');
    }
  }
  for (const name of ['binding', 'hooks', 'tool server', 'watchers and lease'])
    record(name, 'ok', 'operator-only; not required on a host');
  return { kind: 'host', checks, advisories: nodeAdvisories() };
}
module.exports = { doctor };
