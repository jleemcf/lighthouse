'use strict';
const crypto = require('node:crypto');
const { ownershipFixture } = require('./ownership-fixture');

function input() {
  const fresh = value => ({ freshness: 'fresh', observedAt: Date.now() - 1000, value });
  return {
    version: 1,
    goal: fresh('Continue the accepted work'),
    nextStep: fresh('Read current asks'),
    decisions: fresh([]),
    constraints: fresh([]),
    commitments: fresh([]),
    queue: fresh([]),
    relays: fresh([]),
    helpers: fresh([]),
    cursors: fresh([]),
    targetBinding: { id: 'target-original', installationId: 'install-test', freshness: 'fresh' },
  };
}
function handoffFixture(context, fault) {
  const fixture = ownershipFixture(context, fault);
  const { ctx } = fixture;
  const first = fixture.register('session-first');
  const second = fixture.register('session-second');
  fixture.acquire(first);
  const processId = fixture.activate(first);
  ctx.cfg.boards.tools.handoffEnabled = true;
  ctx.handoff = require('../handoff')(ctx);
  ctx.store.boards.tools.shift = { id: 'continuous-shift', state: 'on', since: '2026-01-01T00:00:00Z' };
  const transferId = crypto.randomUUID();
  const body = (action, extra = {}) => ({ operationId: crypto.randomUUID(), action, transferId, ...extra });
  const run = (action, extra = {}, who = first) => ctx.handoff.control('tools', who, body(action, extra));
  const prepare = () => run('prepare', { expectedEpoch: 1, successorSessionId: second.sessionId });
  const save = (value = input()) => run('checkpoint', { checkpoint: value });
  const seal = (degraded = false) => run('seal', { degraded });
  const read = (who = second) => run('read', {}, who);
  const accept = () => {
    const { readId } = read();
    const request = body('accept', { readId, expectedEpoch: 1 });
    const result = ctx.handoff.control('tools', second, request);
    second.epoch = 2;
    return { request, result };
  };
  const pickup = (who = second) => {
    const { readId, revision } = read(who);
    return run('pickup', { readId, revision }, who);
  };
  return { ...fixture, first, second, processId, transferId, body, run, prepare, save, seal, read, accept, pickup };
}
module.exports = { handoffFixture, input };
