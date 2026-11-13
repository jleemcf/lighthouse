'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { httpFixture } = require('./registry-http-fixture.cjs');
const { grantFor, fixture } = require('./registry-fixture');
const { digest, secret } = require('../registry');
const { makeManagement } = require('../registry-management');

test('ManagementHiddenBoardsNeverLeakCountsOrderOrInstallations', async context => {
  const ctx = await httpFixture(context, cfg => {
    cfg.tokens.fixtureOperator = { name: 'operator', via: 'page' };
    cfg.tokens.fixtureWatch = { name: 'watch', via: 'page' };
    cfg.boards.alpha.access.operator = 'operator';
    cfg.boards.alpha.access.watch = 'watch';
    return cfg;
  });
  const owner = await ctx.request('GET', '/api/registry/context', undefined, 'fixtureLegacy');
  assert.deepEqual(
    owner.body.boards.map(board => [board.id, board.order]),
    [['alpha', 0]],
  );
  assert.ok(!JSON.stringify(owner.body).includes('Hidden'));
  for (const credential of ['fixtureOperator', 'fixtureWatch']) {
    const result = await ctx.request('GET', '/api/registry/context', undefined, credential);
    assert.deepEqual(result.body.boards, []);
    assert.deepEqual(result.body.installations, []);
    assert.equal(
      (
        await ctx.request(
          'POST',
          '/api/registry/member',
          {
            id: 'alpha',
            principal: 'new',
            role: 'owner',
          },
          credential,
        )
      ).status,
      403,
    );
  }
  assert.equal(
    (
      await ctx.request(
        'POST',
        '/api/registry/reorder',
        {
          id: 'alpha',
          anchor: 'hidden',
          placement: 'before',
        },
        'fixtureLegacy',
      )
    ).status,
    403,
  );
});

test('SchemaTwoMembershipAdoptionIsAuditedAndRemovalOverridesDefaults', context => {
  const ctx = fixture(context, { cfg: { defaultRole: { inherited: 'operator' } } });
  const management = makeManagement(ctx);
  const change = role => management.member(ctx.admin, { id: 'alpha', principal: 'inherited', role });
  change('coordinator');
  change('viewer');
  change(null);
  assert.equal(ctx.registry.board('alpha').members.inherited, null);
  const web = require('../web')({ ...ctx, compatibility: { wire: value => value } });
  assert.equal(web.roleOn({ name: 'inherited' }, 'alpha'), 0);
  assert.deepEqual(
    ctx.registry.metadata().membershipAudit.map(entry => entry.role),
    ['coordinator', 'viewer', null],
  );
  assert.ok(ctx.registry.metadata().membershipAudit.every(entry => entry.actor === ctx.admin.name));
  assert.throws(
    () =>
      management.member(
        { name: 'captain' },
        {
          id: 'alpha',
          principal: 'new',
          role: 'operator',
        },
      ),
    /host administrator/,
  );
  assert.throws(
    () => management.member(ctx.admin, { id: 'alpha', principal: 'captain', role: null }),
    /retain an owner/,
  );
  assert.equal(ctx.registry.metadata().membershipAudit.length, 3);
});

test('BrowserAdministratorSessionUsesHttpOnlyCookieAndEveryFormNeedsCsrf', async context => {
  const ctx = await httpFixture(context);
  const response = await fetch(ctx.endpoint + '/api/registry/session', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + ctx.adminFile.credential, Origin: ctx.endpoint },
  });
  assert.equal(response.status, 200);
  const cookie = response.headers.get('set-cookie');
  assert.match(cookie, /HttpOnly; SameSite=Strict; Max-Age=1800/);
  assert.ok(!cookie.includes(ctx.adminFile.credential));
  const headers = { Cookie: cookie.split(';')[0], Origin: ctx.endpoint };
  const csrf = await ctx.request('GET', '/api/registry/csrf', undefined, null, headers);
  const input = { id: 'alpha', principal: 'captain', role: 'owner' };
  assert.equal((await ctx.request('POST', '/api/registry/member', input, null, headers)).status, 403);
  headers['X-Lighthouse-CSRF'] = csrf.body.csrf;
  assert.equal((await ctx.request('POST', '/api/registry/member', input, null, headers)).status, 200);
  assert.equal(
    (
      await ctx.request('POST', '/api/registry/member', input, ctx.adminFile.credential, {
        Origin: ctx.endpoint,
      })
    ).status,
    403,
  );
  const state = await ctx.request('GET', '/api/registry/context', undefined, null, headers);
  assert.equal(state.body.hostAdmin, true);
  assert.equal((await ctx.request('POST', '/api/registry/logout', {}, null, headers)).status, 200);
  const signedOut = await ctx.request('GET', '/api/registry/context', undefined, null, headers);
  assert.equal(signedOut.body.signedIn, false);
  ctx.privateOutput([ctx.adminFile.credential, headers.Cookie]);
});

