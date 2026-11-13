'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { httpFixture } = require('./registry-http-fixture.cjs');
const { fixture, grantFor } = require('./registry-fixture');
const { makeManagement } = require('../registry-management');
const { digest } = require('../registry');

async function browserHeaders(ctx) {
  const response = await fetch(ctx.endpoint + '/api/registry/session', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + ctx.adminFile.credential, Origin: ctx.endpoint },
  });
  assert.equal(response.status, 200);
  return { Cookie: response.headers.get('set-cookie').split(';')[0], Origin: ctx.endpoint };
}

test('AdministratorBrowserPostsUnhandledPersonAskOnlyWithBoardMembership', async context => {
  const ctx = await httpFixture(context);
  const headers = await browserHeaders(ctx);
  const post = () => ctx.request('POST', '/api/comments', { board: 'alpha', text: 'A new question' }, null, headers);
  assert.equal((await post()).status, 403);
  assert.equal(
    (
      await ctx.request('POST', '/api/registry/member', {
        id: 'alpha',
        principal: ctx.admin.name,
        role: 'owner',
      })
    ).status,
    200,
  );
  const response = await post();
  assert.equal(response.status, 201);
  assert.equal(response.body.via, 'page');
  assert.equal(response.body.author, 'person');
  assert.equal(response.body.handled, false);
  ctx.privateOutput([headers.Cookie, ctx.adminFile.credential]);
});

test('AdministratorCookieCannotImportEvenFromAnotherLoopbackPort', async context => {
  const ctx = await httpFixture(context);
  const headers = await browserHeaders(ctx);
  const input = { comments: [{ id: 'forged', board: 'hidden', by: 'captain', author: 'owner', text: 'No' }] };
  for (const origin of [ctx.endpoint, 'http://127.0.0.1:9']) {
    const response = await ctx.request('POST', '/api/import', input, null, {
      ...headers,
      Origin: origin,
      'Content-Type': 'text/plain',
    });
    assert.equal(response.status, origin === ctx.endpoint ? 403 : 401);
  }
  assert.equal((await ctx.request('POST', '/api/import', { comments: [] })).status, 200);
  ctx.privateOutput([headers.Cookie, ctx.adminFile.credential]);
});

test('AdministratorCookieMutationsRequireExactOriginIncludingProxy', async context => {
  for (const configured of [null, 'https://board.example.invalid']) {
    const ctx = await httpFixture(context, cfg => ({
      ...cfg,
      enrollment: { enabled: true, ...(configured ? { browserOrigin: configured } : {}) },
    }));
    const origin = configured || ctx.endpoint;
    const login = await fetch(ctx.endpoint + '/api/registry/session', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + ctx.adminFile.credential, Origin: origin },
    });
    assert.equal(login.status, 200);
    const cookie = login.headers.get('set-cookie').split(';')[0];
    assert.equal(
      (
        await ctx.request('POST', '/api/registry/member', {
          id: 'alpha',
          principal: ctx.admin.name,
          role: 'owner',
        })
      ).status,
      200,
    );
    const requests = [
      ['/api/comments', { board: 'alpha', text: 'An ordinary question' }],
      [
        '/api/boards/alpha/authorities',
        {
          owner_words: 'Approve this relay',
          covers: 'one relay',
          relay: true,
          target: 'firstmate',
        },
      ],
    ];
    for (const [route, body] of requests) {
      for (const rejected of [null, 'http://127.0.0.1:9', ...(configured ? [ctx.endpoint] : [])]) {
        const response = await ctx.request('POST', route, body, null, {
          Cookie: cookie,
          'Content-Type': 'text/plain',
          ...(rejected ? { Origin: rejected } : {}),
        });
        assert.equal(response.status, 401);
      }
      const response = await ctx.request('POST', route, body, null, { Cookie: cookie, Origin: origin });
      assert.equal(response.status, 201);
      if (route === '/api/comments') {
        assert.equal(response.body.via, 'page');
        assert.equal(response.body.author, 'person');
        assert.equal(response.body.handled, false);
      }
    }
    ctx.privateOutput([cookie, ctx.adminFile.credential]);
  }
});

test('BoardOwnerCannotInviteConfiguredOwnerOrAliases', context => {
  const ctx = fixture(context, { cfg: { ownerAliases: ['former-captain'] } });
  const prepared = grantFor(ctx);
  for (const principal of ['captain', 'former-captain'])
    assert.throws(
      () =>
        ctx.enrollment.issue(
          { name: 'captain' },
          {
            proofVerifier: digest(prepared.proof),
            scope: { ...prepared.scope, principal },
          },
          () => assert.fail('must not issue'),
        ),
      /board owner/,
    );
  assert.throws(
    () =>
      ctx.enrollment.issue(
        { name: 'captain' },
        {
          proofVerifier: digest(prepared.proof),
          scope: { ...prepared.scope, boardId: '__proto__' },
        },
        () => assert.fail('must not issue'),
      ),
    /board owner/,
  );
});

test('MembershipAdoptionRetainsAdditiveRolesAndOwnerGuard', context => {
  const ctx = fixture(context);
  const management = makeManagement(ctx);
  management.member(ctx.admin, { id: 'alpha', principal: 'captain', role: ['owner', 'coordinator'] });
  management.member(ctx.admin, { id: 'alpha', principal: 'installer', role: ['operator', 'coordinator'] });
  const web = require('../web')(ctx);
  assert.equal(web.roleOn({ name: 'installer' }, 'alpha'), 3);
  assert.equal(web.isCoordinatorOn({ name: 'installer' }, 'alpha'), true);
  assert.throws(
    () =>
      management.member(ctx.admin, {
        id: 'alpha',
        principal: 'captain',
        role: ['coordinator'],
      }),
    /retain an owner/,
  );
  assert.deepEqual(ctx.registry.metadata().membershipAudit[1].role, ['operator', 'coordinator']);
  ctx.registry.transact(state => {
    state.metadata.boards.hidden.members = {};
  });
  management.member(ctx.admin, { id: 'hidden', principal: 'new-owner', role: 'owner' });
  assert.equal(ctx.registry.board('hidden').owner, 'new-owner');
});

test('LegacyAndExpiredGrantsAreNotRevocableContextEntries', context => {
  const ctx = fixture(context);
  grantFor(ctx);
  const active = Object.values(ctx.registry.credentials().grants)[0];
  ctx.registry.transact(state => {
    state.credentials.grants.legacy = { ...active, id: undefined };
    state.credentials.grants.expired = { ...active, id: 'expired', expiresAt: 1 };
    state.metadata.boards.hidden.members = {};
  });
  assert.deepEqual(
    makeManagement(ctx)
      .context(ctx.admin)
      .grants.map(grant => grant.id),
    [active.id],
  );
  assert.throws(() => ctx.enrollment.revokeGrant(ctx.admin, {}), /valid grant id/);
  assert.equal(ctx.registry.credentials().grants.legacy.revoked, undefined);
  makeManagement(ctx).member(ctx.admin, { id: 'hidden', principal: 'reader', role: 'viewer' });
});
