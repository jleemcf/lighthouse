'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

function ownershipFixture(context, fault) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ownership-'));
  const cfg = {
    boards: {
      tools: { protocol: 'tools', access: { captain: 'owner', operator: 'operator' } },
      lines: { protocol: 'lines', access: { captain: 'owner', operator: 'operator' } },
    },
  };
  const ctx = { cfg, CONFIG_PATH: path.join(home, 'config.json'), storeFault: fault };
  Object.assign(ctx, require('../store')(ctx));
  Object.assign(ctx, require('../web')(ctx));
  ctx.ownership = require('../ownership')(ctx);
  ctx.mutations = require('../mutation-routes')(ctx);
  const captain = { name: 'captain', via: 'page' };
  const control = (body, who = captain, board = 'tools') =>
    ctx.ownership.control(board, who, { operationId: crypto.randomUUID(), ...body });
  function register(sessionId, scope = 'operator', installationId = 'install-test') {
    const credential = crypto.randomBytes(32).toString('base64url');
    control({ action: 'register', sessionId, installationId, credential, principal: 'operator', scope });
    return ctx.ownership.authenticate(credential);
  }
  function nominate(sessionId, epoch = ctx.ownership.record('tools').epoch) {
    const nominationId = crypto.randomUUID();
    control({ action: 'nominate', sessionId, expectedEpoch: epoch, nominationId, expiresAt: Date.now() + 60000 });
    return nominationId;
  }
  function acquire(who, epoch = ctx.ownership.record('tools').epoch, nominationId = nominate(who.sessionId)) {
    const body = { action: 'acquire', expectedEpoch: epoch, nominationId, operationId: crypto.randomUUID() };
    control(body, who);
    who.epoch = epoch + 1;
    return body;
  }
  function activate(who) {
    const processId = crypto.randomUUID();
    control({ action: 'attach', processId, protocol: 'session-epochs-v1' }, who);
    control({ action: 'activate', confirmAllWriters: true, processIds: [processId] });
    return processId;
  }
  context.after(() => {
    try {
      ctx.saveNow();
    } catch {}
    fs.rmSync(home, { recursive: true, force: true });
  });
  return { ctx, home, control, register, nominate, acquire, activate, captain };
}

module.exports = { ownershipFixture };