test('BrowserSessionExpiryAndAdministratorRemovalRevokeAccess', context => {
  const ctx = fixture(context);
  let now = Date.now();
  const browser = require('../registry-browser').makeBrowser(ctx, () => now);
  const headers = {};
  browser.login(
    { headers: { authorization: 'Bearer ' + ctx.adminFile.credential }, socket: {} },
    {
      setHeader: (name, value) => {
        headers[name] = value;
      },
    },
    ctx.admin,
  );
  const request = { method: 'GET', headers: { cookie: headers['Set-Cookie'].split(';')[0] } };
  assert.equal(browser.registrySession(request).hostAdmin, true);
  now += 1800001;
  assert.equal(browser.registrySession(request), null);
  now -= 1800001;
  ctx.registry.transact(state => {
    state.credentials.admins = {};
  });
  assert.equal(browser.registrySession(request), null);
});

test('AdministrationProxyRequiresExplicitHttpsOriginAndSecureCookie', async context => {
  const origin = 'https://board.example.invalid';
  const ctx = await httpFixture(context, cfg => ({ ...cfg, enrollment: { enabled: true, browserOrigin: origin } }));
  const login = async selected =>
    fetch(ctx.endpoint + '/api/registry/session', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + ctx.adminFile.credential, Origin: selected },
    });
  assert.equal((await login(ctx.endpoint)).status, 403);
  const accepted = await login(origin);
  assert.equal(accepted.status, 200);
  assert.match(accepted.headers.get('set-cookie'), /; Secure/);
  assert.equal((await login('https://other.example.invalid')).status, 403);
});

test('OwnerCannotEscalateCreateOrGrantAcrossManagedBoards', context => {
  const ctx = fixture(context);
  const input = grantFor(ctx);
  const owner = { name: 'captain', mode: 'tools' };
  const issue = scope => ctx.enrollment.issue(owner, { scope, proofVerifier: digest(input.proof) }, () => {});
  for (const scope of [
    { ...input.scope, action: 'create' },
    { ...input.scope, role: 'owner' },
    { ...input.scope, role: 'coordinator' },
    { ...input.scope, boardId: 'hidden' },
  ])
    assert.throws(() => issue(scope), /owner/);
  assert.throws(
    () =>
      ctx.enrollment.issue(
        { ...owner, installationId: crypto.randomUUID(), installationRole: 'operator' },
        { scope: input.scope, proofVerifier: digest(input.proof) },
        () => {},
      ),
    /owner/,
  );
});

test('OwnerGrantShownOnlyOnIssueAndRevocationStopsConsumption', async context => {
  const ctx = await httpFixture(context);
  const prepared = {
    installationId: crypto.randomUUID(),
    proof: secret(),
    credential: secret(),
    operationId: crypto.randomUUID(),
  };
  const scope = {
    action: 'bind',
    boardId: 'alpha',
    principal: 'new',
    role: 'operator',
    protocol: 'tools',
    installationId: prepared.installationId,
  };
  const issued = await ctx.request(
    'POST',
    '/api/registry/grant',
    { proofVerifier: digest(prepared.proof), scope },
    'fixtureLegacy',
  );
  assert.equal(issued.status, 200);
  const listed = await ctx.request('GET', '/api/registry/context', undefined, 'fixtureLegacy');
  assert.ok(!JSON.stringify(listed.body).includes(issued.body.grant));
  assert.equal(listed.body.grants.length, 1);
  assert.equal(
    (
      await ctx.request(
        'POST',
        '/api/registry/revoke-grant',
        {
          id: listed.body.grants[0].id,
        },
        'fixtureLegacy',
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await ctx.request(
        'POST',
        '/api/enrollment/consume',
        {
          ...prepared,
          ...issued.body,
        },
        null,
      )
    ).status,
    403,
  );
  assert.ok(!JSON.stringify(ctx.registry.files.read()).includes(issued.body.grant));
  ctx.privateOutput([issued.body.grant, prepared.proof, prepared.credential]);
});

test('DoctorReportAcceptsOnlyRedactedKnownChecksAndCannotForgeAnotherInstallation', async context => {
  const ctx = await httpFixture(context);
  const input = grantFor(ctx);
  await ctx.request('POST', '/api/enrollment/consume', input, null);
  const report = await ctx.request(
    'POST',
    '/api/enrollment/doctor',
    {
      installationId: crypto.randomUUID(),
      checks: [
        { name: 'binding', status: 'ok', detail: input.credential },
        { name: input.proof, status: 'ok' },
      ],
    },
    input.credential,
  );
  assert.equal(report.status, 200);
  const listed = await ctx.request('GET', '/api/registry/context');
  assert.deepEqual(listed.body.installations[0].doctor.checks, [{ name: 'binding', status: 'ok' }]);
  assert.ok(!JSON.stringify(listed.body).includes(input.credential));
  assert.equal((await ctx.request('POST', '/api/enrollment/doctor', { checks: [] }, 'fixtureLegacy')).status, 403);
});

test('EnrollmentOffKeepsManagementScreensInert', async context => {
  const ctx = await httpFixture(context, cfg => ({ ...cfg, enrollment: { enabled: false } }));
  assert.deepEqual((await ctx.request('GET', '/api/registry/context')).body, { enabled: false });
  assert.equal(
    (
      await ctx.request('POST', '/api/registry/session', {}, ctx.adminFile.credential, {
        Origin: ctx.endpoint,
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await ctx.request('POST', '/api/registry/member', {
        id: 'alpha',
        principal: 'adopted',
        role: 'coordinator',
      })
    ).status,
    200,
  );
});
