'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { fixture } = require('./registry-fixture');
const { makeRegistry } = require('../registry');
const { makeWeb } = (() => ({ makeWeb: require('../web') }))();

test('schema-1 projection tolerates legacy values while durable import validates them', context => {
  const ctx = fixture(context);
  const boards = {
    'old.board': { access: { captain: 'owner' } },
    unknownRole: { access: { reader: 'legacy-role' } },
    unknownProtocol: { protocol: 'legacy-protocol' },
    longName: { name: 'Legacy'.repeat(40) },
  };
  const cfg = { boards, storeFile: 'unmigrated.json' };
  const registry = makeRegistry(cfg, ctx.configPath);
  registry.attach();
  assert.equal(registry.persistent, false);
  assert.equal(cfg.boards['old.board'].access.captain, 'owner');
  assert.equal(cfg.boards.unknownRole.access.reader, 'legacy-role');
  assert.equal(cfg.boards.unknownProtocol.protocol, 'legacy-protocol');
  assert.equal(cfg.boards.longName.name, boards.longName.name);
  assert.equal(require('../web')({ cfg }).roleOn({ name: 'reader' }, 'unknownRole'), 0);
  for (const [id, input] of Object.entries(boards))
    assert.throws(() => require('../registry').definition(id, input, 0, true), /invalid board/);
});

test('registry imports identities, roles, order, protocols and feature settings exactly once', context => {
  const ctx = fixture(context, {
    cfg: {
      boards: {
        alpha: {
          name: 'Alpha',
          displayName: 'Short',
          order: 8,
          protocol: 'lines',
          access: { captain: 'owner', helper: 'watch' },
          steward: true,
          integration: { enabled: true, apiKey: 'synthetic-private-value' },
        },
        beta: { name: 'Beta', access: { other: 'owner' } },
      },
      defaultRole: { audience: 'viewer' },
    },
  });
  const before = structuredClone(ctx.registry.metadata());
  assert.equal(before.boards.alpha.id, 'alpha');
  assert.equal(before.boards.alpha.owner, 'captain');
  assert.equal(before.boards.alpha.members.helper, 'watch');
  assert.equal(before.boards.beta.protocol, 'lines');
  assert.equal(before.boards.alpha.order, 8);
  assert.equal(before.boards.alpha.features.steward, true);
  assert.ok(!JSON.stringify(before).includes('synthetic-private-value'));
  assert.ok(ctx.cfg.boards.alpha.integration.apiKey === 'synthetic-private-value');
  const changed = { boards: { alpha: { name: 'Overwritten', protocol: 'tools', access: { attacker: 'owner' } } } };
  const reopened = makeRegistry(changed, ctx.configPath);
  assert.deepEqual(reopened.metadata(), before);
  assert.deepEqual(reopened.projection().alpha.access, { captain: 'owner', helper: 'watch' });
  const pointer = fs.readFileSync(path.join(reopened.files.directory, 'current.json'), 'utf8');
  assert.ok(reopened.reconcile().changes.some(item => item.fields?.includes('members')));
  assert.equal(fs.readFileSync(path.join(reopened.files.directory, 'current.json'), 'utf8'), pointer);
});

test('owning one board never confers host-wide administration or ownership of another board', context => {
  const ctx = fixture(context),
    owner = { name: 'captain' };
  assert.throws(() => ctx.lifecycle.change(owner, 'create', { board: {} }), /host administrator/);
  assert.throws(() => ctx.lifecycle.change(owner, 'rename', { id: 'hidden', name: 'Wrong' }), /board owner/);
  assert.throws(() => ctx.lifecycle.change(owner, 'reconcile', {}), /host administrator/);
  assert.throws(
    () =>
      ctx.lifecycle.change(
        { name: 'captain', board: 'alpha', installationId: 'restricted', installationRole: 'viewer' },
        'rename',
        { id: 'alpha', name: 'Wrong' },
      ),
    /board owner/,
  );
  const old = structuredClone(ctx.store.boards.alpha);
  ctx.store.cards.original = { id: 'original', board: 'alpha', title: 'Original', by: 'original-author' };
  ctx.lifecycle.change(owner, 'rename', { id: 'alpha', name: 'Renamed' });
  ctx.lifecycle.change(owner, 'reorder', { id: 'alpha', order: -10 });
  ctx.registry.ensureBoards(ctx.store);
  assert.equal(ctx.store.boards.alpha.id, old.id);
  assert.deepEqual(ctx.store.boards.alpha.shift, old.shift);
  assert.equal(ctx.cfg.boards.alpha.name, 'Renamed');
  assert.equal(ctx.cfg.boards.alpha.order, -10);
  assert.equal(ctx.registry.board('alpha').version, 3);
  assert.equal(ctx.store.cards.original.by, 'original-author');
  assert.throws(() => ctx.enrollment.bootstrap('second-admin', () => {}), /already bootstrapped/);
});

