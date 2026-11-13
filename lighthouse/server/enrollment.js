'use strict';
const crypto = require('node:crypto');
const { isOwnerName } = require('./configuration');
const { definition, digest, secret, fail, safeKey, roles, protocols } = require('./registry');
const { hasRole } = require('./access');

const scopeFields = ['hostId', 'boardId', 'action', 'principal', 'role', 'protocol', 'installationId'];
const canonical = scope => Object.fromEntries(scopeFields.map(field => [field, scope?.[field]]));
const proofValue = value => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
const operationValue = value => typeof value === 'string' && /^[a-f0-9-]{36}$/.test(value);
const adminOnly = who => {
  if (!who?.hostAdmin) throw fail('host administrator required', 403);
};

function makeEnrollment(registry, cfg, options = {}) {
  const clock = options.clock || Date.now;
  function bootstrap(principal, handoff) {
    if (!safeKey(principal)) throw fail('invalid administrator principal');
    const credential = secret();
    return registry.transact(state => {
      if (Object.keys(state.credentials.admins).length) throw fail('host administrator already bootstrapped', 409);
      handoff({ hostId: state.metadata.hostId, principal, credential });
      state.credentials.admins[digest(credential)] = { principal };
      return { hostId: state.metadata.hostId, principal };
    });
  }
  function authenticate(credential) {
    const verifier = digest(credential);
    const admin = registry.credentials().admins[verifier];
    if (admin) return { name: admin.principal, source: 'credential', via: 'api', mode: 'host-admin', hostAdmin: true };
    const installation = Object.values(registry.credentials().installations).find(
      record => record.credentialVerifier === verifier && !record.revoked,
    );
    if (!installation) return null;
    return {
      name: installation.scope.principal,
      source: 'installation',
      via: 'api',
      mode: installation.scope.protocol,
      board: installation.scope.boardId,
      installationId: installation.id,
      installationRole: installation.scope.role,
      installationVersion: installation.version,
    };
  }
  function issue(who, input, handoff) {
    if (!who?.hostAdmin && input.scope?.action !== 'bind')
      throw fail('host administrator or board owner scoped bind required', 403);
    if (cfg.enrollment?.enabled !== true) throw fail('enrollment is disabled', 403);
    const grantSecret = secret();
    const ttl = input.ttlSeconds ?? 300;
    if (!Number.isInteger(ttl) || ttl < 1 || ttl > 900 || !/^[a-f0-9]{64}$/.test(input.proofVerifier || ''))
      throw fail('invalid grant expiry or installation proof verifier');
    return registry.transact(state => {
      if (!who?.hostAdmin) {
        const board =
          Object.hasOwn(state.metadata.boards, input.scope?.boardId) && state.metadata.boards[input.scope.boardId];
        if (
          input.scope?.action !== 'bind' ||
          !board ||
          !['operator', 'watch', 'viewer', 'commenter'].includes(input.scope.role) ||
          isOwnerName(cfg, input.scope.principal)
        )
          throw fail('board owner may issue only a scoped bind grant', 403);
        require('./registry-lifecycle').makeLifecycle(registry).manage(who, board);
      }
      const scope = canonical({ ...input.scope, hostId: state.metadata.hostId });
      if (scope.action === 'create') scope.boardId = crypto.randomUUID();
      if (
        !['create', 'bind'].includes(scope.action) ||
        !safeKey(scope.principal) ||
        !roles.includes(scope.role) ||
        !protocols.includes(scope.protocol) ||
        !operationValue(scope.installationId)
      )
        throw fail('invalid enrollment scope');
      if (state.credentials.installations[scope.installationId]) throw fail('installation already exists', 409);
      let boardDefinition = null,
        privateSettings = {};
      if (scope.action === 'bind') {
        const board = Object.hasOwn(state.metadata.boards, scope.boardId) && state.metadata.boards[scope.boardId];
        if (!board || board.lifecycle !== 'active' || board.protocol !== scope.protocol)
          throw fail('no active board matches the grant', 404);
        if (scope.role === 'owner' && !hasRole(board.members[scope.principal], 'owner'))
          throw fail('a bind grant cannot transfer ownership', 403);
      } else {
        [boardDefinition, privateSettings] = definition(
          scope.boardId,
          {
            ...input.board,
            protocol: scope.protocol,
          },
          Object.keys(state.metadata.boards).length,
        );
        const existingRole = boardDefinition.members[scope.principal];
        if (existingRole && !hasRole(existingRole, scope.role))
          throw fail('create grant role conflicts with board membership');
        if (!existingRole) boardDefinition.members[scope.principal] = scope.role;
        if (scope.role === 'owner' && boardDefinition.owner !== scope.principal)
          throw fail('create grant owner is fixed by its board definition');
      }
      const grant = {
        id: crypto.randomUUID(),
        scope,
        proofVerifier: input.proofVerifier,
        expiresAt: clock() + ttl * 1000,
        boardDefinition,
        privateSettings,
        consumed: null,
      };
      handoff({ grant: grantSecret, scope, expiresAt: grant.expiresAt });
      state.credentials.grants[digest(grantSecret)] = grant;
      return { id: grant.id, scope, expiresAt: grant.expiresAt };
    });
  }
  function consume(input) {
    if (cfg.enrollment?.enabled !== true) throw fail('enrollment is disabled', 403);
    if (
      !proofValue(input.grant) ||
      !proofValue(input.proof) ||
      !proofValue(input.credential) ||
      !operationValue(input.operationId)
    )
      throw fail('invalid enrollment request');
    const scope = canonical(input.scope);
    if (Object.keys(input.scope || {}).length !== scopeFields.length) throw fail('wrong enrollment scope', 403);
    const proofVerifier = digest(input.proof),
      credentialVerifier = digest(input.credential);
    if (
      proofVerifier === credentialVerifier ||
      Object.keys(cfg.tokens || {}).some(token => digest(token) === credentialVerifier)
    )
      throw fail('installation requires its own fresh credential');
    return registry.transact(state => {
      const operation = state.credentials.operations[input.operationId];
      if (operation) {
        const installed = state.credentials.installations[operation.installationId];
        if (
          operation.proofVerifier !== proofVerifier ||
          operation.credentialVerifier !== credentialVerifier ||
          operation.scope !== JSON.stringify(scope) ||
          operation.grantVerifier !== digest(input.grant) ||
          !installed ||
          installed.revoked ||
          installed.credentialVerifier !== credentialVerifier
        )
          throw fail('enrollment retry proof does not match', 403);
        return { ...operation.result, repeated: true };
      }
      const grant = state.credentials.grants[digest(input.grant)];
      if (!grant || grant.consumed || grant.revoked || grant.expiresAt <= clock())
        throw fail('grant unavailable or expired', 403);
      if (grant.proofVerifier !== proofVerifier || JSON.stringify(grant.scope) !== JSON.stringify(scope))
        throw fail('wrong enrollment scope or installation proof', 403);
      if (state.credentials.installations[scope.installationId]) throw fail('installation already exists', 409);
      if (state.credentials.admins[credentialVerifier]) throw fail('installation requires its own fresh credential');
      if (Object.values(state.credentials.installations).some(item => item.credentialVerifier === credentialVerifier))
        throw fail('installation requires its own fresh credential');
      if (scope.action === 'create') {
        if (state.metadata.boards[scope.boardId]) throw fail('board id already exists', 409);
        state.metadata.boards[scope.boardId] = grant.boardDefinition;
        state.credentials.boardSettings[scope.boardId] = grant.privateSettings;
      } else {
        const board = state.metadata.boards[scope.boardId];
        if (!board || board.lifecycle !== 'active' || board.protocol !== scope.protocol)
          throw fail('board is no longer available', 409);
        if (scope.role === 'owner' && !hasRole(board.members[scope.principal], 'owner'))
          throw fail('a bind grant cannot transfer ownership', 403);
        if (!Object.hasOwn(board.members, scope.principal)) board.members[scope.principal] = scope.role;
        board.version++;
      }
      const result = { installationId: scope.installationId, boardId: scope.boardId, protocol: scope.protocol };
      state.credentials.installations[scope.installationId] = {
        id: scope.installationId,
        scope,
        credentialVerifier,
        revoked: false,
        version: 1,
      };
      grant.consumed = input.operationId;
      state.credentials.operations[input.operationId] = {
        installationId: scope.installationId,
        proofVerifier,
        credentialVerifier,
        grantVerifier: digest(input.grant),
        scope: JSON.stringify(scope),
        result,
      };
      return result;
    });
  }
  function installation(who, action, input) {
    return registry.transact(state => {
      const record =
        operationValue(input.installationId) &&
        Object.hasOwn(state.credentials.installations, input.installationId) &&
        state.credentials.installations[input.installationId];
      if (!record) throw fail('no such installation', 404);
      const board =
        Object.hasOwn(state.metadata.boards, record.scope.boardId) && state.metadata.boards[record.scope.boardId];
      if (!board) throw fail('no such board', 404);
      require('./registry-lifecycle').makeLifecycle(registry).manage(who, board);
      if (action !== 'revoke') adminOnly(who);
      if (action === 'revoke') record.revoked = true;
      else if (action === 'rotate' && proofValue(input.credential)) {
        const verifier = digest(input.credential);
        if (
          Object.keys(cfg.tokens || {}).some(token => digest(token) === verifier) ||
          state.credentials.admins[verifier] ||
          Object.values(state.credentials.installations).some(item => item.credentialVerifier === verifier)
        )
          throw fail('credential is not fresh');
        record.credentialVerifier = verifier;
      } else throw fail('invalid installation action');
      record.version++;
      return { installationId: record.id, revoked: record.revoked, version: record.version };
    });
  }
  function revokeGrant(who, input) {
    if (!operationValue(input.id)) throw fail('valid grant id required');
    return registry.transact(state => {
      const grant = Object.values(state.credentials.grants).find(record => record.id === input.id);
      if (!grant) throw fail('no such grant', 404);
      const board =
        Object.hasOwn(state.metadata.boards, grant.scope.boardId) && state.metadata.boards[grant.scope.boardId];
      if (!who?.hostAdmin) {
        if (!board) throw fail('board owner or host administrator required', 403);
        require('./registry-lifecycle').makeLifecycle(registry).manage(who, board);
      }
      grant.revoked = true;
      return { id: grant.id, revoked: true };
    });
  }
  return { bootstrap, authenticate, issue, consume, installation, revokeGrant };
}

module.exports = { makeEnrollment, canonical, proofValue };
