'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { dispatchFixture } = require('./dispatch-fixture');

for (const stage of ['written', 'flushed', 'renamed', 'committed']) {
  test('consume process crash at ' + stage + ' recovers whole permission, operation and audit', context => {
    const f = dispatchFixture(context);
    const ticket = f.issue();
    const credential = crypto.randomBytes(32).toString('base64url');
    f.ctx.ownership.session('tools', f.first.sessionId).credentialHash = f.ctx.ownership.hash(credential);
    f.ctx.saveNow();
    fs.writeFileSync(f.ctx.CONFIG_PATH, JSON.stringify(f.ctx.cfg));
    const body = {
      action: 'consume',
      operationId: crypto.randomUUID(),
      intentId: ticket.intentId,
      attemptId: ticket.attemptId,
      permissionId: ticket.permissionId,
    };
    const requestFile = path.join(f.home, 'consume.json');
    fs.writeFileSync(requestFile, JSON.stringify({ credential, body }), { mode: 0o600 });
    const child = spawnSync(
      process.execPath,
      [path.join(__dirname, 'dispatch-crash-worker.cjs'), f.ctx.CONFIG_PATH, stage, requestFile],
      { env: process.env, encoding: 'utf8' },
    );
    assert.equal(child.status, 19, child.stderr);
    const raw = JSON.parse(fs.readFileSync(f.ctx.STORE));
    const saved = raw.dispatchLedger.boards.tools;
    const committed = ['renamed', 'committed'].includes(stage);
    assert.equal(saved.attempts[ticket.attemptId].state, committed ? 'consumed' : 'issued');
    assert.equal(!!saved.operations[body.operationId], committed);
    assert.equal(
      saved.history.some(item => item.action === 'consume'),
      committed,
    );
    const cold = { cfg: f.ctx.cfg, CONFIG_PATH: f.ctx.CONFIG_PATH };
    Object.assign(cold, require('../store')(cold));
    Object.assign(cold, require('../web')(cold));
    cold.ownership = require('../ownership')(cold);
    cold.handoff = require('../handoff')(cold);
    cold.dispatchLedger = require('../dispatch-ledger')(cold);
    const retry = cold.dispatchLedger.control('tools', f.first, body);
    assert.equal(retry.dispatch, !committed);
    assert.equal(cold.dispatchLedger.control('tools', f.first, body).dispatch, false);
    cold.saveNow();
  });
}

for (const schema of [3, 4]) {
  test('activated schema ' + schema + ' cold-starts without re-setup and preserves ledger or epoch', context => {
    const f = dispatchFixture(context);
    f.ctx.store.schemaVersion = schema;
    f.ctx.saveNow();
    const registry = require('../registry').makeRegistry(f.ctx.cfg, f.ctx.CONFIG_PATH);
    assert.equal(registry.persistent, false);
    assert.equal(registry.board('tools').protocol, 'tools');
    assert.equal(JSON.parse(fs.readFileSync(f.ctx.STORE)).sessionOwnership.boards.tools.epoch, 1);
  });
}
