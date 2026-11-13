'use strict';
require('../../tests/sandbox.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const fixture = require('./release-fixture');
const { applyProfile } = require('../../../scripts/apply-profile.cjs');
const { normalize } = require('../configuration');
const { codec } = require('../compatibility');
const overlay = path.resolve(__dirname, '../../../private/compatibility/profile.json');
const available = fs.existsSync(overlay);

test('profile runtime preserves historical authors, keys, ids and archives', { skip: !available }, async context => {
  const profile = JSON.parse(fs.readFileSync(overlay, 'utf8'));
  const settings = normalize(profile.server);
  const board = settings.defaultBoard;
  settings.crm = undefined;
  settings.jevEnabled = false;
  settings.ownerAliases = ['legacy-captain'];
  settings.tokens = { OWNER: { name: settings.ownerId, via: 'page' } };
  settings.boards = Object.fromEntries(
    Object.entries(settings.boards).map(([id, value]) => [
      id,
      {
        ...value,
        access: { [settings.ownerId]: 'owner' },
      },
    ]),
  );
  const conversion = codec(settings);
  const history = conversion.write({
    id: 'old-message',
    board,
    by: settings.ownerId,
    author: 'owner',
    t: '2026-01-01T00:00:00Z',
    text: 'Historical message',
    handled: true,
  });
  const oldCard = conversion.write({
    id: board + '-old',
    board,
    title: 'Completed',
    status: 'done',
    forOwner: false,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    updatedBy: settings.ownerId,
    log: [{ t: '2026-01-01T00:00:00Z', kind: 'OWNER', text: 'Original history' }],
  });
  const pending = conversion.write({
    id: board + '-pending',
    board,
    title: 'Needs a decision',
    status: 'waiting',
    needsAction: true,
    log: [],
  });
  const runtime = await fixture(
    context,
    { cards: { [oldCard.id]: oldCard, [pending.id]: pending }, comments: { [history.id]: history } },
    'lines',
    settings,
  );
  let response = await runtime.request('GET', '/api/state', null, 'OWNER');
  assert.equal(response.status, 200);
  assert.equal(response.body.ownerId, settings.ownerId);
  assert.deepEqual(response.body.ownerAliases, settings.ownerAliases);
  assert.equal(response.body.timeZone, settings.timeZone);
  assert.equal(response.body.timeZoneLabel, 'ET');
  response = await runtime.request('POST', '/api/comments', { board, text: 'New decision' }, 'OWNER');
  assert.equal(response.status, 201);
  const state = (await runtime.request('GET', '/api/state', null, 'OWNER')).body;
  const made = state.recent.find(message => message.text === 'New decision');
  assert.equal(made.by, settings.ownerId);
  assert.equal(made.author, profile.server.stateCompatibility.ownerRole);
  response = await runtime.request('POST', '/api/cards/' + pending.id + '/resolve', {}, 'OWNER');
  assert.equal(response.status, 200);
  assert.equal(response.body.card.log[0].kind, 'OWNER');
  await new Promise(resolve => setTimeout(resolve, 220));
  const storePath = path.join(runtime.directory, 'store.json');
  const persisted = JSON.parse(fs.readFileSync(storePath));
  assert.deepEqual(persisted.comments[history.id], history);
  assert.equal(persisted.comments[made.id].author, history.author);
  assert.equal(persisted.cards[pending.id].log[0].kind, profile.server.stateCompatibility.ownerLogKind);
  for (const [canonical, historical] of Object.entries(profile.server.stateCompatibility.keys)) {
    if (Object.hasOwn(oldCard, historical)) {
      assert.ok(Object.hasOwn(persisted.cards[oldCard.id], historical));
      assert.equal(Object.hasOwn(persisted.cards[oldCard.id], canonical), false);
    }
  }
  await runtime.stop();
  const archive = spawnSync(
    process.execPath,
    [
      path.resolve(__dirname, '../server.js'),
      '--config',
      path.join(runtime.directory, 'config.json'),
      'archive',
      '--days',
      '1',
    ],
    {
      env: { ...process.env, TYPESAFE_API_KEY: '' },
      encoding: 'utf8',
      timeout: 10000,
    },
  );
  assert.equal(archive.status, 0, archive.stderr);
  const archivedFiles = fs.readdirSync(path.join(runtime.directory, 'archive', board));
  assert.ok(archivedFiles.length);
  const archived = JSON.parse(fs.readFileSync(path.join(runtime.directory, 'archive', board, oldCard.id + '.json')));
  assert.equal(archived.card.id, oldCard.id);
  assert.deepEqual(archived.card.log, oldCard.log);
  assert.equal(JSON.parse(fs.readFileSync(storePath)).comments[made.id].author, history.author);
});

test('profile application preserves explicit judge consent and custom policies', { skip: !available }, context => {
  const os = require('node:os');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-profile-consent-'));
  context.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const configPath = path.join(home, 'config.json');
  const policy = '{"rulings": [{"n": 8, "title": "Custom", "text": "Retain local policy"}]}';
  fs.writeFileSync(path.join(home, 'policies.json'), policy);
  fs.writeFileSync(configPath, JSON.stringify({ rulingsFile: 'policies.json', jevEnabled: false }));
  applyProfile(configPath, overlay);
  const config = JSON.parse(fs.readFileSync(configPath));
  assert.equal(config.jevEnabled, false);
  assert.equal(config.rulingsFile, 'policies.json');
  assert.equal(fs.readFileSync(path.join(home, 'policies.json'), 'utf8'), policy);
});
