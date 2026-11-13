'use strict';
// Read-only release gates for the host's deploy/rollback commands: files, schema, manager identity and health.
// A candidate moves from validated to healthy only while its process, HTTP response, log and store agree.
// Refuse missing assets, unknown schema changes, a foreign pid or lost cards; these checks never migrate the store.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { spawnSync } = require('node:child_process');
const { createRequire } = require('node:module');

const assets = ['index.html', 'sw.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png'];
const legacyManifest = { format: 1, storeSchema: { min: 1, max: 1, write: 1 } };
function json(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error('invalid JSON in ' + path.basename(file));
    throw error;
  }
}
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

function manifest(release) {
  const value = json(path.join(release, 'release.json'));
  const schema = value.storeSchema || {};
  if (
    value.format !== 1 ||
    ![schema.min, schema.max, schema.write].every(Number.isSafeInteger) ||
    schema.min < 1 ||
    schema.max < schema.min ||
    schema.write < schema.min ||
    schema.write > schema.max ||
    (schema.writes !== undefined &&
      (!Array.isArray(schema.writes) ||
        !schema.writes.includes(schema.write) ||
        !schema.writes.every(item => Number.isSafeInteger(item) && item >= schema.min && item <= schema.max)))
  )
    throw new Error('invalid release schema contract');
  return value;
}

function storeState(file) {
  const value = fs.existsSync(file) ? json(file) : {};
  const schema = value.schemaVersion === undefined ? 1 : value.schemaVersion;
  if (!Number.isSafeInteger(schema) || schema < 1) throw new Error('invalid store schema version');
  if (value.cards !== undefined && (!value.cards || Array.isArray(value.cards) || typeof value.cards !== 'object'))
    throw new Error('invalid store cards');
  return { schema, cards: Object.keys(value.cards || {}) };
}

function compatible(release, storeFile) {
  // Reading an old schema is not enough: code-only activation must also write the unchanged schema.
  const schema = storeState(storeFile).schema;
  const support = manifest(release).storeSchema;
  if (schema < support.min || schema > support.max || !(support.writes || [support.write]).includes(schema))
    throw new Error('store schema incompatible; code-only activation refused; a separate data migration is required');
}

function config(home) {
  const file = path.join(home, 'config.json');
  const value = json(file);
  const port = value.port === undefined ? 7700 : value.port;
  if (
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535 ||
    (value.bind !== undefined && typeof value.bind !== 'string') ||
    (value.storeFile !== undefined && (typeof value.storeFile !== 'string' || !value.storeFile))
  )
    throw new Error('invalid board configuration');
  for (const field of ['tokens', 'boards']) {
    if (
      value[field] !== undefined &&
      (!value[field] || Array.isArray(value[field]) || typeof value[field] !== 'object')
    )
      throw new Error('invalid board configuration: ' + field);
  }
  return { port, bind: value.bind || '0.0.0.0', storeFile: path.resolve(home, value.storeFile || 'store.json') };
}

function validate(release, home) {
  for (const name of [
    'server.js',
    'board.sh',
    'rulings.json',
    'release.json',
    ...assets.map(name => 'public/' + name),
  ]) {
    const file = path.join(release, name);
    if (!fs.existsSync(file) || !fs.statSync(file).isFile() || fs.statSync(file).size === 0)
      throw new Error('missing or empty release file: ' + name);
  }
  for (const name of fs.readdirSync(release).filter(name => name.endsWith('.js'))) {
    const file = path.join(release, name);
    const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    if (result.status !== 0) throw new Error('JavaScript syntax validation failed: ' + name);
    const content = fs.readFileSync(file, 'utf8');
    for (const match of content.matchAll(/require\(\s*['"](\.\/[^'"]+)['"]\s*\)/g)) {
      try {
        const resolved = createRequire(file).resolve(match[1]);
        if (!resolved.startsWith(release + path.sep)) throw new Error('outside release');
      } catch {
        throw new Error('missing local dependency in ' + name);
      }
    }
  }
  const bash = process.platform === 'win32' ? path.join(process.env.ProgramFiles, 'Git', 'bin', 'bash.exe') : 'bash';
  if (spawnSync(bash, ['-n', path.join(release, 'board.sh')], { windowsHide: true }).status !== 0)
    throw new Error('board manager syntax validation failed');
  json(path.join(release, 'rulings.json'));
  json(path.join(release, 'public', 'manifest.webmanifest'));
  if (spawnSync(process.execPath, ['--check', path.join(release, 'public', 'sw.js')]).status !== 0)
    throw new Error('service worker syntax validation failed');
  const png = Buffer.from('89504e470d0a1a0a', 'hex');
  for (const name of assets.filter(name => name.endsWith('.png'))) {
    if (
      !fs
        .readFileSync(path.join(release, 'public', name))
        .subarray(0, 8)
        .equals(png)
    )
      throw new Error('invalid PNG asset: ' + name);
  }
  const settings = config(home);
  compatible(release, settings.storeFile);
  return settings;
}

