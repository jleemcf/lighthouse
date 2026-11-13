'use strict';
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { openFiles } = require('./registry-files');
const access = require('./access');

const digest = value => crypto.createHash('sha256').update(String(value)).digest('hex');
const secret = () => crypto.randomBytes(32).toString('base64url');
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const roles = Object.keys(access.ranks);
const protocols = ['lines', 'tools'];
const safeKey = value =>
  typeof value === 'string' &&
  value.length > 0 &&
  value.length <= 160 &&
  !['__proto__', 'constructor', 'prototype'].includes(value);

function separate(value) {
  const visible = {},
    hidden = {};
  for (const [key, item] of Object.entries(value || {})) {
    if (!safeKey(key)) throw fail('invalid setting name');
    if (/token|secret|password|credential|api.?key/i.test(key)) hidden[key] = item;
    else if (item && typeof item === 'object' && !Array.isArray(item)) {
      const [publicPart, privatePart] = separate(item);
      visible[key] = publicPart;
      if (Object.keys(privatePart).length) hidden[key] = privatePart;
    } else if (Array.isArray(item) && /token|secret|password|credential|api.?key/i.test(JSON.stringify(item)))
      hidden[key] = item;
    else visible[key] = item;
  }
  return [visible, hidden];
}

function definition(id, input, index = 0, imported = false, legacy = false) {
  if (!legacy && (!safeKey(id) || !/^[A-Za-z0-9_-]+$/.test(id))) throw fail('invalid board id');
  const members = structuredClone(input.access || {});
  for (const [principal, role] of Object.entries(members))
    if (!legacy && (!safeKey(principal) || !access.valid(role))) throw fail('invalid board member');
  const owner = Object.entries(members).find(([, role]) => access.hasRole(role, 'owner'))?.[0] || null;
  if (!imported && !owner) throw fail('a new board requires an owner');
  const protocol = input.protocol || (imported ? 'lines' : 'tools');
  if (!legacy && !protocols.includes(protocol)) throw fail('invalid board protocol');
  const name = input.name || id;
  if (!legacy && (typeof name !== 'string' || !name.trim() || name.length > 200)) throw fail('invalid board name');
  const settings = { ...input };
  for (const field of ['id', 'name', 'displayName', 'order', 'access', 'protocol']) delete settings[field];
  const [features, privateSettings] = separate(settings);
  return [
    {
      id,
      name,
      displayName: input.displayName || name,
      order: Number.isFinite(input.order) ? input.order : index,
      owner,
      members,
      protocol,
      lifecycle: 'active',
      version: 1,
      features,
    },
    privateSettings,
  ];
}

function makeRegistry(cfg, configPath, options = {}) {
  const bootstrap = structuredClone(cfg.boards || {});
  const defaults = structuredClone(cfg.defaultRole || {});
  const storeFile = path.resolve(path.dirname(configPath), cfg.storeFile || 'store.json');
  const schema = require('./release-check').storeState(storeFile).schema;
  if (![1, 2, 3, 4, 5].includes(schema)) throw fail('unsupported store schema', 503);
  const registryExists = fs.existsSync(path.join(storeFile + '.registry', 'current.json'));
  const required =
    schema === 2 ||
    (schema >= 3 && fs.existsSync(storeFile + '.registry')) ||
    (schema >= 4 && JSON.parse(fs.readFileSync(storeFile, 'utf8')).dispatchLedger?.registryRequired === true);
  const persistent = options.initialize || required;
  if (required && !registryExists)
    throw fail('schema 2 requires its durable registry; restore the matching registry backup', 503);
  const initial = () => {
    const state = {};
    state.metadata = { format: 1, hostId: crypto.randomUUID(), imported: true, boards: {}, defaultRole: defaults };
    state.credentials = { format: 1, admins: {}, grants: {}, installations: {}, operations: {}, boardSettings: {} };
    for (const [index, [id, input]] of Object.entries(bootstrap).entries()) {
      const [record, privateSettings] = definition(id, input, index, true, !persistent);
      state.metadata.boards[id] = record;
      state.credentials.boardSettings[id] = privateSettings;
    }
    return state;
  };
  const memory = persistent ? null : initial();
  const files = persistent
    ? openFiles(storeFile + '.registry', options.fault)
    : {
        current: () => memory,
        read: () => memory,
        transact: () => {
          throw fail('offline registry migration required', 409);
        },
      };
  if (persistent && !files.read()) files.transact(state => Object.assign(state, initial()));
  const metadata = () => files.current().metadata;
  const credentials = () => files.current().credentials;
  const board = id => (Object.hasOwn(metadata().boards, id) ? metadata().boards[id] : null);
  let projectionState, projected;
  function projection() {
    const current = files.current();
    if (projectionState === current) return projected;
    projectionState = current;
    projected = Object.fromEntries(
      Object.values(current.metadata.boards).map(record => [
        record.id,
        {
          ...require('./configuration').merge(record.features, current.credentials.boardSettings[record.id] || {}),
          name: record.name,
          displayName: record.displayName,
          order: record.order,
          protocol: record.protocol,
          access: record.members,
          lifecycle: record.lifecycle,
          ...(record.lifecycle === 'archived' ? { steward: false } : {}),
        },
      ]),
    );
    return projected;
  }
  function attach() {
    Object.defineProperty(cfg, 'boards', { configurable: true, get: projection });
    Object.defineProperty(cfg, 'defaultRole', { configurable: true, get: () => metadata().defaultRole });
  }
  function ensureBoards(store) {
    for (const record of Object.values(metadata().boards)) {
      store.boards[record.id] ||= {
        id: record.id,
        shift: { state: 'off', operator: null, since: null, lastSeen: null },
        activity: [],
      };
      Object.assign(store.boards[record.id], {
        name: record.name,
        machine: record.features.machine || '',
        project: record.features.project || '',
      });
    }
  }
  function reconcile() {
    const changes = [];
    for (const id of new Set([...Object.keys(bootstrap), ...Object.keys(metadata().boards)])) {
      let candidate, privateSettings;
      try {
        if (bootstrap[id])
          [candidate, privateSettings] = definition(id, bootstrap[id], Object.keys(bootstrap).indexOf(id), true);
      } catch {
        changes.push({ id, kind: 'invalid-configuration', fields: ['definition'] });
        continue;
      }
      const current = board(id);
      if (!candidate || !current) changes.push({ id, kind: current ? 'registry-only' : 'configuration-only' });
      else {
        const fields = ['name', 'displayName', 'order', 'owner', 'members', 'protocol', 'features'];
        const different = fields.filter(field => JSON.stringify(candidate[field]) !== JSON.stringify(current[field]));
        if (JSON.stringify(privateSettings) !== JSON.stringify(credentials().boardSettings[id] || {}))
          different.push('credentialSettings');
        if (different.length) changes.push({ id, kind: 'different', fields: different });
      }
    }
    if (JSON.stringify(defaults) !== JSON.stringify(metadata().defaultRole))
      changes.push({ kind: 'different', fields: ['defaultRole'] });
    return { hostId: metadata().hostId, changes };
  }
  return {
    files,
    persistent: !!persistent,
    metadata,
    credentials,
    board,
    projection,
    attach,
    ensureBoards,
    reconcile,
    refresh: () => files.read(),
    transact: files.transact,
  };
}

module.exports = { makeRegistry, definition, digest, secret, fail, safeKey, roles, protocols };
