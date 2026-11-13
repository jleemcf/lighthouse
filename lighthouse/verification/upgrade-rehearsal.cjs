'use strict';
require('../tests/sandbox.cjs');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { testPort } = require('../tests/sandbox.cjs');
const { run } = require('../server/tests/deploy-fixture.cjs');
const { create, snapshot } = require('./upgrade-fixture.cjs');
const { updateOperators } = require('./upgrade-kit.cjs');

async function rehearse(context) {
  if (process.platform !== 'linux') throw new Error('Run this fixture-only rehearsal in Linux or WSL.');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-upgrade-rehearsal-'));
  const port = await testPort();
  const fixture = create(root, port);
  const endpoint = 'http://127.0.0.1:' + port;
  const manager = action =>
    run('bash', [path.join(fixture.home, 'board.sh'), action], {
      env: { LH_HOME: fixture.home },
    });
  context.after(async () => {
    try {
      await manager('stop');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
  const start = await manager('start');
  assert.equal(start.code, 0, 'legacy fixture starts on loopback');
  assert.equal((await manager('stop')).code, 0, 'legacy fixture stops for offline migration');
  const before = snapshot(fixture.home);
  const safety = path.join(root, 'pre-profile-backup');
  fs.cpSync(fixture.home, safety, { recursive: true });
  const applied = require('../../scripts/apply-profile.cjs').applyProfile(fixture.config, fixture.profile);
  assert.equal(applied.changed, true);
  assert.deepEqual(snapshot(fixture.home), before, 'profile application retains effective settings and all work');
  const migrated = await require('../server/registry-migrate').migrate(fixture.config, {
    backup: path.join(root, 'schema-one-backup'),
  });
  assert.equal(migrated.schema, 2);
  assert.equal(migrated.enrollmentEnabled, false, 'migration does not activate enrollment');
  assert.deepEqual(snapshot(fixture.home), before, 'schema two registry import is in-place');
  assert.equal((await manager('start')).code, 0, 'migrated baseline remains runnable');
  await require('../server/board-release').run({
    action: 'deploy',
    source: path.resolve(__dirname, '../server'),
    home: fixture.home,
  });
  const response = await fetch(endpoint + '/api/state', {
    headers: { Authorization: 'Bearer ' + Object.keys(fixture.cfg.tokens)[0] },
    signal: AbortSignal.timeout(10000),
  });
  assert.equal(response.status, 200);
  const state = await response.json();
  assert.deepEqual(
    Object.values(state.boards).map(board => [board.id, board.displayName]),
    before.boards.map(board => [board.id, board.displayName]),
    'page discovery preserves labels and order',
  );
  const hidden = await fetch(endpoint + '/api/registry/context', { signal: AbortSignal.timeout(10000) });
  assert.deepEqual(await hidden.json(), { enabled: false }, 'existing hosts never get a setup prompt');
  assert.equal((await manager('stop')).code, 0);
  assert.deepEqual(snapshot(fixture.home), before, 'deployment preserves every card, role, lane and shift clock');
  const operators = await updateOperators(root, endpoint);
  assert.deepEqual(snapshot(fixture.home), before, 'kit updates cannot modify the board store');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(safety, 'store.json'))).cards, before.cards);
  return {
    fixtureOnly: true,
    backupVerified: true,
    profilePreserved: true,
    schema: 2,
    deployPreserved: true,
    boardCount: before.boards.length,
    cardCount: Object.keys(before.cards).length,
    operators,
  };
}
if (require.main === module) {
  const cleanup = [];
  rehearse({ after: callback => cleanup.push(callback) })
    .then(
      result => console.log(JSON.stringify(result)),
      () => {
        console.error('Fixture upgrade rehearsal failed; inspect the focused regression.');
        process.exitCode = 1;
      },
    )
    .finally(async () => {
      for (const callback of cleanup.reverse()) await callback();
    });
}
module.exports = { rehearse };
