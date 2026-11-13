'use strict';
require('../../tests/sandbox.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { normalize, ownerId, isOwnerName } = require('../configuration');
const { codec } = require('../compatibility');
const { clock, parts } = require('../business-time');
const { target } = require('../config-target');
const { applyProfile } = require('../../../scripts/apply-profile.cjs');
const root = path.resolve(__dirname, '../../..');
const overlay = path.join(root, 'private/compatibility');
const available = fs.existsSync(path.join(overlay, 'profile.json'));
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const scratch = context => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-generic-'));
  context.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  return folder;
};

test('core defaults have a stable owner, UTC clocks, no CRM and no hidden board selection', () => {
  const cfg = normalize({ boards: { work: { name: 'Work', access: { owner: 'owner' } } } });
  assert.equal(cfg.ownerId, 'owner');
  assert.equal(cfg.ownerName, 'the captain');
  assert.equal(cfg.timeZone, 'UTC');
  assert.equal(cfg.windowsTimeZone, 'UTC');
  assert.equal(cfg.crm, undefined);
  assert.throws(() => target(cfg), /Select a configured board/);
  assert.equal(target(cfg, 'work'), 'work');
  assert.throws(() => normalize({ boards: {}, defaultBoard: 'missing' }), /defaultBoard/);
  assert.throws(() => normalize({ boards: { work: {} }, crm: { base: 'http://127.0.0.1:1' } }), /destination/);
  assert.throws(() => normalize({ timeZone: 'invalid-zone' }), RangeError);
});

test('owner display names never confer authority and compatibility aliases are explicit', () => {
  const cfg = normalize({ ownerId: 'captain-42', ownerName: 'Display name', ownerAliases: ['old-captain'] });
  assert.equal(ownerId(cfg), 'captain-42');
  assert.ok(isOwnerName(cfg, 'captain-42'));
  assert.ok(isOwnerName(cfg, 'old-captain'));
  assert.equal(isOwnerName(cfg, 'Display name'), false);
  assert.equal(isOwnerName(cfg, 'owner'), false);
  const grammar = require('../grammar')({
    cfg,
    store: {
      comments: {
        accepted: { cardId: 'card', by: 'captain-42', t: '2026-11-10T01:00:00Z' },
        refused: { cardId: 'card', by: 'Display name', t: '2026-11-10T02:00:00Z' },
      },
    },
  });
  assert.equal(grammar.ownerAnsweredAt('card'), '2026-11-10T01:00:00Z');
});

test('owner aliases reject malformed shapes and never match a substring', () => {
  for (const ownerAliases of ['old-captain', { captain: true }, '', [''], ['   '], [17]])
    assert.throws(() => normalize({ ownerAliases }), /ownerAliases must be an array of non-empty strings/);
  const cfg = normalize({ ownerId: 'captain-42', ownerAliases: ['old-captain'] });
  for (const principal of ['captain', 'old', 'aptain', 'captain-4', 'old-captain-extra'])
    assert.equal(isOwnerName(cfg, principal), false);
  assert.equal(isOwnerName({ ownerAliases: 'old-captain' }, 'captain'), false);
  assert.equal(isOwnerName({ ownerAliases: {} }, 'captain'), false);
});

test('serialization changes neither stored authors nor legacy field names', () => {
  const cfg = {
    stateCompatibility: { ownerRole: 'captain-42', keys: { forOwner: 'legacyFlag' } },
    crm: { needsOwnerKind: 'external-help' },
  };
  const value = {
    by: 'captain-42',
    author: 'captain-42',
    legacyFlag: true,
    text: 'needs_owner',
    body: { kind: 'external-help' },
    log: [{ text: 'external-help sent to the CRM' }],
  };
  const conversion = codec(cfg);
  const decoded = conversion.read(value);
  assert.equal(decoded.author, 'owner');
  assert.equal(decoded.forOwner, true);
  assert.equal(decoded.body.kind, 'needs_owner');
  assert.equal(decoded.log[0].text, 'needs_owner sent to the CRM');
  assert.deepEqual(conversion.write(decoded), value);
  assert.equal(conversion.wire(decoded).legacyFlag, true);
  assert.equal(conversion.wire(decoded).forOwner, true);
  assert.equal(conversion.write(decoded).text, 'needs_owner');
});

