'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { ownershipFixture } = require('./ownership-fixture');

test('ownership: CAS chooses one acceptor, retries durably, and never resets a shift', context => {
  const fixture = ownershipFixture(context);
  const { ctx, register, acquire, nominate, control, activate } = fixture;
  ctx.store.boards.tools.shift = { state: 'on', since: new Date().toISOString(), lastSeen: 'original' };
  const first = register('session-first');
  const originalSince = ctx.store.boards.tools.shift.since;
  acquire(first);
  assert.equal(ctx.store.boards.tools.shift.since, originalSince);
  activate(first);
  const shift = structuredClone(ctx.store.boards.tools.shift);
  const second = register('session-second');
  const nominationId = nominate(second.sessionId);
  const body = { action: 'acquire', expectedEpoch: 1, nominationId, operationId: 'winner-operation' };
  assert.equal(control(body, second).ownership.epoch, 2);
  assert.throws(() => control({ ...body, operationId: 'loser-operation' }, second), /epoch changed/);
  assert.equal(control(body, second).duplicate, true);
  assert.deepEqual(ctx.store.boards.tools.shift, shift);
  const disk = JSON.parse(fs.readFileSync(ctx.STORE));
  assert.equal(disk.sessionOwnership.boards.tools.epoch, 2);
  assert.equal(disk.sessionOwnership.operations['tools|winner-operation'].result.ownership.epoch, 2);
  assert.ok(disk.sessionOwnership.audit.some(entry => entry.operationId === 'winner-operation'));
  assert.throws(() => ctx.ownership.acting(first, 'tools', 1), /epoch/);
  assert.throws(() => ctx.ownership.acting(first, 'tools', 2), /relieved/);
  assert.throws(() => ctx.ownership.renew(first, 'tools', 2), /relieved/);
  assert.throws(() => control({ ...body, operationId: 'promote-self' }, first), /epoch changed/);
});

test('ownership: expired, cancelled and superseded nominations never acquire', context => {
  const { ctx, register, nominate, control } = ownershipFixture(context);
  const successor = register('session-second');
  let nominationId = nominate(successor.sessionId);
  ctx.ownership.record('tools').successor.expiresAt = Date.now() - 1;
  assert.throws(() => control({ action: 'acquire', expectedEpoch: 0, nominationId }, successor), /expired/);
  nominationId = nominate(successor.sessionId);
  control({ action: 'cancel', nominationId, expectedEpoch: 0 });
  assert.throws(() => control({ action: 'acquire', expectedEpoch: 0, nominationId }, successor), /cancelled/);
  nominationId = nominate(successor.sessionId);
  nominate(successor.sessionId);
  assert.throws(() => control({ action: 'acquire', expectedEpoch: 0, nominationId }, successor), /superseded/);
  assert.throws(
    () =>
      control({
        action: 'nominate',
        expectedEpoch: 0,
        sessionId: successor.sessionId,
        nominationId,
        expiresAt: Date.now() + 60000,
      }),
    /identity already used/,
  );
  assert.equal(ctx.ownership.record('tools').epoch, 0);
});

test('ownership: commit rechecks the lease after arrival, rollback exposes no partial write or effect', context => {
  const { ctx, register, acquire, activate } = ownershipFixture(context);
  const first = register('session-first');
  acquire(first);
  activate(first);
  const original = ctx.store.boards.tools.name;
  let sent = false;
  const authorize = () => ctx.ownership.acting(first, 'tools', 1);
  assert.throws(
    () =>
      ctx.transact(authorize, () => {
        ctx.store.boards.tools.name = 'not committed';
        ctx.afterCommit(() => {
          sent = true;
        });
        ctx.ownership.record('tools').leaseUntil = Date.now() - 1;
      }),
    /lease expired/,
  );
  assert.equal(ctx.store.boards.tools.name, original);
  assert.equal(sent, false);
  assert.doesNotThrow(authorize);
});

test('ownership: expiry removes acting rights but preserves shift; each loss needs captain approval', context => {
  const { ctx, register, acquire, activate, control } = ownershipFixture(context);
  const first = register('session-first');
  acquire(first);
  activate(first);
  ctx.store.boards.tools.shift.state = 'on';
  const shift = structuredClone(ctx.store.boards.tools.shift);
  ctx.ownership.record('tools').leaseUntil = Date.now() - 1;
  assert.throws(() => ctx.ownership.acting(first, 'tools', 1), /lease expired/);
  assert.throws(() => control({ action: 'nominate', expectedEpoch: 1 }, first), /captain/);
  assert.deepEqual(ctx.store.boards.tools.shift, shift);
  assert.equal(ctx.ownership.record('tools').holderSessionId, first.sessionId);
});

