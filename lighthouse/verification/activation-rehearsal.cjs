'use strict';
require('../tests/sandbox.cjs');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const { fixture } = require('./activation-fixture.cjs');
const { flow } = require('./activation-flow.cjs');
const kit = require('./activation-kit.cjs');
const { snapshot } = require('./upgrade-fixture.cjs');
const releases = require('../server/board-release');
const { gitArgs } = require('../../scripts/git-args.cjs');
const repository = path.resolve(__dirname, '../..');

function baseline(host) {
  if (
    spawnSync('git', [...gitArgs(repository), 'cat-file', '-e', 'd73401a^{commit}'], {
      stdio: 'pipe',
    }).status !== 0
  )
    return false;
  const source = path.join(host.root, 'today');
  const archive = path.join(host.root, 'today.tar');
  fs.mkdirSync(source);
  execFileSync(
    'git',
    [...gitArgs(repository), 'archive', '--format=tar', '--output', archive, 'd73401a', 'lighthouse/server'],
    { stdio: 'pipe' },
  );
  execFileSync('tar', ['-xf', archive, '-C', source], { stdio: 'pipe' });
  const server = path.join(source, 'lighthouse/server');
  for (const name of fs.readdirSync(server)) {
    if (name.endsWith('.js') || ['board.sh', 'release.json', 'rulings.json'].includes(name))
      fs.copyFileSync(path.join(server, name), path.join(host.home, name));
  }
  return true;
}
async function rehearsed(context) {
  const cleanup = [];
  context.after(async () => {
    for (const close of cleanup.reverse()) await close();
  });
  const host = await fixture({ after: close => cleanup.push(close) });
  await host.stop();
  const historical = baseline(host);
  await host.start();
  const initialActivation = await host.request('harbor', 'activation', null, host.owner, undefined, 'GET');
  if (historical) assert.equal(initialActivation.status, 404, 'historical baseline has no activation command');
  else {
    assert.equal(initialActivation.status, 200);
    assert.equal(initialActivation.body.enabled, false, 'fresh-history baseline starts in compatibility mode');
  }
  for (const board of ['harbor', 'studio']) {
    const legacy = await host.request(
      board,
      'calls',
      {
        calls: [
          {
            id: host.id(),
            tool: 'board_open',
            args: { title: 'Accepted work before the upgrade', slug: 'legacy-obligation', distinct: true },
          },
        ],
      },
      'legacy-' + board,
    );
    assert.equal(legacy.body.results[0].ok, true, JSON.stringify(legacy.body.results));
  }
  const before = snapshot(host.home);
  const originalConfig = fs.readFileSync(host.config);
  await host.stop();
  const stopManaged = async () => {
    const result = await require('../server/tests/deploy-fixture.cjs').run(
      'bash',
      [path.join(host.home, 'board.sh'), 'stop'],
      { env: { LH_HOME: host.home } },
    );
    assert.equal(result.code, 0, result.output);
  };
  cleanup.push(stopManaged);
  await releases.run({ action: 'deploy', source: path.resolve(__dirname, '../server'), home: host.home });
  await stopManaged();
  await host.start();
  assert.deepEqual(snapshot(host.home), before, 'code deployment changes no settings or work');
  assert.ok(originalConfig.equals(fs.readFileSync(host.config)), 'deployment never edits host configuration');
  const harbor = flow(host);
  async function retireLegacy(board) {
    const state = (await host.request(board, 'activation', null, host.owner, undefined, 'GET')).body;
    for (const process of state.processes.filter(value => value.protocol === 'legacy'))
      await host.ok(board, 'ownership', {
        action: 'detach',
        operationId: host.id(),
        expectedEpoch: state.epoch,
        processId: process.id,
        confirmStopped: true,
      });
  }
  const first = await harbor.register('session-original');
  const second = await harbor.register('session-successor');
  const third = await harbor.register('session-recovery');
  await harbor.acquire(first);
  const current = await kit.connect(host, 'harbor', first, 1, cleanup);
  await retireLegacy('harbor');
  const lineHome = kit.install(host, 'ledger', { sessionId: 'line-fixture' }, 'lines').home;
  const lineManifest = fs.readFileSync(path.join(lineHome, 'KIT-MANIFEST.json'));
  const inactive = host.disk();
  await harbor.activate();
  const transferId = host.id();
  const parse = async (client, tool, args) => JSON.parse(await client.call(tool, { operationId: host.id(), ...args }));
  await parse(current, 'board_transfer', {
    action: 'prepare',
    transferId,
    expectedEpoch: 1,
    successorSessionId: second.sessionId,
  });
  const checkpoint = require('../server/tests/handoff-fixture').input();
  checkpoint.targetBinding = { id: 'firstmate', installationId: 'installation-harbor', freshness: 'fresh' };
  await parse(current, 'board_checkpoint', { transferId, checkpoint });
  await parse(current, 'board_transfer', { action: 'seal', transferId, expectedEpoch: 1 });
  const successor = await kit.connect(host, 'harbor', second, 1, cleanup, true);
  const read = await parse(successor, 'board_pickup', { action: 'read', transferId });
  await parse(successor, 'board_transfer', { action: 'accept', transferId, expectedEpoch: 1, readId: read.readId });
  const pickup = await parse(successor, 'board_pickup', { action: 'read', transferId });
  await parse(successor, 'board_pickup', {
    action: 'pickup',
    transferId,
    readId: pickup.readId,
    revision: pickup.revision,
  });
  await current.close();
  await successor.close();
  await host.elapse(180001);
  await harbor.recover(third, 2);
  for (const board of ['studio', 'ledger'])
    assert.deepEqual(host.disk().boards[board], inactive.boards[board], 'first rollout leaves ' + board + ' untouched');
  assert.ok(
    lineManifest.equals(fs.readFileSync(path.join(lineHome, 'KIT-MANIFEST.json'))),
    'line-mode kit is not converted or updated by activation',
  );
  assert.equal(
    (await host.request('ledger', 'activation', { action: 'activate', operationId: host.id() })).status,
    409,
  );
  const studio = flow(host, 'studio');
  const other = await studio.register('session-studio');
  await studio.acquire(other);
  const otherClient = await kit.connect(host, 'studio', other, 1, cleanup);
  await retireLegacy('studio');
  assert.equal(host.disk().handoffActivation.boards.studio, undefined, 'second board waits for its own command');
  await studio.activate();
  await otherClient.close();
  await harbor.deactivate();
  await studio.deactivate();
  await host.stop();
  await host.start();
  const after = snapshot(host.home);
  for (const board of ['harbor', 'studio']) {
    assert.ok(
      Date.parse(after.shifts[board].lastSeen) >= Date.parse(before.shifts[board].lastSeen),
      'real tools may advance only heartbeat observation time',
    );
    for (const value of [before.shifts[board], after.shifts[board]]) {
      delete value.lastSeen;
      delete value.heartbeat;
    }
  }
  assert.deepEqual(after, before, 'rollback retains configuration, roles, CRM lane, all work and shift clocks');
  assert.ok(originalConfig.equals(fs.readFileSync(host.config)), 'activation never persists configuration switches');
  for (const board of ['harbor', 'studio']) {
    const view = (await host.request(board, 'activation', null, host.owner, undefined, 'GET')).body;
    assert.equal(view.enabled, false, 'compatibility mode survives restart');
    const state = await host.request(
      board,
      'calls',
      { calls: [{ id: host.id(), tool: 'board_status', args: {} }] },
      'legacy-' + board,
    );
    assert.equal(state.body.results[0].ok, true, 'original legacy writer works without re-setup');
  }
  return {
    fixtureOnly: true,
    from: historical ? 'd73401a' : 'current release in compatibility mode',
    toolsActivatedSequentially: 2,
    lineBoardsUntouched: 1,
    realMcp: true,
    plannedPickup: true,
    ownerRecovery: true,
    deactivationParity: true,
  };
}
if (require.main === module) {
  const cleanup = [];
  rehearsed({ after: close => cleanup.push(close) })
    .then(
      result => console.log(JSON.stringify(result)),
      error => {
        console.error(error);
        process.exitCode = 1;
      },
    )
    .finally(async () => {
      for (const close of cleanup.reverse()) await close();
    });
}
module.exports = { rehearsed };
