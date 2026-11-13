'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { copyRelease } = require('../server/board-release');
const { makeRegistry } = require('../server/registry');
const { normalize } = require('../server/configuration');
const write = (file, value) => fs.writeFileSync(file, JSON.stringify(value), { mode: 0o600 });

function create(root, port) {
  const home = path.join(root, 'host');
  copyRelease(path.resolve(__dirname, '../server'), home);
  const boards = {};
  for (const [index, id] of ['harbor', 'studio', 'ledger'].entries())
    boards[id] = {
      name: ['Harbor work', 'Studio work', 'Questions'][index],
      displayName: ['Harbor', 'Studio', 'Questions'][index],
      order: [40, 10, 70][index],
      protocol: index === 2 ? 'lines' : 'tools',
      machine: 'fixture-' + id,
      project: 'example-' + id,
      access: { captain: 'owner', [id + '-operator']: 'operator', observer: 'watch' },
      steward: index === 0,
    };
  const config = path.join(home, 'config.json');
  const cfg = {
    bind: '127.0.0.1',
    port,
    storeFile: 'store.json',
    boards,
    ownerId: 'captain',
    ownerName: 'the captain',
    timeZone: 'UTC',
    windowsTimeZone: 'UTC',
    defaultBoard: 'harbor',
    tokens: { 'synthetic-rehearsal-browser': { name: 'captain', via: 'page' } },
    crm: { board: 'ledger', pollSec: 90 },
    standingCards: ['standing'],
    cardDoorbells: [],
    trustTailscaleHeaders: false,
    jevEnabled: false,
  };
  write(config, cfg);
  const store = { seq: 12, boards: {}, cards: {}, comments: {}, changes: [], tickets: {} };
  for (const [index, id] of Object.keys(boards).entries()) {
    store.boards[id] = {
      id,
      name: boards[id].name,
      activity: [],
      shift: {
        state: 'off',
        operator: id + '-operator',
        since: '2026-01-02T12:00:00.000Z',
        lastSeen: '2026-01-02T12:30:00.000Z',
        mode: boards[id].protocol,
      },
    };
    const card = 'card-' + id;
    store.cards[card] = {
      id: card,
      board: id,
      title: boards[id].name + ' obligation',
      status: 'queued',
      lane: index === 2 ? 'crm' : 'work',
      decisions: [],
      log: [],
      createdAt: '2026-01-02T12:00:00.000Z',
      updatedAt: '2026-01-02T12:00:00.000Z',
      detail: 'Every original field remains.',
      custom: { keep: true },
    };
    store.comments['message-' + id] = {
      id: 'message-' + id,
      board: id,
      cardId: card,
      author: 'captain',
      text: 'Preserve this exact request.',
      handled: false,
      t: '2026-01-02T12:00:00.000Z',
    };
  }
  write(path.join(home, 'store.json'), store);
  const policy = fs.readFileSync(path.join(home, 'rulings.json'));
  fs.writeFileSync(path.join(root, 'fixture-policy.json'), policy);
  const profile = path.join(root, 'profile.json');
  write(profile, {
    server: { profile: 'fixture', weather: false, enrollment: { enabled: false } },
    policy: { file: 'fixture-policy.json', sha256: crypto.createHash('sha256').update(policy).digest('hex') },
  });
  return { home, config, cfg, profile };
}

function snapshot(home) {
  const config = path.join(home, 'config.json');
  const cfg = normalize(JSON.parse(fs.readFileSync(config)), config);
  const registry = makeRegistry(cfg, config);
  const records = Object.values(registry.metadata().boards).sort((left, right) => left.order - right.order);
  const store = JSON.parse(fs.readFileSync(path.join(home, cfg.storeFile)));
  return {
    boards: records.map(board => ({
      id: board.id,
      name: board.name,
      displayName: board.displayName,
      order: board.order,
      owner: board.owner,
      members: board.members,
      protocol: board.protocol,
      features: board.features,
    })),
    clocks: [cfg.timeZone, cfg.windowsTimeZone, cfg.timeZoneLabel],
    policies: crypto
      .createHash('sha256')
      .update(fs.readFileSync(path.resolve(home, cfg.rulingsFile || 'rulings.json')))
      .digest('hex'),
    lanes: { crm: cfg.crm, standingCards: cfg.standingCards, cardDoorbells: cfg.cardDoorbells },
    shifts: Object.fromEntries(Object.entries(store.boards).map(([id, board]) => [id, board.shift])),
    cards: store.cards,
    comments: store.comments,
  };
}
module.exports = { create, snapshot, write };
