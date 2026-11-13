'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { fixture, write } = require('../../verification/activation-fixture.cjs');
const { flow } = require('../../verification/activation-flow.cjs');
const storage = require('../../operator-kit/scripts/dispatch-storage.cjs');

for (const stage of ['written', 'flushed', 'renamed', 'committed', 'ack']) {
  test('CrashRetrySafe + ShiftContinuous + NamedBoardOnly at every protocol step: ' + stage, async context => {
    const host = await fixture(context);
    const protocol = flow(host, 'harbor', stage);
    const baseline = host.disk();
    const first = await protocol.register('session-original');
    const second = await protocol.register('session-successor');
    const third = await protocol.register('session-recovery');
    await protocol.acquire(first);
    const attached = await protocol.attach(first, 1);
    const journal = storage.inventory(attached.home, 'harbor');
    await protocol.send(
      'activation',
      {
        action: 'inventory',
        ...journal,
        complete: false,
        gaps: ['independent fixture gap'],
      },
      first,
      1,
    );
    await protocol.send('activation', {
      action: 'resolve-gap',
      expectedEpoch: 1,
      journalId: journal.journalId,
      independent: true,
      evidence: 'Independent fixture records account for the gap',
    });
    const migration = { id: host.id(), hash: storage.hash(journal), parts: 2 };
    for (const index of [0, 1]) {
      await protocol.send(
        'activation',
        {
          action: 'inventory',
          ...journal,
          migration: { ...migration, index },
        },
        first,
        1,
      );
      const census = (await host.request('harbor', 'activation', null, host.owner, undefined, 'GET')).body;
      assert.equal(census.ready, index === 1, 'NoPartialMigration: all pages must durably commit');
      const inventory = host.disk().dispatchLedger.boards.harbor.inventories[journal.journalId];
      assert.equal(inventory.resolved, index === 1, 'old gap approval never bypasses missing pages');
    }
    const abandonedJournalId = host.id();
    const abandonedMigrationId = host.id();
    await protocol.send(
      'activation',
      {
        action: 'inventory',
        ...journal,
        journalId: abandonedJournalId,
        migration: { id: abandonedMigrationId, hash: storage.hash(journal), parts: 2, index: 0 },
      },
      first,
      1,
    );
    await protocol.send('activation', {
      action: 'resolve-gap',
      expectedEpoch: 1,
      journalId: abandonedJournalId,
      abandonMigrationId: abandonedMigrationId,
      independent: true,
      evidence: 'Independent fixture review accounts for the missing migration pages',
    });
    const abandoned = host.disk().dispatchLedger.boards.harbor.inventories[abandonedJournalId];
    assert.equal(abandoned.resolved, true);
    assert.equal(abandoned.abandonedMigration.id, abandonedMigrationId);
    await protocol.activate();
    assert.equal(host.disk().handoffActivation.boards.studio, undefined, 'only named board activated');
    await protocol.planned(first, second, 1);
    const returning = await host.request(
      'harbor',
      'calls',
      {
        calls: [{ id: host.id(), tool: 'board_post', args: { card: 'card-harbor', text: 'returning predecessor' } }],
      },
      first.credential,
      1,
    );
    assert.equal(returning.status, 409, 'SingleActor: returning predecessor is fenced');
    await protocol.recover(third, 2);
    const view = await protocol.status(third, 3);
    assert.equal(view.ownership.phase, 'working', 'RecoveryRequiresOwner: approved successor picks up');
    assert.equal(view.ownership.epoch, 3, 'EachAcceptanceOnce: retries never advance the epoch twice');
    const transferId = host.id();
    await protocol.send(
      'handoff',
      { action: 'prepare', expectedEpoch: 3, successorSessionId: second.sessionId, transferId },
      third,
      3,
    );
    const pendingDigest = (await protocol.status()).pending.digest;
    await protocol.send('handoff', { action: 'cancel', expectedEpoch: 3, transferId, pendingDigest }, third, 3);
    await protocol.deactivate();
    const after = host.disk();
    assert.equal(after.sessionOwnership.boards.harbor.enforced, false, 'Deactivation restores legacy authority');
    assert.deepEqual(after.cards, baseline.cards, 'all accepted obligations survive');
    assert.deepEqual(after.comments, baseline.comments, 'all asks survive');
    for (const board of ['studio', 'ledger'])
      assert.deepEqual(after.boards[board], baseline.boards[board], 'inactive tools and line boards stay untouched');
    assert.equal(after.boards.harbor.shift.since, baseline.boards.harbor.shift.since, 'shift start never resets');
    assert.equal(after.boards.harbor.shift.id, baseline.boards.harbor.shift.id, 'shift identity never changes');
    assert.equal(after.boards.harbor.shift.state, 'on', 'handoff and recovery never end the shift');
    assert.ok(protocol.events.includes('activation:activate'));
    assert.ok(protocol.events.includes('handoff:checkpoint'));
    assert.ok(protocol.events.includes('handoff:recover'));
    assert.ok(protocol.events.includes('activation:deactivate'));
  });
}

test('StaleAttachmentCannotDisappearFromReadinessByWaiting', async context => {
  const host = await fixture(context);
  const protocol = flow(host);
  const first = await protocol.register('session-original');
  await protocol.acquire(first);
  const attached = await protocol.attach(first, 1);
  await host.stop();
  const stored = host.disk();
  stored.sessionOwnership.boards.harbor.processes[attached.processId].seenAt = Date.now() - 180001;
  write(path.join(host.home, 'store.json'), stored);
  await host.start();
  const view = (await host.request('harbor', 'activation', null, host.owner, undefined, 'GET')).body;
  assert.equal(view.ready, false);
  assert.ok(view.processIds.includes(attached.processId), 'stale process remains in explicit census');
  assert.ok(view.blockers.includes(attached.processId + ':reconnect-or-detach-stale-process'));
  assert.equal(
    (
      await host.request('harbor', 'activation', {
        action: 'activate',
        operationId: host.id(),
        expectedEpoch: view.epoch,
        readiness: view.readiness,
        processIds: [],
        confirmAllWriters: true,
      })
    ).status,
    409,
  );
});
