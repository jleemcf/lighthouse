'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { fixture, grantFor } = require('./registry-fixture');
const { normalize } = require('../configuration');
const { applyProfile } = require('../../../scripts/apply-profile.cjs');
const makeWeb = require('../web');

test('all shipped operator briefs and profile overlays explain the notice authority boundary', () => {
  const root = path.resolve(__dirname, '../../..');
  for (const directory of ['lighthouse/operator-kit', 'private/lighthouse/operator-kit']) {
    if (!fs.existsSync(path.join(root, directory))) continue;
    for (const name of ['OPERATOR-BRIEF.md', 'OPERATOR-BRIEF-TOOLS.md', 'WATCH-BRIEF.md', 'README.md']) {
      const text = fs.readFileSync(path.join(root, directory, name), 'utf8');
      for (const phrase of [
        'coordinator, not the owner',
        "owner's existing approvals",
        'ask the owner on the board',
        'board_reply',
        'inbox card',
      ])
        assert.ok(text.includes(phrase), name + ': ' + phrase);
    }
  }
});

test('a coordinator using an owner alias still cannot settle a legacy owner ask', () => {
  const grammar = require('../grammar')({
    cfg: { ownerId: 'owner', ownerAliases: ['alias'] },
    store: {
      comments: {
        notice: { cardId: 'task', by: 'alias', author: 'coordinator', kind: 'notice', t: '2026-11-11T15:00:00Z' },
      },
    },
  });
  assert.equal(grammar.ownerAnsweredAt('task'), '');
});

test('coordinator membership survives the registry and installation roles do not inherit it', context => {
  const ctx = fixture(context, {
    cfg: {
      boards: {
        alpha: {
          name: 'Alpha',
          protocol: 'lines',
          access: { captain: 'owner', dual: ['operator', 'coordinator'] },
        },
      },
    },
  });
  const web = makeWeb(ctx);
  assert.equal(web.roleOn({ name: 'dual' }, 'alpha'), 3);
  assert.equal(web.isCoordinatorOn({ name: 'dual' }, 'alpha'), true);
  assert.equal(web.isCoordinatorOn({ name: 'dual' }, 'hidden'), false);
  for (const role of ['operator', 'coordinator']) {
    const grant = grantFor(ctx, { scope: { principal: 'dual', role, protocol: 'lines' } });
    ctx.enrollment.consume(grant);
    const login = ctx.enrollment.authenticate(grant.credential);
    assert.equal(web.isCoordinatorOn(login, 'alpha'), role === 'coordinator');
    assert.equal(web.roleOn(login, 'alpha'), role === 'coordinator' ? 1 : 3);
    assert.equal(web.isCoordinatorOn(login, 'other'), false);
    ctx.enrollment.installation(ctx.admin, 'revoke', { installationId: login.installationId });
    assert.equal(web.isCoordinatorOn(login, 'alpha'), false);
  }
  assert.deepEqual(ctx.registry.projection().alpha.access.dual, ['operator', 'coordinator']);
  assert.equal(
    makeWeb({ cfg: { boards: { alpha: { access: {} } }, defaultRole: { dual: 'coordinator' } } }).isCoordinatorOn(
      { name: 'dual' },
      'alpha',
    ),
    false,
    'a global fallback cannot grant this board role',
  );
});

test('private profile grants only chief of staff coordinator and preserves the chief developer', context => {
  const profilePath = path.resolve(__dirname, '../../../private/compatibility/profile.json');
  if (!fs.existsSync(profilePath)) return context.skip('private profile is excluded from public exports');
  const profile = JSON.parse(fs.readFileSync(profilePath, 'utf8'));
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'coordinator-profile-'));
  context.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const configPath = path.join(folder, 'config.json');
  const boards = Object.fromEntries(
    profile.matchBoardIds.map(board => [
      board,
      {
        access: {
          'chief developer': 'operator',
          owner: 'owner',
          existing: 'watch',
        },
      },
    ]),
  );
  const initial = { boards, tokens: { synthetic: { name: 'chief developer', via: 'api' } } };
  for (const board of profile.matchBoardIds)
    assert.deepEqual(
      normalize(initial).boards[board].access,
      boards[board].access,
      'runtime compatibility never adds the grant',
    );
  fs.writeFileSync(configPath, JSON.stringify(initial));
  const preview = applyProfile(configPath, profilePath, true);
  assert.ok(preview.changed);
  assert.deepEqual(JSON.parse(fs.readFileSync(configPath, 'utf8')), initial);
  applyProfile(configPath, profilePath);
  const result = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  for (const board of profile.matchBoardIds) {
    assert.deepEqual(result.boards[board].access, {
      ...boards[board].access,
      'chief of staff': ['coordinator'],
    });
  }
  assert.deepEqual(
    profile.coordinatorGrants,
    Object.fromEntries(profile.matchBoardIds.map(board => [board, ['chief of staff']])),
  );
  const web = makeWeb({ cfg: normalize(result) });
  for (const board of profile.matchBoardIds) {
    assert.equal(web.isCoordinatorOn({ name: 'chief developer' }, board), false);
    assert.equal(web.isCoordinatorOn({ name: 'chief of staff' }, board), true);
    assert.equal(web.roleOn({ name: 'chief of staff' }, board), 1);
  }
  assert.deepEqual(result.tokens, initial.tokens);
  assert.equal(applyProfile(configPath, profilePath).changed, false);
});

test('coordinator notices cannot reset operator silence or trigger operator flooding', () => {
  const earlier = new Date(Date.now() - 300 * 60000).toISOString();
  const board = { shift: { state: 'on', lastSeen: earlier } };
  const at = new Date(Date.now() - 60000).toISOString();
  const parent = { id: 'parent', board: 'test', title: 'Existing work', status: 'active' };
  const duplicate = {
    id: 'duplicate',
    board: 'test',
    title: 'Same work',
    status: 'active',
    judge: { sameAs: 'parent', confidence: 1, t: at },
  };
  const ctx = {
    cfg: { jevEnabled: false },
    store: { boards: { test: board }, cards: { parent, duplicate }, comments: {} },
    slugOf: () => '',
    isStandingCard: () => false,
    isWatchOn: () => false,
    plainWords: text => text,
    staleCards: () => [],
    judgeActive: () => false,
    ST: { health: () => ({}) },
  };
  const conduct = require('../conduct')(ctx);
  const before = conduct.conductOf('test', 60);
  for (let index = 0; index < 12; index++)
    ctx.store.comments[index] = {
      board: 'test',
      via: 'api',
      author: 'coordinator',
      kind: 'notice',
      by: 'coordinator',
      t: new Date(Date.now() - 120000).toISOString(),
      text: 'parent is a catch-all; split the work onto its own card.',
    };
  const after = conduct.conductOf('test', 60);
  assert.equal(before.signals.silenceMin, 300);
  assert.equal(before.signals.duplicates, 1);
  assert.deepEqual(after, before);
});
