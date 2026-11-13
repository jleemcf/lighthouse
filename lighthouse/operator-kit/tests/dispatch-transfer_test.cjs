'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { protect } = require('../../server/registry-files');
const storage = require('../scripts/dispatch-storage.cjs');
const transfer = require('../scripts/dispatch-transfer.cjs');

function home(context) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-transfer-'));
  protect(dir, true);
  context.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
const binding = { id: 'firstmate', installationId: 'original-installation', freshness: 'fresh' };
function outgoing(context, gap = false) {
  const dir = home(context);
  const relay = {
    id: 'relay-result-original',
    state: 'outcome-unknown',
    intent: { ticket: 'original-ticket', to: 'firstmate', hash: 'instruction-hash' },
    evidenceCapability: 'private-ticket-evidence',
    originSessionId: 'session-original',
    originEpoch: 1,
  };
  const call = {
    id: crypto.randomUUID(),
    tool: 'board_shift',
    args: { action: 'end' },
    originSessionId: 'session-original',
    originEpoch: 1,
  };
  fs.writeFileSync(path.join(dir, 'relay-results.jsonl'), JSON.stringify(relay) + '\n', { mode: 0o600 });
  fs.writeFileSync(path.join(dir, 'calls-outbox.jsonl'), JSON.stringify(call) + '\n', { mode: 0o600 });
  if (gap) {
    storage.inventory(dir, 'test-board');
    fs.unlinkSync(path.join(dir, 'calls-outbox.jsonl'));
  }
  const destination = path.join(dir, 'evidence.encrypted');
  const keyFile = path.join(dir, 'evidence.key');
  transfer.exportEvidence({ home: dir, board: 'test-board', destination, keyFile, targetBinding: binding });
  return { dir, relay, call, source: destination, keyFile };
}

test('encrypted cross-home evidence preserves ids, hashes and origin; imported queue requires review', context => {
  const source = outgoing(context);
  const next = home(context);
  const envelope = fs.readFileSync(source.source, 'utf8');
  assert.ok(!envelope.includes(source.relay.evidenceCapability));
  assert.ok(!envelope.includes(source.call.id));
  const input = {
    home: next,
    board: 'test-board',
    source: source.source,
    keyFile: source.keyFile,
    targetBinding: binding,
  };
  const imported = transfer.importEvidence(input);
  assert.equal(imported.complete, true);
  assert.equal(storage.inventory(next, 'test-board').complete, true);
  assert.deepEqual(storage.lines(next, 'relay-results.jsonl'), [source.relay]);
  assert.deepEqual(storage.lines(next, 'calls-imported.jsonl'), [source.call]);
  assert.ok(!fs.existsSync(path.join(next, 'calls-outbox.jsonl')));
  assert.equal(transfer.importEvidence(input).duplicate, true);
});

test('planned move from a home with no queued calls remains a complete inventory', context => {
  const dir = home(context);
  fs.writeFileSync(
    path.join(dir, 'relay-results.jsonl'),
    JSON.stringify({ id: 'relay-result-delivered', state: 'recorded' }) + '\n',
    { mode: 0o600 },
  );
  const destination = path.join(dir, 'complete.encrypted');
  const keyFile = path.join(dir, 'complete.key');
  assert.equal(
    transfer.exportEvidence({ home: dir, board: 'test-board', destination, keyFile, targetBinding: binding }).complete,
    true,
  );
  const next = home(context);
  assert.equal(
    transfer.importEvidence({ home: next, board: 'test-board', source: destination, keyFile, targetBinding: binding })
      .complete,
    true,
  );
  assert.equal(storage.inventory(next, 'test-board').complete, true);
});

test('missing export files remain an import gap even with an empty successor queue', context => {
  const source = outgoing(context, true);
  const next = home(context);
  const result = transfer.importEvidence({
    home: next,
    board: 'test-board',
    source: source.source,
    keyFile: source.keyFile,
    targetBinding: binding,
  });
  assert.equal(result.complete, false);
  fs.writeFileSync(path.join(next, 'calls-outbox.jsonl'), '');
  assert.equal(storage.inventory(next, 'test-board').complete, false);
  assert.ok(storage.inventory(next, 'test-board').gaps.some(gap => gap.includes('calls-outbox')));
});

test('tampering and wrong board or original target fail before importing evidence', context => {
  const source = outgoing(context);
  const next = home(context);
  const input = {
    home: next,
    board: 'wrong-board',
    source: source.source,
    keyFile: source.keyFile,
    targetBinding: binding,
  };
  assert.throws(() => transfer.importEvidence(input), /mismatch/);
  assert.throws(
    () =>
      transfer.importEvidence({
        ...input,
        board: 'test-board',
        targetBinding: { ...binding, installationId: 'different-target' },
      }),
    /mismatch/,
  );
  const envelope = JSON.parse(fs.readFileSync(source.source));
  envelope.ciphertext = Buffer.from('tampered').toString('base64');
  fs.writeFileSync(source.source, JSON.stringify(envelope));
  assert.throws(() => transfer.importEvidence({ ...input, board: 'test-board' }));
  assert.ok(!fs.existsSync(path.join(next, 'relay-results.jsonl')));
});

test('legacy migration preserves unknown state without rewriting the journal', context => {
  const dir = home(context);
  const original = JSON.stringify({ id: 'legacy-receipt', args: { ticket: 'legacy-ticket', delivered: true } }) + '\n';
  fs.writeFileSync(path.join(dir, 'relay-results.jsonl'), original);
  fs.writeFileSync(path.join(dir, 'calls-outbox.jsonl'), '');
  const value = storage.inventory(dir, 'test-board');
  assert.equal(value.relays[0].state, 'unknown');
  assert.equal(value.relays[0].ticket, 'legacy-ticket');
  assert.equal(fs.readFileSync(path.join(dir, 'relay-results.jsonl'), 'utf8'), original);
});
