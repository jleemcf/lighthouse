'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const storage = require('./dispatch-storage.cjs');
const kinds = ['boardwatch', 'fmwatch', 'collector'];
const lastGood = new Map();

function verify(status, session, board) {
  const owner = status?.ownership;
  if (
    !status?.recoveryAvailable ||
    !status.enabled ||
    owner?.holderSessionId !== session.sessionId ||
    owner.epoch !== session.epoch ||
    owner.leaseUntil <= Date.now() ||
    owner.phase !== 'working'
  )
    throw new Error('current working generation and recovery readiness required; helpers remain stopped');
  return owner;
}
function create(home, board, session, status, kind) {
  if (!kinds.includes(kind)) throw new Error('unknown generation helper');
  const owner = verify(status, session, board);
  const directory = path.join(home, 'helper-generations', storage.hash(board));
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (!require('./setup-runtime.cjs').privateStorage(directory, directory))
    throw new Error('helper generation storage must be private');
  const generation = storage.hash([board, owner.installationId, session.sessionId, session.epoch]);
  const marker = path.join(directory, session.epoch + '.generation.json');
  const identity = {
    version: 1,
    generation,
    board,
    installationId: owner.installationId,
    sessionId: session.sessionId,
    epoch: session.epoch,
  };
  try {
    fs.writeFileSync(marker, JSON.stringify(identity), { flag: 'wx', mode: 0o600 });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
  if (storage.hash(JSON.parse(fs.readFileSync(marker, 'utf8'))) !== storage.hash(identity))
    throw new Error('conflicting generation identity');
  const registry = path.join(directory, generation + '-' + kind + '.active.json');
  const id = crypto.randomUUID();
  storage.write(registry, JSON.stringify({ ...identity, id, kind }));
  const file = path.join(directory, id + '.json');
  const record = {
    version: 1,
    registry,
    generation,
    id,
    kind,
    board,
    installationId: owner.installationId,
    sessionId: session.sessionId,
    epoch: session.epoch,
    directory,
    expiresAt: Math.min(Date.now() + 3000, owner.leaseUntil),
  };
  storage.write(file, JSON.stringify(record));
  if (!alive(file, id)) throw new Error('a newer generation already exists');
  return { file, id, record, session, board };
}
function state(file = process.env.LH_HELPER_LEASE, id = process.env.LH_HELPER_ID) {
  if (!file) return 'active';
  const key = file + '|' + id;
  const saved = lastGood.get(key);
  const read = (load, fallback) => {
    try {
      return load();
    } catch (error) {
      if (fallback && (error instanceof SyntaxError || ['EPERM', 'EACCES', 'EBUSY'].includes(error.code)))
        return fallback;
      throw error;
    }
  };
  try {
    const record = read(() => JSON.parse(fs.readFileSync(file, 'utf8')), saved?.record);
    const active = read(() => JSON.parse(fs.readFileSync(record.registry, 'utf8')), saved?.active);
    const names = read(() => fs.readdirSync(record.directory), saved?.names);
    if (record.version !== 1 || record.id !== id || !(record.expiresAt > Date.now()))
      throw new Error('authority unconfirmed');
    if (
      record.generation !== active.generation ||
      active.id !== id ||
      record.sessionId !== active.sessionId ||
      record.epoch !== active.epoch ||
      record.installationId !== active.installationId ||
      names.some(name => /^[0-9]+\.generation\.json$/.test(name) && Number(name.split('.')[0]) > record.epoch)
    ) {
      lastGood.delete(key);
      return 'retired';
    }
    lastGood.set(key, { record, active, names });
    return 'active';
  } catch {
    lastGood.delete(key);
    return 'unconfirmed';
  }
}
function alive(file = process.env.LH_HELPER_LEASE, id = process.env.LH_HELPER_ID) {
  return state(file, id) === 'active';
}
function refresh(helper, status) {
  const owner = verify(status, helper.session, helper.board);
  if (!alive(helper.file, helper.id)) throw new Error('helper generation retired');
  const record = { ...helper.record, expiresAt: Math.min(Date.now() + 3000, owner.leaseUntil) };
  storage.write(helper.file, JSON.stringify(record));
  helper.record = record;
}
function retire(helper) {
  lastGood.delete(helper.file + '|' + helper.id);
  fs.rmSync(helper.file, { force: true });
}
function references(home, board) {
  const directory = path.join(home, 'helper-generations', storage.hash(board));
  try {
    return fs
      .readdirSync(directory)
      .filter(name => name.endsWith('.active.json'))
      .flatMap(name => {
        const active = JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8'));
        if (!alive(path.join(directory, active.id + '.json'), active.id)) return [];
        return [{ id: active.id, kind: active.kind, originSessionId: active.sessionId, originEpoch: active.epoch }];
      });
  } catch {
    return [];
  }
}
module.exports = { create, refresh, retire, alive, state, verify, references };
