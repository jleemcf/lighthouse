'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const binding = require('../scripts/target-binding.cjs');
const dispatch = require('../scripts/dispatch-client.cjs');
const runner = require('../scripts/helper-runner.cjs');

test('recovery verifies original route bytes before consuming any external permission', async context => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'bound-route-'));
  context.after(() => fs.rmSync(home, { recursive: true, force: true }));
  fs.writeFileSync(path.join(home, 'relay.sh'), 'original route\r\n');
  fs.writeFileSync(path.join(home, 'fmwatch.cjs'), 'original read-only target\n');
  let targetBinding = { routeHash: binding.routeHash(home) };
  fs.writeFileSync(path.join(home, 'relay.sh'), 'original route\n');
  assert.doesNotThrow(() => binding.verify(home, targetBinding));
  let consumed = 0;
  let recoveryEnabled = true;
  const client = dispatch.client({
    home,
    board: 'board-test',
    session: { sessionId: 'session-test' },
    updateRelay: async () => {},
    request: async (method, endpoint, body) => {
      if (method === 'GET') return { status: 200, body: { enabled: true, recoveryEnabled, targetBinding } };
      consumed++;
      return { status: 200, body: { ok: true, dispatch: true, ...body } };
    },
  });
  await client.status();
  const ticket = { ledgerVersion: 1, intentId: 'intent-test', attemptId: 'attempt-test', permissionId: 'grant-test' };
  assert.equal(await client.consume(ticket, 'relay-test'), true);
  fs.writeFileSync(path.join(home, 'relay.sh'), 'substituted local worker\n');
  await assert.rejects(client.consume(ticket, 'relay-test'), /original firstmate route/);
  assert.equal(consumed, 1);
  const originalBinding = targetBinding;
  targetBinding = undefined;
  await client.status();
  await assert.rejects(client.consume(ticket, 'relay-test'), /original firstmate route/);
  assert.equal(consumed, 1);
  targetBinding = originalBinding;
  fs.writeFileSync(path.join(home, 'relay.sh'), 'original route\n');
  fs.writeFileSync(path.join(home, 'fmwatch.cjs'), 'substituted local transcript\n');
  await assert.rejects(
    runner.supervise({
      home,
      board: 'board-test',
      kind: 'fmwatch',
      request: async () => ({
        targetAvailability: 'same-machine',
        targetBinding,
      }),
    }),
    /original firstmate route/,
  );
  recoveryEnabled = false;
  await client.status();
  fs.rmSync(path.join(home, 'relay.sh'));
  assert.equal(await client.consume(ticket, 'relay-test'), true);
  assert.equal(consumed, 2);
});
