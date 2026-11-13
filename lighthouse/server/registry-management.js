'use strict';
const { fail, safeKey } = require('./registry');
const access = require('./access');

function makeManagement(ctx) {
  const { registry, lifecycle } = ctx;
  const usable = who => who && !who.shadow && !['collector', 'steward'].includes(who.mode);
  function allowed(who, board) {
    if (!usable(who)) return false;
    try {
      lifecycle.manage(who, board);
      return true;
    } catch {
      return false;
    }
  }
  function context(who) {
    if (ctx.cfg.enrollment?.enabled !== true || !registry.persistent) return { enabled: false };
    const boards = Object.values(registry.metadata().boards)
      .filter(board => allowed(who, board))
      .sort((left, right) => left.order - right.order);
    const ids = new Set(boards.map(board => board.id));
    const credentials = registry.credentials();
    return {
      enabled: true,
      signedIn: !!who,
      hostAdmin: !!who?.hostAdmin,
      principal: who?.name || null,
      boards: boards.map((board, order) => ({
        id: board.id,
        name: board.name,
        order,
        lifecycle: board.lifecycle,
        protocol: board.protocol,
        members: who.hostAdmin ? board.members : undefined,
      })),
      grants: Object.values(credentials.grants)
        .filter(
          grant =>
            typeof grant.id === 'string' &&
            grant.expiresAt > Date.now() &&
            ids.has(grant.scope.boardId) &&
            !grant.consumed &&
            !grant.revoked,
        )
        .map(grant => ({ id: grant.id, scope: grant.scope, expiresAt: grant.expiresAt })),
      installations: Object.values(credentials.installations)
        .filter(record => ids.has(record.scope.boardId))
        .map(record => ({
          id: record.id,
          scope: record.scope,
          revoked: record.revoked,
          doctor: record.doctor || null,
        })),
      audit: who?.hostAdmin ? registry.metadata().membershipAudit || [] : undefined,
    };
  }
  function member(who, input) {
    if (!usable(who) || !who.hostAdmin) throw fail('host administrator required', 403);
    if (!registry.persistent) throw fail('offline registry migration required', 409);
    if (!safeKey(input.principal) || (input.role !== null && !access.valid(input.role)))
      throw fail('invalid membership principal or role');
    return registry.transact(state => {
      const board = Object.hasOwn(state.metadata.boards, input.id) && state.metadata.boards[input.id];
      if (!board) throw fail('no such board', 404);
      const previous = Object.hasOwn(board.members, input.principal)
        ? board.members[input.principal]
        : state.metadata.defaultRole[input.principal] || null;
      const hadOwner = Object.values(board.members).some(role => access.hasRole(role, 'owner'));
      board.members[input.principal] = input.role;
      const owners = Object.entries(board.members).filter(([, role]) => access.hasRole(role, 'owner'));
      if (hadOwner && !owners.length)
        throw fail('retain an owner; adopt another owner before removing the last one', 409);
      if (owners.length)
        board.owner = owners.some(([principal]) => principal === board.owner) ? board.owner : owners[0][0];
      board.version++;
      const entry = {
        id: input.id,
        principal: input.principal,
        previous,
        role: input.role,
        actor: who.name,
        at: new Date().toISOString(),
      };
      (state.metadata.membershipAudit ||= []).push(entry);
      return { ...entry, version: board.version };
    });
  }
  function doctor(who, input) {
    if (!who?.installationId || !Array.isArray(input.checks)) throw fail('installation report required', 403);
    const names = [
      'node',
      'binding',
      'hooks',
      'tool server',
      'watchers and lease',
      'last board contact',
      'private storage',
    ];
    const checks = names.flatMap(name => {
      const check = input.checks.find(candidate => candidate?.name === name);
      return check && ['ok', 'fault'].includes(check.status) ? [{ name, status: check.status }] : [];
    });
    if (!checks.length) throw fail('redacted doctor checks required');
    return registry.transact(state => {
      const record = state.credentials.installations[who.installationId];
      if (!record || record.revoked || record.version !== who.installationVersion)
        throw fail('installation unavailable', 403);
      record.doctor = { at: new Date().toISOString(), checks };
      return { recorded: true };
    });
  }
  return { context, member, doctor, allowed };
}

module.exports = { makeManagement };
