'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const net = require('node:net');
const check = require('./release-check');
const { protect, assertPrivate, writePrivate, flushDirectory } = require('./registry-files');
const { acquire } = require('./registry-lease');

const within = (parent, child) => child === parent || child.startsWith(parent + path.sep);

function copyTree(source, destination, parents = new Set()) {
  const resolved = fs.realpathSync(source);
  if (parents.has(resolved)) throw new Error('backup refuses a cyclic symbolic link');
  const stat = fs.statSync(source);
  if (stat.isDirectory()) {
    fs.mkdirSync(destination, { mode: 0o700 });
    const next = new Set([...parents, resolved]);
    for (const name of fs.readdirSync(source)) copyTree(path.join(source, name), path.join(destination, name), next);
    flushDirectory(destination);
  } else {
    if (!stat.isFile()) throw new Error('backup requires regular files');
    const descriptor = fs.openSync(destination, 'wx', 0o600);
    try {
      fs.writeFileSync(descriptor, fs.readFileSync(source));
      fs.fsyncSync(descriptor);
    } finally {
      fs.closeSync(descriptor);
    }
  }
}

function backup(home, cfg, storeFile, destination) {
  if (!destination) throw new Error('migration requires a new --backup directory outside the board home');
  destination = path.resolve(destination);
  const sources = [
    home,
    storeFile,
    storeFile + '.registry',
    path.resolve(home, cfg.attachmentsDir || 'attachments'),
    path.resolve(cfg.archiveDir || path.join(path.dirname(storeFile), 'archive')),
    path.resolve(home, cfg.vapidFile || 'vapid.json'),
    path.resolve(home, cfg.crm?.keyFile || 'crm.key'),
  ];
  if (cfg.rulingsFile) sources.push(path.resolve(home, cfg.rulingsFile));
  if (cfg.typesafeEnvFile) sources.push(path.resolve(cfg.typesafeEnvFile));
  const unique = [...new Set(sources.filter(file => fs.existsSync(file)).map(file => fs.realpathSync(file)))];
  const roots = unique.filter(file => !unique.some(other => other !== file && within(other, file)));
  const parent = fs.realpathSync(path.dirname(destination));
  destination = path.join(parent, path.basename(destination));
  if (roots.some(root => within(root, destination) || within(destination, root)))
    throw new Error('backup must be outside every source tree');
  fs.mkdirSync(destination, { mode: 0o700 });
  protect(destination, true);
  const entries = roots.map((source, index) => ({ source, copy: 'tree-' + index }));
  for (const entry of entries) copyTree(entry.source, path.join(destination, entry.copy));
  writePrivate(
    path.join(destination, 'complete.json'),
    { format: 1, entries, createdAt: new Date().toISOString() },
    true,
  );
  flushDirectory(destination);
  return destination;
}

async function offline(home, cfg) {
  const pidFile = path.join(home, 'board.pid');
  if (fs.existsSync(pidFile)) {
    const owner = Number(fs.readFileSync(pidFile, 'utf8').trim());
    if (!Number.isSafeInteger(owner) || owner <= 1) throw new Error('board pid requires local repair');
    try {
      process.kill(owner, 0);
      throw new Error('stop the board before migrating');
    } catch (error) {
      if (error.code !== 'ESRCH') throw error;
    }
  }
  await new Promise((resolve, reject) => {
    const socket = net.connect({
      host: ['::', '::1'].includes(cfg.bind) ? '::1' : !cfg.bind || cfg.bind === '0.0.0.0' ? '127.0.0.1' : cfg.bind,
      port: cfg.port || 7700,
    });
    socket.once('connect', () => {
      socket.destroy();
      reject(new Error('board port is active; stop it first'));
    });
    socket.once('error', error =>
      error.code === 'ECONNREFUSED' ? resolve() : reject(new Error('offline check failed')),
    );
    socket.setTimeout(2000, () => {
      socket.destroy();
      reject(new Error('offline check timed out'));
    });
  });
}

async function migrate(configPath, options = {}) {
  configPath = fs.realpathSync(configPath);
  const home = path.dirname(configPath);
  if (path.basename(configPath) !== 'config.json') throw new Error('migration requires the home config.json');
  const cfg = require('./configuration').normalize(check.json(configPath), configPath);
  const storeFile = path.resolve(home, cfg.storeFile || 'store.json');
  const release = options.release || __dirname;
  const declared = check.manifest(release).storeSchema;
  if (declared.max < 2 || !(declared.writes || [declared.write]).includes(2))
    throw new Error('migration requires a schema-2 release');
  const unlock = acquire(storeFile + '.runtime.lock');
  try {
    await offline(home, cfg);
    const schema = check.storeState(storeFile).schema;
    const receiptFile = storeFile + '.registry-migration.json';
    if (schema === 2) {
      const registry = require('./registry').makeRegistry(cfg, configPath);
      assertPrivate(receiptFile);
      const receipt = check.json(receiptFile);
      check.compatible(receipt.rollbackRelease, storeFile);
      return {
        schema: 2,
        migrated: false,
        boards: Object.keys(registry.metadata().boards).length,
        enrollmentEnabled: cfg.enrollment?.enabled === true,
        backupComplete: true,
        rollbackReady: true,
      };
    }
    if (schema !== 1) throw new Error('unsupported source schema');
    check.validate(release, home);
    const backupPath = backup(home, cfg, storeFile, options.backup);
    options.fault?.('backup-complete');
    const rollbackRelease = path.join(home, 'releases', 'registry-schema2-' + crypto.randomUUID());
    require('./board-release').copyRelease(release, rollbackRelease);
    const flushRelease = directory => {
      for (const name of fs.readdirSync(directory)) {
        const file = path.join(directory, name);
        if (fs.statSync(file).isDirectory()) flushRelease(file);
        else {
          const descriptor = fs.openSync(file, process.platform === 'win32' ? 'r+' : 'r');
          try {
            fs.fsyncSync(descriptor);
          } finally {
            fs.closeSync(descriptor);
          }
        }
      }
      flushDirectory(directory);
    };
    flushRelease(rollbackRelease);
    flushDirectory(path.dirname(rollbackRelease));
    flushDirectory(home);
    const registry = require('./registry').makeRegistry(cfg, configPath, { initialize: true, fault: options.fault });
    options.fault?.('registry-ready');
    const raw = fs.existsSync(storeFile) ? check.json(storeFile) : {};
    const temporary = storeFile + '.' + crypto.randomUUID() + '.migration.tmp';
    const receipt = { format: 1, backup: backupPath, rollbackRelease, storeSchema: 2 };
    const receiptTemporary = receiptFile + '.' + crypto.randomUUID() + '.tmp';
    writePrivate(receiptTemporary, receipt);
    fs.renameSync(receiptTemporary, receiptFile);
    flushDirectory(path.dirname(receiptFile));
    writePrivate(temporary, { ...raw, schemaVersion: 2 });
    options.fault?.('store-flushed');
    fs.renameSync(temporary, storeFile);
    flushDirectory(path.dirname(storeFile));
    options.fault?.('schema-committed');
    return {
      schema: 2,
      migrated: true,
      boards: Object.keys(registry.metadata().boards).length,
      enrollmentEnabled: cfg.enrollment?.enabled === true,
      backupComplete: true,
      rollbackReady: true,
    };
  } finally {
    unlock();
  }
}

module.exports = { migrate, backup, offline };