test('registry refresh observes another writer and caches each generation projection', context => {
  const ctx = fixture(context);
  const readFile = fs.readFileSync;
  let pointerReads = 0;
  context.mock.method(fs, 'readFileSync', (file, ...args) => {
    if (file === path.join(ctx.registry.files.directory, 'current.json')) pointerReads++;
    return readFile(file, ...args);
  });
  const cached = ctx.cfg.boards;
  assert.equal(ctx.cfg.boards, cached);
  ctx.registry.board('alpha');
  ctx.registry.credentials();
  assert.equal(pointerReads, 0);
  const other = makeRegistry({}, ctx.configPath);
  const lifecycle = require('../registry-lifecycle').makeLifecycle(other);
  lifecycle.change(ctx.admin, 'rename', { id: 'alpha', name: 'Local change' });
  const before = ctx.cfg.boards;
  assert.equal(ctx.cfg.boards, before);
  ctx.registry.refresh();
  assert.notEqual(ctx.cfg.boards, before);
  assert.equal(ctx.registry.board('alpha').name, 'Local change');
  assert.equal(ctx.cfg.boards.alpha.name, 'Local change');
  const enrollment = require('../enrollment').makeEnrollment(other, ctx.cfg);
  const request = require('./registry-fixture').grantFor(ctx);
  enrollment.consume(request);
  ctx.registry.refresh();
  assert.equal(ctx.enrollment.authenticate(request.credential).installationId, request.scope.installationId);
  enrollment.installation(ctx.admin, 'revoke', { installationId: request.scope.installationId });
  ctx.registry.refresh();
  assert.equal(ctx.enrollment.authenticate(request.credential), null);
});

test('archive needs a fresh preview and refuses each active or unresolved obligation', context => {
  const ctx = fixture(context),
    owner = { name: 'captain' };
  const cases = [
    () => {
      ctx.store.boards.alpha.shift = { state: 'on', operator: 'worker' };
    },
    () => {
      ctx.store.stewardRequests = { job: { id: 'job', board: 'alpha', state: 'running' } };
    },
    () => {
      ctx.store.cards.card = { id: 'card', board: 'alpha', status: 'inflight' };
    },
    () => {
      ctx.store.comments.message = { id: 'message', board: 'alpha', handled: false };
    },
    () => {
      ctx.store.tickets.ticket = { id: 'ticket', board: 'alpha', used: false };
    },
    () => {
      ctx.store.cards.card = { id: 'card', board: 'alpha', status: 'done', decisions: [{ id: 'open' }] };
    },
    () => {
      ctx.store.authorities = { permission: { id: 'permission', board: 'alpha' } };
    },
    () => {
      ctx.store.cards.card = { id: 'card', board: 'alpha', status: 'done' };
      ctx.store.crm = { outbox: [{ cid: 'card' }] };
    },
  ];
  const empty = structuredClone(ctx.store);
  for (const add of cases) {
    for (const key of Object.keys(ctx.store)) delete ctx.store[key];
    Object.assign(ctx.store, structuredClone(empty));
    add();
    const preview = ctx.lifecycle.preview(owner, 'alpha');
    assert.throws(() => ctx.lifecycle.change(owner, 'archive', preview), /active ownership/);
    assert.throws(
      () =>
        ctx.lifecycle.change(owner, 'archive', {
          ...preview,
          disposition: { action: 'preserve', reason: 'retain records' },
        }),
      /active ownership/,
    );
    assert.equal(ctx.registry.board('alpha').lifecycle, 'active');
  }
  for (const add of cases) add();
  const preview = ctx.lifecycle.preview(ctx.admin, 'alpha');
  ctx.store.cards.second = { id: 'second', board: 'alpha', status: 'waiting' };
  assert.throws(() => ctx.lifecycle.change(ctx.admin, 'archive', preview), /preview changed/);
  const snapshot = structuredClone(ctx.store);
  ctx.lifecycle.change(ctx.admin, 'archive', {
    ...ctx.lifecycle.preview(ctx.admin, 'alpha'),
    disposition: { action: 'preserve', reason: 'park existing obligations intact' },
  });
  assert.deepEqual(ctx.store, snapshot);
  assert.equal(ctx.registry.board('alpha').lifecycle, 'archived');
  assert.equal(ctx.cfg.boards.alpha.steward, false);
  const web = makeWeb(ctx);
  assert.equal(web.roleOn(owner, 'alpha'), 1);
  assert.equal(web.roleOn({ name: 'reader' }, 'alpha'), 1);
  assert.equal(web.roleOn(owner, 'hidden'), 0);
  assert.throws(() => ctx.lifecycle.change(ctx.admin, 'delete', { id: 'alpha' }), /unknown lifecycle/);
  const created = ctx.lifecycle.change(ctx.admin, 'create', {
    board: { name: 'Alpha', access: { captain: 'owner' } },
  });
  assert.notEqual(created.id, 'alpha');
  assert.equal(ctx.registry.board(created.id).protocol, 'tools');
  assert.equal(ctx.registry.board('alpha').lifecycle, 'archived');
});

test('legacy credentials remain valid and configuration cannot silently change registry ACLs', context => {
  const ctx = fixture(context),
    web = makeWeb(ctx);
  const request = { headers: { authorization: 'Bearer fixtureLegacy' }, socket: { remoteAddress: '127.0.0.1' } };
  const owner = web.principalOf(request, {});
  assert.equal(owner.name, 'captain');
  assert.equal(owner.hostAdmin, undefined);
  assert.equal(web.roleOn(owner, 'alpha'), 4);
  assert.equal(web.roleOn(owner, 'hidden'), 0);
  assert.equal(web.roleOn({ name: 'reader' }, 'not-registered'), 0);
});
