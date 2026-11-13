'use strict';
const fs = require('node:fs');
const path = require('node:path');
const storage = require('./dispatch-storage.cjs');
const files = board => ({
  boardwatch: 'boardwatch-' + board + '.json',
  fmwatch: 'watch-cursor-fmwatch.json',
  collector: 'collector-cursor.json',
});
const read = file => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
};
const strings = value => (Array.isArray(value) ? value.filter(item => typeof item === 'string') : []);
function snapshot(home, board) {
  const cursors = {};
  for (const [kind, name] of Object.entries(files(board))) {
    const value = read(path.join(home, name));
    if (!value) {
      cursors[kind] = null;
      continue;
    }
    if (kind === 'boardwatch') cursors[kind] = { seq: value.seq || 0, said: strings(value.said) };
    if (kind === 'collector') cursors[kind] = { seen: strings(value.seen), hwm: value.hwm || '' };
    if (kind === 'fmwatch') cursors[kind] = { started: value.started, order: strings(value.order) };
  }
  return cursors;
}
function restore(home, board, imported) {
  if (!imported || typeof imported !== 'object') throw new Error('authenticated cursor inventory required');
  const union = (left, right) => [...new Set([...strings(left), ...strings(right)])];
  for (const [kind, name] of Object.entries(files(board))) {
    const value = imported[kind];
    if (!value) continue;
    const file = path.join(home, name);
    const local = read(file) || {};
    let next;
    if (kind === 'boardwatch')
      next = { ...local, seq: Math.max(local.seq || 0, value.seq || 0), said: union(local.said, value.said) };
    if (kind === 'collector') {
      const hwm = [local.hwm || '', value.hwm || ''].sort().at(-1);
      next = { ...local, offsets: local.offsets || {}, seen: union(local.seen, value.seen), hwm, recoveryFloor: hwm };
    }
    if (kind === 'fmwatch')
      next = {
        ...local,
        started: local.started || value.started,
        order: union(local.order, value.order),
        offsets: local.offsets || [],
        lastLine: local.lastLine || [],
        models: local.models || [],
        waiting: local.waiting || null,
      };
    delete next.lockPid;
    delete next.pid;
    delete next.scope;
    storage.write(file, JSON.stringify(next));
  }
}
function scope() {
  if (!process.env.LH_HELPER_LEASE) return undefined;
  if (!require('./helper-generation.cjs').alive()) throw new Error('helper generation retired');
  const record = read(process.env.LH_HELPER_LEASE);
  return {
    installationId: record.installationId,
    sessionId: record.sessionId,
    epoch: record.epoch,
    helperId: record.id,
    board: record.board,
  };
}
function references(home, board) {
  return Object.entries(snapshot(home, board)).map(([kind, value]) => ({
    id: kind + '-cursor',
    kind,
    state: value ? 'saved' : 'missing',
    ...(value ? { hash: storage.hash(value) } : {}),
  }));
}
module.exports = { snapshot, restore, scope, references };
