'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { fixture, grantFor } = require('./registry-fixture');
const { makeRegistry, digest, secret } = require('../registry');
const { makeEnrollment } = require('../enrollment');
const makeWeb = require('../web');

test('enrollment is off for every configuration without the explicit switch', context => {
  const ctx = fixture(context, { cfg: { enrollment: undefined } });
  assert.throws(() => grantFor(ctx), /disabled/);
  assert.throws(() => ctx.enrollment.consume({}), /disabled/);
  assert.equal(makeWeb(ctx).roleOn({ name: 'captain' }, 'alpha'), 4);
});

test('every grant scope field and the installation proof are enforced before consumption', context => {
  const ctx = fixture(context),
    request = grantFor(ctx);
  for (const field of Object.keys(request.scope)) {
    const wrong = { ...request, scope: { ...request.scope, [field]: 'wrong-scope' } };
    assert.throws(() => ctx.enrollment.consume(wrong), /scope/);
  }
  assert.throws(() => ctx.enrollment.consume({ ...request, proof: secret() }), /proof/);
  assert.throws(() => ctx.enrollment.consume({ ...request, scope: { ...request.scope, owner: 'attacker' } }), /scope/);
  assert.equal(Object.keys(ctx.registry.credentials().installations).length, 0);
  const result = ctx.enrollment.consume(request);
  assert.equal(result.boardId, 'alpha');
  assert.equal(ctx.registry.board('alpha').owner, 'captain');
  assert.equal(ctx.registry.board('alpha').members.installer, 'operator');
  assert.ok(!JSON.stringify(ctx.registry.credentials()).includes(request.grant));
  assert.ok(!JSON.stringify(ctx.registry.credentials()).includes(request.proof));
  assert.ok(!JSON.stringify(ctx.registry.credentials()).includes(request.credential));
});

test('a lost reply retries durably with the same operation and installation proof, not a bare id', context => {
  let time = 1000;
  const ctx = fixture(context, { clock: () => time });
  const request = grantFor(ctx, {
    scope: { action: 'create' },
    board: { name: 'New board', access: { captain: 'owner' } },
    ttlSeconds: 1,
  });
  const first = ctx.enrollment.consume(request);
  time = 10000;
  const registry = makeRegistry({ boards: {} }, ctx.configPath);
  const reopened = makeEnrollment(registry, ctx.cfg, { clock: () => time });
  const again = reopened.consume(request);
  assert.equal(again.boardId, first.boardId);
  assert.equal(again.repeated, true);
  assert.equal(Object.keys(registry.metadata().boards).length, 3);
  assert.equal(Object.keys(registry.credentials().installations).length, 1);
  assert.throws(() => reopened.consume({ ...request, operationId: crypto.randomUUID() }), /unavailable/);
  assert.throws(
    () => reopened.consume({ ...request, operationId: crypto.randomUUID(), credential: secret() }),
    /unavailable/,
  );
  assert.throws(() => reopened.consume({ ...request, proof: secret() }), /retry proof/);
  assert.throws(() => reopened.consume({ ...request, credential: secret() }), /retry proof/);
  assert.throws(() => reopened.consume({ operationId: request.operationId }), /invalid/);
});

test('consumed bind grants cannot authorize a fresh credential or operation', context => {
  const ctx = fixture(context);
  const request = grantFor(ctx);
  ctx.enrollment.consume(request);
  assert.throws(() => ctx.enrollment.consume({ ...request, operationId: crypto.randomUUID(), credential: secret() }));
  assert.equal(Object.keys(ctx.registry.credentials().operations).length, 1);
});

test('unconsumed grants expire; bind grants cannot create or transfer ownership', context => {
  let time = 1000;
  const ctx = fixture(context, { clock: () => time });
  const request = grantFor(ctx, { ttlSeconds: 1 });
  time = 2000;
  assert.throws(() => ctx.enrollment.consume(request), /expired/);
  assert.throws(() => grantFor(ctx, { scope: { role: 'owner' } }), /cannot transfer ownership/);
  assert.throws(() => grantFor(ctx, { scope: { boardId: 'missing' } }), /no active board/);
  assert.throws(() => grantFor(ctx, { scope: { boardId: 'hidden' } }), /no active board/);
  assert.throws(() => grantFor(ctx, { ttlSeconds: 901 }), /expiry/);
  assert.throws(() => ctx.enrollment.issue({ name: 'captain' }, {}, () => {}), /host administrator/);
  assert.equal(Object.keys(ctx.registry.metadata().boards).length, 2);
  assert.equal(ctx.registry.board('alpha').owner, 'captain');
});

test('installation administration rejects prototype names without mutating shared prototypes', context => {
  const ctx = fixture(context);
  const before = Object.getOwnPropertyDescriptors(Object.prototype);
  for (const installationId of ['__proto__', 'constructor', 'prototype', '']) {
    for (const action of ['rotate', 'revoke'])
      assert.throws(
        () => ctx.enrollment.installation(ctx.admin, action, { installationId, credential: secret() }),
        /no such installation/,
      );
  }
  assert.deepEqual(Object.getOwnPropertyDescriptors(Object.prototype), before);
});

test('scoped installations rotate and revoke independently; legacy tokens stay valid', context => {
  const ctx = fixture(context),
    first = grantFor(ctx),
    second = grantFor(ctx);
  ctx.enrollment.consume(first);
  ctx.enrollment.consume(second);
  const web = makeWeb(ctx),
    who = ctx.enrollment.authenticate(first.credential);
  assert.equal(web.roleOn(who, 'alpha'), 3);
  assert.equal(web.roleOn(who, 'hidden'), 0);
  assert.equal(who.hostAdmin, undefined);
  assert.equal(web.principalOf({ headers: {}, socket: {} }, { token: first.credential }), null);
  const replacement = secret();
  ctx.enrollment.installation(ctx.admin, 'rotate', { installationId: first.installationId, credential: replacement });
  assert.equal(ctx.enrollment.authenticate(first.credential), null);
  assert.ok(ctx.enrollment.authenticate(replacement));
  ctx.enrollment.installation(ctx.admin, 'revoke', { installationId: first.installationId });
  assert.equal(ctx.enrollment.authenticate(replacement), null);
  assert.ok(ctx.enrollment.authenticate(second.credential));
  assert.throws(() => ctx.enrollment.consume(first), /retry proof/);
  assert.ok(web.principalOf({ headers: { authorization: 'Bearer fixtureLegacy' }, socket: {} }, {}));
  assert.equal(ctx.registry.credentials().grants[digest(first.grant)].consumed, first.operationId);
});
