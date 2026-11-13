'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const canonical = value =>
  Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === 'object'
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map(key => [key, canonical(value[key])]),
        )
      : value;
const hash = value =>
  crypto
    .createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex');
const callHash = call => hash({ tool: call.tool, args: call.args || {} });
function write(file, value) {
  const temporary = file + '.' + crypto.randomUUID() + '.tmp';
  const fd = fs.openSync(temporary, 'wx', 0o600);
  try {
    fs.writeFileSync(fd, value);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  try {
    fs.renameSync(temporary, file);
  } catch (error) {
    try {
      fs.rmSync(temporary, { force: true });
    } catch {}
    throw error;
  }
  if (process.platform !== 'win32') {
    const directory = fs.openSync(path.dirname(file), 'r');
    try {
      fs.fsyncSync(directory);
    } finally {
      fs.closeSync(directory);
    }
  }
}
function lines(home, name) {
  const file = path.join(home, name);
  let stat;
  try {
    stat = fs.lstatSync(file);
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('journal must be a regular file');
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(JSON.parse);
}
function state(home, board) {
  const file = path.join(home, 'dispatch-journal.json');
  if (fs.existsSync(file)) {
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (saved.version !== 1 || saved.board !== board || !/^[A-Za-z0-9_-]{8,100}$/.test(saved.journalId || ''))
      throw new Error('dispatch journal version or board mismatch; reconnect and repair before dispatch');
    return saved;
  }
  const saved = { version: 1, board, journalId: crypto.randomUUID(), imported: [], gaps: [] };
  // Exclusive creation makes concurrent tool processes agree on one local journal identity.
  const fd = fs.openSync(file, 'wx', 0o600);
  try {
    fs.writeFileSync(fd, JSON.stringify(saved));
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  return saved;
}
function inventory(home, board) {
  const saved = state(home, board);
  const gaps = [...saved.gaps];
  const read = name => {
    try {
      const exists = fs.existsSync(path.join(home, name));
      if (!exists && saved.observedFiles?.includes(name)) throw new Error('previous journal is missing');
      const items = lines(home, name);
      if (exists && !saved.observedFiles?.includes(name)) {
        saved.observedFiles = [...(saved.observedFiles || []), name];
        write(path.join(home, 'dispatch-journal.json'), JSON.stringify(saved));
      }
      return items;
    } catch {
      gaps.push(name + ':missing-or-unreadable');
      return [];
    }
  };
  const queued = read('calls-outbox.jsonl');
  const relays = read('relay-results.jsonl');
  const dead = read('calls-undelivered.jsonl');
  const imported = read('calls-imported.jsonl');
  const calls = [...queued, ...imported, ...dead.map(item => ({ ...item, disposition: 'rejected' }))].map(item => ({
    ...item,
    hash: callHash(item),
  }));
  return {
    journalId: saved.journalId,
    complete: gaps.length === 0,
    gaps,
    calls,
    relays: relays
      .filter(item => item.state !== 'recorded')
      .map(item => ({
        id: item.id,
        state: item.state || 'unknown',
        intentId: item.intent?.id || null,
        ticket: item.intent?.ticket || item.args?.ticket || null,
        hash: item.intent?.hash || null,
        target: item.intent?.to || null,
        originSessionId: item.originSessionId || null,
        originEpoch: item.originEpoch ?? null,
      })),
  };
}
function pruneCalls(home, calls) {
  const terminal = new Map(
    calls
      .filter(call => ['acknowledged', 'rejected', 'superseded'].includes(call.disposition))
      .map(call => [call.id, call.hash]),
  );
  if (!terminal.size) return;
  for (const name of ['calls-outbox.jsonl', 'calls-imported.jsonl']) {
    let items;
    try {
      items = lines(home, name);
    } catch {
      continue;
    }
    const retained = items.filter(item => terminal.get(item.id) !== callHash(item));
    if (items.length !== retained.length)
      write(path.join(home, name), retained.map(item => JSON.stringify(item)).join('\n') + '\n');
  }
}
module.exports = { canonical, hash, callHash, write, lines, state, inventory, pruneCalls };
