'use strict';
require('../../tests/sandbox.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { codec } = require('../compatibility');
const { applyProfile } = require('../../../scripts/apply-profile.cjs');

test('delegated relays use the configured display name literally', () => {
  const grammar = require('../grammar')({ cfg: { ownerName: 'Captain [Example]' }, store: { comments: {} } });
  assert.ok(grammar.DELEGATED.test("Sent under Captain [Example]'s authority"));
  assert.equal(grammar.DELEGATED.test("Sent under Captain E's authority"), false);
  assert.equal(grammar.DELEGATED.test("Sent under Owner's authority"), false);
});

test('handled log kinds retain rollback storage while unrelated staff roles stay unchanged', () => {
  const conversion = codec({ stateCompatibility: { ownerRole: 'captain-42', ownerLogKind: 'CAPTAIN' } });
  const legacy = {
    cards: { work: { log: [{ kind: 'CAPTAIN', text: 'Handled it' }] } },
    crm: { staff: [{ role: 'owner', author: 'captain-42', name: 'Staff member' }] },
    transcript: [{ role: 'captain-42', text: 'Proceed', t: '2026-01-01T00:00:00Z' }],
  };
  const canonical = conversion.read(legacy);
  assert.equal(canonical.cards.work.log[0].kind, 'OWNER');
  assert.equal(canonical.transcript[0].role, 'owner');
  assert.deepEqual(canonical.crm, legacy.crm);
  assert.deepEqual(conversion.write(canonical), legacy);
  assert.equal(conversion.wire(canonical).cards.work.log[0].kind, 'OWNER');
  const neutral = {};
  for (const operation of ['read', 'write', 'wire']) assert.equal(codec({})[operation](neutral), neutral);
});

test('profile application fills gaps and reports explicit non-secret conflicts without replacing them', context => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-profile-conflicts-'));
  context.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const config = path.join(folder, 'config.json');
  const profile = path.join(folder, 'profile.json');
  const input = {
    boards: { work: { displayName: 'Local label', order: 5 } },
    crm: { board: 'other', token: 'synthetic-secret' },
  };
  fs.writeFileSync(config, JSON.stringify(input));
  fs.writeFileSync(
    profile,
    JSON.stringify({
      server: {
        ownerId: 'captain-42',
        timeZoneLabel: 'UTC',
        boards: { work: { displayName: 'Default label', order: 0 } },
        crm: { board: 'work', needsOwnerKind: 'external-help', token: 'not-selected' },
      },
    }),
  );
  const result = applyProfile(config, profile);
  const output = JSON.parse(fs.readFileSync(config));
  assert.deepEqual(output.boards, input.boards);
  assert.equal(output.crm.board, 'other');
  assert.equal(output.crm.token, 'synthetic-secret');
  assert.equal(output.crm.needsOwnerKind, 'external-help');
  assert.ok(result.conflicts.some(item => item.key === 'crm.board' && item.kept === 'other'));
  assert.ok(result.changes.some(item => item.key === 'crm.needsOwnerKind' && item.value === 'external-help'));
  assert.doesNotMatch(JSON.stringify(result), /synthetic-secret|not-selected/);
  assert.equal(applyProfile(config, profile).changed, false);
});

test(
  'deployment refuses an unapplied matching profile before staging or touching a serving home',
  { skip: !fs.existsSync(path.resolve(__dirname, '../../../private/compatibility/profile.json')) },
  async context => {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-profile-deploy-'));
    context.after(() => fs.rmSync(folder, { recursive: true, force: true }));
    const profile = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../private/compatibility/profile.json')));
    fs.writeFileSync(
      path.join(folder, 'config.json'),
      JSON.stringify({
        boards: Object.fromEntries(profile.matchBoardIds.map(id => [id, {}])),
      }),
    );
    await assert.rejects(
      require('../board-release').run({ action: 'deploy', source: path.resolve(__dirname, '..'), home: folder }),
      /Apply the compatibility profile/,
    );
    assert.deepEqual(fs.readdirSync(folder), ['config.json']);
    const filename = path.join(folder, 'config.json');
    const config = JSON.parse(fs.readFileSync(filename));
    config.profile = profile.server.profile;
    fs.writeFileSync(filename, JSON.stringify(config));
    await assert.rejects(
      require('../board-release').run({ action: 'deploy', source: path.resolve(__dirname, '..'), home: folder }),
      /existing pushSubject/,
    );
    assert.deepEqual(fs.readdirSync(folder), ['config.json']);
  },
);

test('target selection reports configuration errors rather than a misleading missing-board error', context => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-target-errors-'));
  context.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const filename = path.join(folder, 'config.json');
  for (const [config, expected] of [
    [{ timeZone: 'not-a-time-zone' }, /time zone/i],
    [{ crm: { base: 'http://127.0.0.1:1' }, boards: {} }, /destination board/],
    ['{invalid-sensitive-value', /Invalid configuration JSON/],
  ]) {
    fs.writeFileSync(filename, typeof config === 'string' ? config : JSON.stringify(config));
    const result = require('node:child_process').spawnSync(
      process.execPath,
      [path.resolve(__dirname, '../config-target.js'), filename],
      { encoding: 'utf8' },
    );
    assert.equal(result.status, 2);
    assert.match(result.stderr, expected);
    assert.doesNotMatch(result.stderr, /Select a configured board|invalid-sensitive-value/);
  }
});
