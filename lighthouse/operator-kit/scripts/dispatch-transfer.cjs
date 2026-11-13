'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const storage = require('./dispatch-storage.cjs');
const names = ['relay-results.jsonl', 'calls-outbox.jsonl', 'calls-undelivered.jsonl', 'calls-imported.jsonl'];
function privateKey(file) {
  if (!require('./setup-runtime.cjs').privateStorage(path.dirname(file), file))
    throw new Error('transfer key file and directory must be private');
  const key = fs.readFileSync(file);
  if (key.length !== 32) throw new Error('invalid evidence transfer key');
  return key;
}
function exportEvidence({ home, board, destination, keyFile, targetBinding, includeCursors = false }) {
  if (!require('./setup-runtime.cjs').privateStorage(home, home))
    throw new Error('source evidence home must be private');
  if (fs.existsSync(destination) || fs.existsSync(keyFile)) throw new Error('export paths must be new files');
  const inventory = storage.inventory(home, board);
  const cursors = includeCursors ? require('./helper-cursors.cjs').snapshot(home, board) : null;
  const cursorGaps = cursors
    ? Object.entries(cursors)
        .filter(([, value]) => !value)
        .map(([kind]) => 'cursor-missing:' + kind)
    : [];
  const files = {};
  for (const name of names) {
    try {
      files[name] = storage.lines(home, name);
    } catch {
      files[name] = null;
    }
  }
  const payload = {
    version: 1,
    id: crypto.randomUUID(),
    board,
    targetBinding,
    journalId: inventory.journalId,
    gaps: [...inventory.gaps, ...cursorGaps],
    files,
    ...(includeCursors ? { cursors } : {}),
    at: Date.now(),
  };
  const key = crypto.randomBytes(32);
  fs.writeFileSync(keyFile, key, { flag: 'wx', mode: 0o600 });
  try {
    privateKey(keyFile);
    const nonce = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);
    cipher.setAAD(Buffer.from('lighthouse-dispatch-evidence-v1'));
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
    fs.writeFileSync(
      destination,
      JSON.stringify({
        version: 1,
        nonce: nonce.toString('base64'),
        tag: cipher.getAuthTag().toString('base64'),
        ciphertext: encrypted.toString('base64'),
      }),
      { flag: 'wx', mode: 0o600 },
    );
  } catch (error) {
    fs.rmSync(keyFile, { force: true });
    throw error;
  } finally {
    key.fill(0);
  }
  return {
    path: destination,
    keyFile,
    complete: inventory.complete && !cursorGaps.length,
    journalId: inventory.journalId,
  };
}
function importEvidence({ home, board, source, keyFile, targetBinding }) {
  if (!require('./setup-runtime.cjs').privateStorage(home, home))
    throw new Error('destination evidence home must be private');
  const envelope = JSON.parse(fs.readFileSync(source, 'utf8'));
  if (envelope.version !== 1) throw new Error('unsupported evidence envelope');
  const key = privateKey(keyFile);
  let payload;
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.nonce, 'base64'));
    decipher.setAAD(Buffer.from('lighthouse-dispatch-evidence-v1'));
    decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
    payload = JSON.parse(
      Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, 'base64')), decipher.final()]).toString('utf8'),
    );
  } finally {
    key.fill(0);
  }
  if (
    payload.version !== 1 ||
    payload.board !== board ||
    storage.hash(payload.targetBinding) !== storage.hash(targetBinding) ||
    !Array.isArray(payload.gaps)
  )
    throw new Error('evidence board or original target binding mismatch');
  const saved = storage.state(home, board);
  if (saved.imported.includes(payload.id)) return { duplicate: true, gaps: saved.gaps };
  const gaps = [...payload.gaps];
  for (const name of names) if (!Array.isArray(payload.files?.[name])) gaps.push('import:' + name);
  const entries = (name, localName = name) => {
    let local = [];
    try {
      local = storage.lines(home, localName);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    for (const item of payload.files[name] || []) {
      if (!item || typeof item.id !== 'string') throw new Error('invalid imported evidence identity');
      const prior = local.find(value => value.id === item.id);
      if (prior && storage.hash(prior) !== storage.hash(item))
        throw new Error('conflicting local and imported evidence; preserve both for owner review');
      if (!prior) local.push(item);
    }
    return [localName, local];
  };
  const relays = entries('relay-results.jsonl');
  // Imported commands are inventory only. They never enter the automatic outbox drain.
  const calls = entries('calls-outbox.jsonl', 'calls-imported.jsonl');
  for (const item of payload.files['calls-imported.jsonl'] || []) {
    const prior = calls[1].find(value => value.id === item.id);
    if (prior && storage.hash(prior) !== storage.hash(item)) throw new Error('conflicting imported call');
    if (!prior) calls[1].push(item);
  }
  const rejected = entries('calls-undelivered.jsonl');
  const directory = path.join(home, 'dispatch-imports');
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const progress = 'import-in-progress:' + payload.id;
  saved.gaps = [...new Set(saved.gaps.concat(gaps, progress))];
  storage.write(path.join(home, 'dispatch-journal.json'), JSON.stringify(saved));
  storage.write(path.join(directory, storage.hash(payload.id) + '.json'), JSON.stringify(payload));
  for (const [name, items] of [relays, calls, rejected])
    storage.write(path.join(home, name), items.map(item => JSON.stringify(item)).join('\n') + '\n');
  if (payload.cursors) require('./helper-cursors.cjs').restore(home, board, payload.cursors);
  saved.imported.push(payload.id);
  saved.gaps = [...new Set(saved.gaps.concat(gaps))].filter(gap => gap !== progress);
  storage.write(path.join(home, 'dispatch-journal.json'), JSON.stringify(saved));
  return { imported: payload.id, gaps: saved.gaps, complete: saved.gaps.length === 0 };
}
module.exports = { exportEvidence, importEvidence };