test('private compatibility matches baseline board presentation and clock boundaries', { skip: !available }, () => {
  const profile = read(path.join(overlay, 'profile.json'));
  const expected = read(path.join(overlay, 'expected.json'));
  const legacy = read(path.join(root, 'private/lighthouse/server/config.example.json'));
  for (const board of Object.values(legacy.boards)) {
    delete board.displayName;
    delete board.order;
  }
  const cfg = normalize(legacy);
  const boards = Object.entries(cfg.boards)
    .sort((left, right) => left[1].order - right[1].order)
    .map(([id, board]) => ({ id, label: board.displayName }));
  assert.deepEqual(boards, expected.boards);
  assert.equal(ownerId(cfg), expected.ownerId);
  assert.equal(target(cfg), expected.archiveBoard);
  assert.equal(cfg.crm.board, profile.server.crm.board);
  assert.equal(cfg.crm.needsOwnerKind, profile.server.crm.needsOwnerKind);
  assert.equal(cfg.jevEnabled, legacy.jevEnabled);
  for (const { id } of expected.boards)
    assert.deepEqual(cfg.boards[id].access, legacy.boards[id].access, 'runtime preserves each board grant');
  for (const value of expected.times) {
    assert.equal(clock(cfg, value.iso), value.clock);
    assert.deepEqual(parts(cfg, Date.parse(value.iso)), value.parts);
    assert.equal(Math.floor(parts(cfg, Date.parse(value.iso)).sec / 14400), Math.floor(value.parts.sec / 14400));
  }
  const digest = crypto.createHash('sha256').update(fs.readFileSync(cfg.rulingsFile)).digest('hex');
  assert.equal(digest, expected.policyHash);
});

test('profile apply is dry-run safe, backup-first, idempotent and keeps credentials', { skip: !available }, context => {
  const folder = scratch(context);
  const filename = path.join(folder, 'config.json');
  const profilePath = path.join(overlay, 'profile.json');
  const profile = read(profilePath);
  const initial = {
    boards: Object.fromEntries(
      profile.matchBoardIds.map(id => [id, { access: { 'chief developer': 'operator', existing: 'watch' } }]),
    ),
    tokens: { 'synthetic-private-value': { name: profile.server.ownerId, via: 'page' } },
    jevEnabled: false,
  };
  fs.writeFileSync(filename, JSON.stringify(initial));
  const before = fs.readFileSync(filename, 'utf8');
  const preview = applyProfile(filename, profilePath, true);
  assert.ok(preview.changed);
  assert.equal(fs.readFileSync(filename, 'utf8'), before);
  assert.deepEqual(fs.readdirSync(folder), ['config.json']);
  assert.doesNotMatch(JSON.stringify(preview), /synthetic-private-value/);
  assert.ok(applyProfile(filename, profilePath).changed);
  assert.equal(fs.readFileSync(filename + '.pre-profile.1', 'utf8'), before);
  assert.deepEqual(read(filename).tokens, initial.tokens);
  for (const id of profile.matchBoardIds)
    assert.deepEqual(read(filename).boards[id].access, {
      ...initial.boards[id].access,
      'chief of staff': ['coordinator'],
    });
  assert.equal(applyProfile(filename, profilePath).changed, false);
  assert.equal(fs.existsSync(filename + '.pre-profile.2'), false);
  const configured = normalize(read(filename), filename);
  assert.equal(
    crypto.createHash('sha256').update(fs.readFileSync(configured.rulingsFile)).digest('hex'),
    profile.policy.sha256,
  );
});

test(
  'profile application reuses its verified policy after an interrupted configuration write',
  { skip: !available },
  context => {
    const folder = scratch(context);
    const filename = path.join(folder, 'config.json');
    const profilePath = path.join(overlay, 'profile.json');
    const profile = read(profilePath);
    fs.writeFileSync(filename, '{}');
    const policyPath = path.join(folder, 'profile-policies.json');
    fs.copyFileSync(path.resolve(overlay, profile.policy.file), policyPath);
    applyProfile(filename, profilePath);
    assert.equal(read(filename).rulingsFile, 'profile-policies.json');
    assert.equal(crypto.createHash('sha256').update(fs.readFileSync(policyPath)).digest('hex'), profile.policy.sha256);
  },
);
