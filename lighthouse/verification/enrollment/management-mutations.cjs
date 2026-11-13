'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const repository = path.resolve(__dirname, '../../..');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-management-mutations-'));
const env = { ...process.env };
delete env.TYPESAFE_API_KEY;
const cases = [
  [
    'cookie-origin',
    'server/registry-browser.js',
    'AdministratorCookieMutationsRequireExactOriginIncludingProxy',
    [['if (req.headers.origin !== expected) return null;', 'if (false) return null;']],
    'server/tests/management-security.test.js',
  ],
  [
    'browser-person',
    'server/registry-browser.js',
    'AdministratorBrowserPostsUnhandledPersonAskOnlyWithBoardMembership',
    [["who: { ...who, via: 'page' }", "who: { ...who, via: 'api' }"]],
    'server/tests/management-security.test.js',
  ],
  [
    'cookie-import',
    'server/routes.js',
    'AdministratorCookieCannotImportEvenFromAnotherLoopbackPort',
    [["!who.hostAdmin || !/^Bearer /i.test(req.headers.authorization || '')", '!who.hostAdmin']],
    'server/tests/management-security.test.js',
  ],
  [
    'owner-identity',
    'server/enrollment.js',
    'BoardOwnerCannotInviteConfiguredOwnerOrAliases',
    [['isOwnerName(cfg, input.scope.principal)', 'false']],
    'server/tests/management-security.test.js',
  ],
  [
    'additive-role',
    'server/registry-management.js',
    'MembershipAdoptionRetainsAdditiveRolesAndOwnerGuard',
    [['!access.valid(input.role)', '!Object.keys(access.ranks).includes(input.role)']],
    'server/tests/management-security.test.js',
  ],
  [
    'authority',
    'server/registry-management.js',
    'SchemaTwoMembershipAdoptionIsAuditedAndRemovalOverridesDefaults',
    [['if (!usable(who) || !who.hostAdmin)', 'if (!usable(who))']],
  ],
  [
    'csrf',
    'server/registry-routes.js',
    'BrowserAdministratorSessionUsesHttpOnlyCookieAndEveryFormNeedsCsrf',
    [["req.headers['x-lighthouse-csrf'] !== csrf(who)", 'false']],
  ],
  [
    'audit',
    'server/registry-management.js',
    'SchemaTwoMembershipAdoptionIsAuditedAndRemovalOverridesDefaults',
    [['(state.metadata.membershipAudit ||= []).push(entry);', 'state.metadata.membershipAudit ||= [];']],
  ],
  [
    'copy',
    'board/app/management.js',
    'GrantPanelNeverCachesReplaysOrInsertsSecretsAsMarkup',
    [['function clearGrantOnce() {', 'function clearGrantOnce() { return;']],
  ],
  [
    'replay',
    'server/registry-routes.js',
    'OwnerGrantShownOnlyOnIssueAndRevocationStopsConsumption',
    [
      ['handoff = value;', 'handoff = value; ctx.managementLeakedGrant = value.grant;'],
      [
        'answer(200, management.context(who))',
        'answer(200, { ...management.context(who), grant: ctx.managementLeakedGrant })',
      ],
    ],
  ],
];
function run(root, name, suite) {
  return spawnSync(process.execPath, ['--test', '--test-name-pattern', name, path.join(root, 'lighthouse', suite)], {
    cwd: root,
    env,
    encoding: 'utf8',
    timeout: 60000,
  });
}
try {
  for (const [name, relative, regression, replacements, explicitSuite] of cases) {
    const root = path.join(scratch, name);
    for (const directory of ['server', 'board', 'tests'])
      fs.cpSync(path.join(repository, 'lighthouse', directory), path.join(root, 'lighthouse', directory), {
        recursive: true,
      });
    const suite =
      explicitSuite || (name === 'copy' ? 'board/tests/management.test.cjs' : 'server/tests/management.test.js');
    const file = path.join(root, 'lighthouse', relative);
    const original = fs.readFileSync(file, 'utf8');
    let broken = original;
    for (const [before, after] of replacements) {
      assert.ok(broken.includes(before), 'current mutation anchor: ' + name);
      broken = broken.replace(before, after);
    }
    assert.equal(run(repository, regression, suite).status, 0, 'normal regression passes: ' + name);
    fs.writeFileSync(file, broken);
    const result = run(root, regression, suite);
    assert.notEqual(result.status, 0, 'mutation fails: ' + name);
    assert.ok((result.stdout + result.stderr).includes(regression), 'named regression ran: ' + name);
    fs.writeFileSync(file, original);
    assert.equal(run(root, regression, suite).status, 0, 'restored regression passes: ' + name);
    console.log('caught management mutation and restored: ' + name);
  }
} finally {
  fs.rmSync(scratch, { recursive: true, force: true });
}
