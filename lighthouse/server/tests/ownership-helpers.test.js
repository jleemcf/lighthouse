'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ownershipFixture } = require('./ownership-fixture');

test('ownership boundary rejects anonymous uploads before reading their body', async () => {
  let read = false;
  const boundary = require('../mutation-routes')({
    send: (_response, status) => status,
    readRaw: () => {
      read = true;
    },
  });
  const status = await boundary.route({ method: 'POST' }, {}, { p: '/api/attachments', who: null }, []);
  assert.equal(status, 403);
  assert.equal(read, false);
});

test('ownership controls cannot cancel an already acquired nomination', context => {
  const { ctx, register, acquire, control } = ownershipFixture(context);
  acquire(register('session-first'));
  const owner = ctx.ownership.record('tools');
  assert.throws(
    () =>
      control({
        action: 'cancel',
        expectedEpoch: owner.epoch,
        nominationId: owner.successor.id,
      }),
    /nomination changed/,
  );
  assert.equal(ctx.ownership.record('tools').successor.status, 'acquired');
});

test('ownership cancel with no nomination is a conflict, not a poisoned writer', context => {
  const { ctx, control } = ownershipFixture(context);
  assert.throws(() => control({ action: 'cancel', expectedEpoch: 0 }), { status: 409 });
  assert.equal(ctx.ownership.record('tools').epoch, 0);
  assert.doesNotThrow(() => ctx.saveNow());
});

test('ownership helpers: exported call and authority helpers cannot bypass the commit boundary', context => {
  const { ctx, register, acquire, activate } = ownershipFixture(context);
  const first = register('session-first');
  acquire(first);
  activate(first);
  const second = register('session-second');
  acquire(second);
  const engine = {
    cfg: ctx.cfg,
    T: {},
    ctx: {
      ownership: ctx.ownership,
      inTransaction: ctx.inTransaction,
      transact: ctx.transact,
      authorizeCall: (board, who, payload) =>
        ctx.mutations.authorize({ p: '/api/boards/' + board + '/calls', who, payload }, {}, [board]),
    },
  };
  const requests = require('../toolcalls-request')(engine);
  const authorities = require('../toolcalls-authority')(engine);
  const before = structuredClone(ctx.store);
  for (const who of [
    null,
    { name: 'operator', source: 'token', via: 'api' },
    { ...second, epoch: 1 },
    { ...first, epoch: 2 },
    { ...second, sessionScope: 'collector' },
  ]) {
    assert.throws(() => requests.handleCalls('tools', who, { calls: [{ tool: 'board_post', args: {} }] }));
    assert.throws(() => authorities.createAuthority('tools', who, {}), /captain/);
    assert.throws(() => authorities.yoloSwitch('tools', who, {}, 'on'), /captain/);
    assert.deepEqual(ctx.store, before);
  }
});

test('ownership controls: missing, legacy, wrong scope and stale attachments cannot write', context => {
  const { ctx, register, acquire, activate, control } = ownershipFixture(context);
  const holder = register('session-first');
  acquire(holder);
  activate(holder);
  for (const who of [
    null,
    { name: 'operator', via: 'api', source: 'token' },
    { ...holder, sessionScope: 'collector' },
    { ...holder, epoch: 0 },
  ]) {
    for (const action of ['attach', 'detach'])
      assert.throws(() => control({ action, processId: 'process-forbidden' }, who));
    for (const action of ['register', 'nominate', 'cancel', 'activate'])
      assert.throws(() => control({ action }, who), /captain/);
  }
  const collector = register(holder.sessionId, 'collector');
  assert.throws(() => control({ action: 'acquire', expectedEpoch: 1 }, collector), /credential/);
  ctx.cfg.boards.tools.access.operator = 'watch';
  assert.throws(() => ctx.ownership.acting(holder, 'tools', 1), /membership revoked/);
});