test('ownership: readiness is explicit, per board, irreversible and rejects legacy or unlisted writers', context => {
  const { ctx, register, acquire, control } = ownershipFixture(context);
  const first = register('session-first');
  acquire(first);
  control({ action: 'attach', processId: 'process-first', protocol: 'session-epochs-v1' }, first);
  control({ action: 'attach', processId: 'process-other', protocol: 'legacy' }, first);
  const activate = { action: 'activate', confirmAllWriters: true, processIds: ['process-first', 'process-other'] };
  assert.throws(() => control(activate), /readiness/);
  control({ action: 'detach', processId: 'process-other' }, first);
  assert.throws(() => control(activate), /readiness/);
  control({ ...activate, processIds: ['process-first'] });
  assert.equal(ctx.ownership.enabled('tools'), true);
  assert.equal(ctx.ownership.enabled('lines'), false);
  assert.throws(() => control(activate), /cannot be disabled/);
  assert.throws(() => control({ action: 'register' }, undefined, 'lines'), /tools-only/);
});

test('ownership: a planned nomination cannot recover a later loss without fresh captain approval', context => {
  const { ctx, register, acquire, nominate, control, activate } = ownershipFixture(context);
  const holder = register('session-first');
  acquire(holder);
  activate(holder);
  const successor = register('session-second');
  const lease = ctx.ownership.record('tools').leaseUntil;
  const clock = Date.now;
  let time = lease - 1000;
  Date.now = () => time;
  try {
    const nominationId = nominate(successor.sessionId);
    const body = { action: 'acquire', expectedEpoch: 1, nominationId };
    time = lease + 1;
    assert.throws(() => control(body, successor), /approval after this session loss/);
    assert.equal(ctx.ownership.record('tools').epoch, 1);
    const recoveryId = nominate(successor.sessionId);
    assert.equal(control({ ...body, nominationId: recoveryId }, successor).ownership.epoch, 2);
  } finally {
    Date.now = clock;
  }
});

test('ownership: acquisition rechecks nomination expiry at the durable commit boundary', context => {
  const { ctx, register, nominate, control } = ownershipFixture(context);
  const successor = register('session-second');
  const nominationId = nominate(successor.sessionId);
  const deadline = ctx.ownership.record('tools').successor.expiresAt;
  const beforeCommit = ctx.beforeCommit;
  const clock = Date.now;
  let time = deadline - 1;
  Date.now = () => time;
  ctx.beforeCommit = guard =>
    beforeCommit(() => {
      time = deadline;
      guard();
    });
  try {
    assert.throws(
      () => control({ action: 'acquire', expectedEpoch: 0, nominationId }, successor),
      /expired before acquisition committed/,
    );
    assert.equal(ctx.ownership.record('tools').epoch, 0);
  } finally {
    Date.now = clock;
    ctx.beforeCommit = beforeCommit;
  }
});

test('ownership: ticket-bound late evidence outlives relief and does not restore acting rights', context => {
  const { ctx, register, acquire, activate } = ownershipFixture(context);
  const first = register('session-first');
  acquire(first);
  activate(first);
  const ticket = { id: 'ticket-first', board: 'tools', by: 'operator' };
  ctx.store.tickets = { [ticket.id]: ticket };
  const capability = ctx.ownership.ticket(first, 'tools', 1, ticket);
  const second = register('session-second');
  acquire(second);
  assert.doesNotThrow(() => ctx.ownership.evidence(first, 'tools', 1, ticket.id, capability));
  assert.throws(() => ctx.ownership.evidence(second, 'tools', 1, ticket.id, capability), /capability/);
  assert.throws(() => ctx.ownership.evidence(first, 'tools', 1, ticket.id, 'incorrect'), /capability/);
  assert.throws(() => ctx.ownership.acting(first, 'tools', 1), /epoch/);
});

test('ownership: renewal cannot launder a lease that expired before commit', context => {
  const { ctx, register, acquire, activate } = ownershipFixture(context);
  const holder = register('session-first');
  acquire(holder);
  const processId = activate(holder);
  const lease = ctx.ownership.record('tools').leaseUntil;
  const clock = Date.now;
  let time = lease - 1;
  Date.now = () => time;
  try {
    assert.throws(
      () =>
        ctx.transact(
          () => ctx.ownership.acting(holder, 'tools', 1),
          () => {
            ctx.ownership.renew(holder, 'tools', 1, processId);
            time = lease + 1;
          },
        ),
      /expired before renewal committed/,
    );
    assert.equal(ctx.ownership.record('tools').leaseUntil, lease);
  } finally {
    Date.now = clock;
  }
});

test('ownership: relieved processes cannot attach, detach or administer; readiness waits for old tickets', context => {
  const { ctx, register, acquire, activate, control } = ownershipFixture(context);
  const first = register('session-first');
  acquire(first);
  const processId = 'process-current';
  control({ action: 'attach', processId, protocol: 'session-epochs-v1' }, first);
  ctx.store.tickets = { old: { board: 'tools' } };
  const ready = { action: 'activate', confirmAllWriters: true, processIds: [processId] };
  assert.throws(() => control(ready), /settle legacy/);
  ctx.store.tickets.old.used = true;
  control(ready);
  const second = register('session-second');
  acquire(second);
  first.epoch = 2;
  for (const action of ['attach', 'detach'])
    assert.throws(() => control({ action, processId, protocol: 'session-epochs-v1' }, first), /relieved/);
  for (const action of ['register', 'nominate', 'cancel', 'activate'])
    assert.throws(() => control({ action }, first), /captain/);
});
