'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fixture = require('./release-fixture');

module.exports = async function ownershipHttp(context, enforce = true, options = {}) {
  const board = await fixture(
    context,
    {
      cards: { 'beta-work': { id: 'beta-work', board: 'beta', title: 'Work', status: 'inflight' } },
      comments: { 'message-test': { id: 'message-test', board: 'beta', text: 'Question', by: 'owner' } },
      advice: { '0123456789abcdef': { id: '0123456789abcdef', board: 'beta', text: 'Fixture advice' } },
      ...options.initial,
    },
    'tools',
    {
      tokens: {
        OWNER: { name: 'owner', via: 'page' },
        CAPTAIN: { name: 'captain', via: 'page' },
        PAGE: { name: 'person', via: 'page' },
        TOOLS: { name: 'beta', mode: 'tools' },
        LEGACY: { name: 'beta', mode: 'lines' },
        COLLECTOR: { name: 'beta', mode: 'collector' },
        WATCH: { name: 'watch', mode: 'tools' },
        STEWARD: { name: 'steward', mode: 'steward', board: 'beta' },
      },
      boards: {
        alpha: { access: { owner: 'owner', beta: 'operator', watch: 'watch', ...options.alphaAccess } },
        beta: {
          protocol: 'tools',
          ...(options.handoffEnabled ? { handoffEnabled: true } : {}),
          ...(options.dispatchLedgerEnabled ? { dispatchLedgerEnabled: true } : {}),
          ...(options.recoveryEnabled ? { recoveryEnabled: true } : {}),
          access: {
            owner: 'owner',
            captain: 'owner',
            person: 'commenter',
            beta: 'operator',
            watch: 'watch',
            ...options.betaAccess,
          },
        },
      },
    },
  );
  const request = (method, route, body, credential, epoch, headers = {}) => {
    const bytes = Buffer.from(['GET', 'HEAD'].includes(method) ? '' : JSON.stringify(body || {}));
    return board.raw(
      method,
      route,
      bytes,
      {
        'Content-Type': 'application/json',
        'Content-Length': bytes.length,
        ...(epoch !== undefined ? { 'X-Lighthouse-Epoch': String(epoch) } : {}),
        ...headers,
      },
      credential || null,
    );
  };
  const journalId = crypto.randomUUID();
  const control = async (body, credential = 'CAPTAIN', epoch) =>
    request(
      'POST',
      '/api/boards/beta/ownership',
      {
        operationId: crypto.randomUUID(),
        ...(body.action === 'attach'
          ? {
              kitVersion: 'handoff-activation-v1',
              journalVersion: 1,
              loadedMcp: 'a'.repeat(64),
              installedMcp: 'a'.repeat(64),
              capabilities: ['dispatch-ledger-v1'],
              journalId,
            }
          : {}),
        ...body,
      },
      credential,
      epoch,
    );
  async function register(sessionId, scope = 'operator') {
    const credential = crypto.randomBytes(32).toString('base64url');
    const result = await control({
      action: 'register',
      sessionId,
      installationId: 'install-test',
      principal: 'beta',
      credential,
      scope,
      ...(scope === 'operator'
        ? {
            location: {
              machineId: 'machine-original',
              homeId: 'home-original',
              targetId: 'firstmate',
              targetInstallationId: 'install-test',
              routeHash: 'a'.repeat(64),
            },
          }
        : {}),
    });
    assert.equal(result.status, 200, result.raw);
    return credential;
  }
  async function acquire(sessionId, credential, epoch) {
    const active = (await request('GET', '/api/boards/beta/handoff', null, 'CAPTAIN')).body;
    if (active.enabled) {
      const transferId = crypto.randomUUID();
      const send = async (action, extra = {}, actor = first, expected = epoch) => {
        const result = await request(
          'POST',
          '/api/boards/beta/handoff',
          {
            operationId: crypto.randomUUID(),
            action,
            transferId,
            ...extra,
          },
          actor,
          expected,
        );
        assert.equal(result.status, 200, result.raw);
        return result.body;
      };
      await send('prepare', { successorSessionId: sessionId, expectedEpoch: epoch });
      const checkpoint = require('./handoff-fixture').input();
      checkpoint.targetBinding.id = 'firstmate';
      await send('checkpoint', { checkpoint });
      await send('seal', { degraded: true });
      const read = await send('read', {}, credential);
      await send('accept', { expectedEpoch: epoch, readId: read.readId }, credential);
      const pickup = await send('read', {}, credential, epoch + 1);
      return send('pickup', { readId: pickup.readId, revision: pickup.revision }, credential, epoch + 1);
    }
    const nominationId = crypto.randomUUID();
    assert.equal(
      (
        await control({
          action: 'nominate',
          sessionId,
          expectedEpoch: epoch,
          nominationId,
          expiresAt: Date.now() + 60000,
        })
      ).status,
      200,
    );
    const body = { action: 'acquire', expectedEpoch: epoch, nominationId, operationId: crypto.randomUUID() };
    const result = await control(body, credential, epoch);
    assert.equal(result.status, 200, result.raw);
    return body;
  }
  const firstSessionId = options.sessionId || 'session-first';
  const first = await register(firstSessionId);
  const collector = await register(firstSessionId, 'collector');
  const second = await register('session-second');
  await acquire(firstSessionId, first, 0);
  const processId = crypto.randomUUID();
  assert.equal((await control({ action: 'attach', processId, protocol: 'session-epochs-v1' }, first, 1)).status, 200);
  const activationRoute = '/api/boards/beta/activation';
  assert.equal(
    (
      await request(
        'POST',
        activationRoute,
        {
          action: 'inventory',
          operationId: crypto.randomUUID(),
          journalId,
          complete: true,
          calls: [],
          relays: [],
        },
        first,
        1,
      )
    ).status,
    200,
  );
  if (enforce) {
    const view = (await request('GET', activationRoute, null, 'CAPTAIN')).body;
    const body = {
      action: 'activate',
      operationId: crypto.randomUUID(),
      expectedEpoch: 1,
      confirmAllWriters: true,
      processIds: [processId],
      readiness: view.readiness,
    };
    const result = await request('POST', activationRoute, body, 'CAPTAIN');
    assert.equal(result.status, 200, result.raw);
  }
  return { ...board, request, control, register, acquire, first, second, collector, processId };
};
