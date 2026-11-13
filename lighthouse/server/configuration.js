'use strict';
const fs = require('node:fs');
const path = require('node:path');
const overlayPath = path.resolve(__dirname, '../../private/compatibility/profile.json');

function merge(base, patch) {
  const result = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    result[key] =
      value && typeof value === 'object' && !Array.isArray(value)
        ? merge(base[key] && typeof base[key] === 'object' ? base[key] : {}, value)
        : value;
  }
  return result;
}

function normalize(input, configPath) {
  let cfg = structuredClone(input);
  if (!cfg.profile && fs.existsSync(overlayPath)) {
    const profile = JSON.parse(fs.readFileSync(overlayPath, 'utf8'));
    const ids = Object.keys(cfg.boards || {}).sort();
    if (JSON.stringify(ids) === JSON.stringify([...profile.matchBoardIds].sort())) {
      cfg = merge(profile.server, cfg);
      const policy = input.rulingsFile && path.resolve(path.dirname(configPath || overlayPath), input.rulingsFile);
      if (!policy || !fs.existsSync(policy))
        cfg.rulingsFile = path.resolve(path.dirname(overlayPath), profile.policy.file);
    }
  }
  cfg.ownerId = cfg.ownerId || 'owner';
  cfg.ownerName = cfg.ownerName || 'the captain';
  if (
    cfg.ownerAliases !== undefined &&
    (!Array.isArray(cfg.ownerAliases) || cfg.ownerAliases.some(alias => typeof alias !== 'string' || !alias.trim()))
  )
    throw new Error('ownerAliases must be an array of non-empty strings');
  cfg.timeZone = cfg.timeZone || 'UTC';
  cfg.timeZoneLabel = cfg.timeZoneLabel || cfg.timeZone;
  cfg.windowsTimeZone = cfg.windowsTimeZone || 'UTC';
  new Intl.DateTimeFormat('en-US', { timeZone: cfg.timeZone });
  if (cfg.defaultBoard && !Object.hasOwn(cfg.boards || {}, cfg.defaultBoard))
    throw new Error('defaultBoard must name a configured board');
  if (cfg.crm?.base && (!cfg.crm.board || !Object.hasOwn(cfg.boards || {}, cfg.crm.board)))
    throw new Error('The question lane requires an explicit configured destination board');
  if (cfg.rulingsFile && configPath) cfg.rulingsFile = path.resolve(path.dirname(configPath), cfg.rulingsFile);
  return cfg;
}

const ownerId = cfg => cfg.ownerId || 'owner';
const isOwnerName = (cfg, name) =>
  name === ownerId(cfg) ||
  (Array.isArray(cfg.ownerAliases) && cfg.ownerAliases.some(alias => typeof alias === 'string' && alias === name));
const needsOwnerKind = cfg => cfg.crm?.needsOwnerKind || 'needs_owner';
module.exports = { merge, normalize, ownerId, isOwnerName, needsOwnerKind };
