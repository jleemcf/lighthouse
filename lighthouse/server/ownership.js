'use strict';
const crypto = require('node:crypto');
const { LOST_AFTER_MS, HEARTBEAT_MS } = require('./shift-presence');
const hash = value => crypto.createHash('sha256').update(String(value)).digest('hex');
const validId = value =>
  typeof value === 'string' &&
  /^[A-Za-z0-9_-]{8,100}$/.test(value) &&
  !['__proto__', 'constructor', 'prototype'].includes(value);
function refuse(message, status = 403) {
  throw Object.assign(new Error(message), { status });
}

module.exports = function ownership(ctx) {
  const data = () =>
    ctx.store.sessionOwnership ||
    (ctx.store.sessionOwnership = {
      format: 1,
      boards: {},
      sessions: {},
      operations: {},
      audit: [],
    });
  const record = board =>
    data().boards[board] || {
      enforced: false,
      holderSessionId: null,
      installationId: null,
      epoch: 0,
      leaseUntil: 0,
      phase: 'unowned',
      successor: null,
      handoffOperationId: null,
      processes: {},
    };
  const session = (board, id) => data().sessions[board + '|' + id];
  const enabled = board => ctx.cfg.boards?.[board]?.protocol === 'tools' && record(board).enforced === true;
  const captain = (who, board) => !!who && !who.sessionId && who.via === 'page' && ctx.roleOn(who, board) >= 4;
  function validate(who, board, scope = 'operator') {
    ctx.registry?.refresh();
    const suffix = scope === 'operator' ? '' : '|' + scope;
    const entry = who?.sessionId && data().sessions[board + '|' + who.sessionId + suffix];
    if (
      !entry ||
      entry.revoked ||
      who.source !== 'session' ||
      who.board !== board ||
      who.sessionScope !== scope ||
      entry.principal !== who.name ||
      entry.installationId !== who.sessionInstallationId
    )
      refuse('session credential required');
    const installation = ctx.registry?.credentials().installations[entry.installationId];
    if (
      entry.enrollmentVersion !== null &&
      (!installation || installation.revoked || installation.version !== entry.enrollmentVersion)
    )
      refuse('session installation revoked');
    if (ctx.roleOn(who, board) < 3) refuse('operator membership revoked');
    return entry;
  }
  function authenticate(credential) {
    const digest = hash(credential);
    for (const entry of Object.values(data().sessions)) {
      if (entry.credentialHash !== digest || entry.revoked) continue;
      const installation = ctx.registry?.credentials().installations[entry.installationId];
      if (
        entry.enrollmentVersion !== null &&
        (!installation || installation.revoked || installation.version !== entry.enrollmentVersion)
      )
        continue;
      return {
        name: entry.principal,
        source: 'session',
        via: 'api',
        mode: entry.scope === 'collector' ? 'collector' : 'tools',
        board: entry.board,
        sessionId: entry.sessionId,
        sessionScope: entry.scope,
        sessionInstallationId: entry.installationId,
        ...(entry.enrollmentVersion !== null
          ? {
              installationId: entry.installationId,
              installationVersion: entry.enrollmentVersion,
              installationRole: 'operator',
            }
          : {}),
      };
    }
    return null;
  }
  function acting(who, board, epoch, scope = 'operator') {
    if (!enabled(board)) return;
    holding(who, board, epoch, scope);
    if (record(board).phase !== 'working') refuse('session is not working', 409);
  }
  function holding(who, board, epoch, scope = 'operator') {
    const owner = record(board);
    validate(who, board, scope);
    if (!Number.isSafeInteger(epoch) || epoch !== owner.epoch) refuse('stale or missing ownership epoch', 409);
    if (owner.holderSessionId !== who.sessionId || owner.installationId !== who.sessionInstallationId)
      refuse('session relieved', 409);
    if (owner.leaseUntil <= Date.now()) refuse('session lease expired; captain approval required', 409);
    if (ctx.roleOn(who, board) < 3) refuse('operator membership revoked');
  }
  function evidence(who, board, epoch, ticketId, capability, originSessionId) {
    validate(who, board);
    const ticket = ctx.store.tickets?.[ticketId];
    if (
      !ticket ||
      ticket.board !== board ||
      !who?.sessionId ||
      who.source !== 'session' ||
      who.sessionScope !== 'operator' ||
      who.board !== board ||
      (ticket.sessionId !== who.sessionId &&
        !(ticket.ledgerIntentId && ctx.dispatchLedger?.enabled(board) && originSessionId === ticket.sessionId)) ||
      ticket.epoch !== epoch ||
      !capability ||
      ticket.evidenceHash !== hash(capability)
    )
      refuse('ticket-bound evidence capability required');
  }
  function renew(who, board, epoch, processId) {
    if (ctx.handoff?.enabled(board)) holding(who, board, epoch);
    else acting(who, board, epoch);
    const owner = record(board);
    if (owner.holderSessionId !== who.sessionId || owner.epoch !== epoch || owner.leaseUntil <= Date.now())
      refuse('expired or relieved session cannot renew', 409);
    if (!owner.processes[processId] || owner.processes[processId].sessionId !== who.sessionId)
      refuse('attach this tool process explicitly before renewal');
    const admittedLease = owner.leaseUntil;
    ctx.beforeCommit(() => {
      if (admittedLease <= Date.now()) refuse('session lease expired before renewal committed', 409);
    });
    owner.processes[processId].seenAt = Date.now();
    owner.leaseUntil = Date.now() + LOST_AFTER_MS;
    ctx.store.boards[board].ownership = publicRecord(board);
  }
  function ticket(who, board, epoch, value) {
    if (!enabled(board)) return null;
    acting(who, board, epoch);
    ctx.handoff?.dispatch(board, who, value.to);
    const credential = crypto.randomBytes(32).toString('base64url');
    Object.assign(value, { sessionId: who.sessionId, epoch, evidenceHash: hash(credential) });
    return credential;
  }
  function publicRecord(board) {
    const owner = record(board);
    return {
      protocol: 'session-epochs-v1',
      enforced: enabled(board),
      holderSessionId: owner.holderSessionId,
      installationId: owner.installationId,
      epoch: owner.epoch,
      leaseUntil: owner.leaseUntil,
      phase: owner.phase,
      successor: owner.successor,
      handoffOperationId: owner.handoffOperationId,
      renewalMs: HEARTBEAT_MS,
      lostAfterMs: LOST_AFTER_MS,
      processes: Object.entries(owner.processes).map(([id, process]) => ({ id, ...process })),
    };
  }
  const service = {
    data,
    record,
    session,
    enabled,
    captain,
    authenticate,
    acting,
    holding,
    evidence,
    renew,
    ticket,
    publicRecord,
    hash,
    validId,
    refuse,
    validate,
    ctx,
  };
  Object.assign(service, require('./ownership-control')(service));
  return service;
};