function running(home) {
  // A reused pid is not our board, and a zombie has stopped even if a process-existence probe succeeds.
  try {
    const processId = Number(fs.readFileSync(path.join(home, 'board.pid'), 'utf8').trim());
    if (!Number.isSafeInteger(processId) || processId <= 1) return false;
    process.kill(processId, 0);
    if (/\) Z /.test(fs.readFileSync('/proc/' + processId + '/stat', 'utf8'))) return false;
    const args = fs.readFileSync('/proc/' + processId + '/cmdline', 'utf8').split('\0');
    const server = args.find(value => value.endsWith('/server.js'));
    if (!server || !server.startsWith(home + path.sep)) throw new Error('board pid belongs to another process');
    return server;
  } catch (error) {
    if (error.message === 'board pid belongs to another process') throw error;
    if (['ENOENT', 'ESRCH'].includes(error.code)) return false;
    throw error;
  }
}

async function quiet(file, { quietMs = 3000, quietTimeoutMs = 60000, pollMs = 100 } = {}) {
  // Refuse an active writer rather than taking a moving snapshot; timeout leaves the current release in place.
  const deadline = Date.now() + quietTimeoutMs;
  do {
    const age = fs.existsSync(file) ? Date.now() - fs.statSync(file).mtimeMs : Infinity;
    if (age >= quietMs) return;
    await delay(pollMs);
  } while (Date.now() < deadline);
  throw new Error('store did not become quiet; active release unchanged');
}

function realLogError(text) {
  // This known Node warning is not a startup failure; all other error-like lines still fail deployment.
  return text.split(/\r?\n/).some(line => {
    if (/^(?:\(node:\d+\) )?\[DEP0169\] DeprecationWarning:.*url\.parse\(\)/.test(line)) return false;
    if (/^\(Use .?node --trace-deprecation .* to show where the warning was created\)/.test(line)) return false;
    return /\b(?:[A-Za-z]*Error|error|failed|fatal|exception)\b/i.test(line);
  });
}

function httpOK({ port, bind }) {
  const host = bind === '::' ? '::1' : bind === '0.0.0.0' ? '127.0.0.1' : bind;
  return new Promise(resolve => {
    const request = http.get({ host, port, path: '/api/whoami', timeout: 1000 }, response => {
      response.resume();
      resolve(response.statusCode === 200);
    });
    request.on('timeout', () => request.destroy());
    request.on('error', () => resolve(false));
  });
}

async function healthy(home, release, settings, before, offset, timing = {}, contract = release) {
  // A responding port alone could belong to the old process; check identity, new log bytes and retained cards too.
  const deadline = Date.now() + (timing.healthTimeoutMs || 5000);
  do {
    const answered = await httpOK(settings);
    if (running(home) !== path.join(release, 'server.js')) throw new Error('release is not running');
    const log = path.join(home, 'board.log');
    if (fs.existsSync(log) && realLogError(fs.readFileSync(log).subarray(offset).toString()))
      throw new Error('new release logged an error');
    const current = storeState(settings.storeFile);
    if (before.cards.some(card => !current.cards.includes(card))) throw new Error('card count dropped');
    compatible(contract, settings.storeFile);
    if (answered) return;
    await delay(timing.pollMs || 100);
  } while (Date.now() < deadline);
  throw new Error('health check did not receive HTTP 200');
}

module.exports = {
  assets,
  legacyManifest,
  json,
  manifest,
  storeState,
  compatible,
  config,
  validate,
  running,
  quiet,
  healthy,
  realLogError,
};
