'use strict';
require('../../tests/sandbox.cjs');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { makeRegistry, digest, secret } = require('../registry');
const { makeEnrollment } = require('../enrollment');
const { makeLifecycle } = require('../registry-lifecycle');

function fixture(test, options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-registry-'));
  if (options.cleanup !== false) test.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const configPath = path.join(directory, 'config.json');
  const cfg = {
    profile: 'core',
    ownerId: 'captain',
    enrollment: { enabled: true },
    tokens: { fixtureLegacy: { name: 'captain', via: 'page' } },
    boards: {
      alpha: {
        name: 'Alpha',
        protocol: 'tools',
        order: 20,
        access: { captain: 'owner', reader: 'viewer' },
        steward: true,
      },
      hidden: { name: 'Hidden', protocol: 'lines', order: 2, access: { second: 'owner' } },
    },
    ...options.cfg,
  };
  fs.writeFileSync(configPath, JSON.stringify(cfg));
  const registry = makeRegistry(cfg, configPath, { initialize: true, ...options });
  fs.writeFileSync(path.join(directory, 'store.json'), JSON.stringify({ schemaVersion: 2 }));
  registry.attach();
  const enrollment = makeEnrollment(registry, cfg, options);
  const store = { seq: 0, boards: {}, cards: {}, comments: {}, changes: [], tickets: {} };
  registry.ensureBoards(store);
  const ctx = { cfg, CONFIG_PATH: configPath, registry, enrollment, store, saveNow: () => {} };
  ctx.lifecycle = makeLifecycle(registry, ctx);
  let adminFile;
  enrollment.bootstrap('host-administrator', value => {
    adminFile = value;
  });
  const admin = enrollment.authenticate(adminFile.credential);
  return { ...ctx, directory, configPath, adminFile, admin };
}

function grantFor(ctx, changes = {}) {
  const prepared = {
    installationId: crypto.randomUUID(),
    operationId: crypto.randomUUID(),
    proof: secret(),
    credential: secret(),
  };
  const input = {
    ...changes,
    proofVerifier: digest(prepared.proof),
    scope: {
      action: 'bind',
      boardId: 'alpha',
      principal: 'installer',
      role: 'operator',
      protocol: 'tools',
      installationId: prepared.installationId,
      ...changes.scope,
    },
  };
  let handoff;
  ctx.enrollment.issue(ctx.admin, input, value => {
    handoff = value;
  });
  return { ...prepared, grant: handoff.grant, scope: handoff.scope };
}

module.exports = { fixture, grantFor };
