'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { input } = require('../server/tests/handoff-fixture');
const storage = require('../operator-kit/scripts/dispatch-storage.cjs');

function flow(host, board = 'harbor', stage) {
  const sessions = new Map();
  const events = [];
  const send = async (service, body, actor, epoch) => {
    const command = { operationId: host.id(), ...body };
    const result = stage
      ? await host.inject(stage, board, service, command, actor?.credential || host.owner, epoch)
      : await host.ok(board, service, command, actor?.credential || host.owner, epoch);
    events.push(service + ':' + body.action);
    return result;
  };
  async function register(name, machineId = 'fixture-original') {
    const session = { sessionId: name, credential: crypto.randomBytes(32).toString('base64url') };
    await send('ownership', {
      action: 'register',
      ...session,
      installationId: 'installation-' + board,
      principal: board + '-operator',
      location: {
        machineId,
        homeId: 'home-' + board,
        targetId: 'firstmate',
        targetInstallationId: 'installation-' + board,
        routeHash: 'a'.repeat(64),
      },
    });
    sessions.set(name, session);
    return session;
  }
  async function acquire(session) {
    const nominationId = host.id();
    await send('ownership', {
      action: 'nominate',
      sessionId: session.sessionId,
      expectedEpoch: 0,
      nominationId,
      expiresAt: Date.now() + 600000,
    });
    await send('ownership', { action: 'acquire', nominationId, expectedEpoch: 0 }, session);
  }
  async function attach(session, epoch) {
    const home = path.join(host.root, session.sessionId);
    fs.mkdirSync(home, { recursive: true });
    require('../server/registry-files').protect(home, true);
    const journal = storage.inventory(home, board);
    await send('activation', { action: 'inventory', ...journal }, session, epoch);
    const processId = host.id();
    await send(
      'ownership',
      {
        action: 'attach',
        processId,
        protocol: 'session-epochs-v1',
        kitVersion: 'handoff-activation-v1',
        loadedMcp: 'a'.repeat(64),
        installedMcp: 'a'.repeat(64),
        capabilities: ['dispatch-ledger-v1'],
        journalVersion: 1,
        journalId: journal.journalId,
      },
      session,
      epoch,
    );
    return { home, processId };
  }
  async function activate() {
    const view = (await host.request(board, 'activation', null, host.owner, undefined, 'GET')).body;
    assert.equal(view.ready, true, JSON.stringify(view.blockers));
    await send('activation', {
      action: 'activate',
      expectedEpoch: view.epoch,
      readiness: view.readiness,
      processIds: view.processIds,
      confirmAllWriters: true,
    });
  }
  const status = async (session, epoch) =>
    (await host.request(board, 'handoff', null, session?.credential || host.owner, epoch, 'GET')).body;
  async function pickup(session, epoch, transferId) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const read = await send('handoff', { action: 'read', transferId }, session, epoch);
      try {
        await send(
          'handoff',
          { action: 'pickup', transferId, readId: read.readId, revision: read.revision },
          session,
          epoch,
        );
        return;
      } catch (error) {
        if (stage || attempt === 2 || !error.message.includes('board changed; reread all current state and changes'))
          throw error;
      }
    }
  }
  async function accept(session, epoch, transferId) {
    const read = await send('handoff', { action: 'read', transferId }, session, epoch);
    await send('handoff', { action: 'accept', transferId, expectedEpoch: epoch, readId: read.readId }, session, epoch);
    await pickup(session, epoch + 1, transferId);
    await attach(session, epoch + 1);
  }
  async function planned(first, second, epoch, degraded = false) {
    const transferId = host.id();
    await send(
      'handoff',
      { action: 'prepare', expectedEpoch: epoch, successorSessionId: second.sessionId, transferId },
      first,
      epoch,
    );
    const checkpoint = input();
    checkpoint.targetBinding = { id: 'firstmate', installationId: 'installation-' + board, freshness: 'fresh' };
    await send('handoff', { action: 'checkpoint', transferId, checkpoint }, first, epoch);
    await send('handoff', { action: 'seal', transferId, degraded }, first, epoch);
    await accept(second, epoch, transferId);
    return transferId;
  }
  async function recover(second, epoch) {
    const view = await status();
    const transferId = host.id();
    const approval = {
      action: 'recover',
      transferId,
      expectedEpoch: epoch,
      successorSessionId: second.sessionId,
      reason: 'Fixture owner approves this specific lost process',
      oldDiskAvailable: true,
      pendingDigest: view.pending.digest,
      revoke: true,
    };
    const denied = await host.request(
      board,
      'handoff',
      { ...approval, operationId: host.id() },
      second.credential,
      epoch,
    );
    assert.equal(denied.status, 403, 'a successor cannot self-authorize recovery');
    await send('handoff', approval);
    await accept(second, epoch, transferId);
    await send('dispatch-ledger', {
      action: 'resolve-gap',
      journalId: 'recovery-' + transferId,
      independent: true,
      evidence: 'Fixture owner checked both scratch journals and external route records',
    });
    return transferId;
  }
  async function deactivate() {
    const view = (await host.request(board, 'activation', null, host.owner, undefined, 'GET')).body;
    await send('activation', {
      action: 'deactivate',
      expectedEpoch: view.epoch,
      confirmQuiesced: true,
      processIds: view.attachedProcessIds,
    });
  }
  return { send, register, acquire, attach, activate, planned, recover, deactivate, status, events, sessions };
}
module.exports = { flow };
