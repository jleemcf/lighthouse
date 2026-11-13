'use strict';
const { LOST_AFTER_MS } = require('./shift-presence');

module.exports = function controls(service) {
  const { ctx, data, record, session, captain, hash, validId, refuse, publicRecord } = service;
  function control(board, who, body) {
    if (ctx.cfg.boards?.[board]?.protocol !== 'tools') refuse('session ownership is tools-only');
    const action = body.action;
    const isSession = who?.source === 'session' && who.board === board && who.sessionScope === 'operator';
    const authorize = () => {
      ctx.registry?.refresh();
      if (action === 'detach' && captain(who, board)) {
        if (service.enabled(board)) refuse('owner retirement is only available before activation', 409);
        return;
      }
      if (['acquire', 'attach', 'detach'].includes(action)) {
        if (!isSession || !session(board, who.sessionId) || session(board, who.sessionId).revoked)
          refuse('operator session credential required');
        service.validate(who, board);
        if (action !== 'acquire' && service.enabled(board)) {
          if (ctx.handoff?.enabled(board)) service.holding(who, board, who.epoch);
          else service.acting(who, board, who.epoch);
        }
      } else if (!captain(who, board)) refuse('explicit board captain scope required');
    };
    const operationId = body.operationId;
    if (!validId(operationId)) refuse('operationId required', 400);
    const canonical = Object.fromEntries(Object.entries(body).sort(([left], [right]) => left.localeCompare(right)));
    const digest = hash(JSON.stringify({ who: who?.sessionId || who?.name, body: canonical }));
    return ctx.transact(authorize, () => {
      const key = board + '|' + operationId;
      const previous = data().operations[key];
      if (previous) {
        if (previous.digest !== digest) refuse('operationId reused with different input', 409);
        return { ...previous.result, duplicate: true };
      }
      if (
        ctx.handoff?.enabled(board) &&
        record(board).holderSessionId &&
        ['nominate', 'acquire', 'cancel'].includes(action)
      )
        refuse('use the sealed handoff protocol on this board', 409);
      const owner = data().boards[board] || (data().boards[board] = record(board));
      if (action === 'register') register(board, body);
      else if (action === 'locate') require('./handoff-location').locate(service, board, body.sessionId, body.location);
      else if (action === 'nominate') {
        if (body.expectedEpoch !== owner.epoch) refuse('epoch changed', 409);
        if (!session(board, body.sessionId)) refuse('register successor explicitly first', 409);
        if (!validId(body.nominationId)) refuse('nominationId required', 400);
        const reused = Object.entries(data().operations).some(
          ([key, operation]) =>
            key.startsWith(board + '|') && operation.result.ownership.successor?.id === body.nominationId,
        );
        if (owner.successor?.id === body.nominationId || reused) refuse('nomination identity already used', 409);
        if (
          !Number.isSafeInteger(body.expiresAt) ||
          body.expiresAt <= Date.now() ||
          body.expiresAt > Date.now() + 3600000
        )
          refuse('nomination expires within one hour', 400);
        owner.successor = {
          id: body.nominationId,
          sessionId: body.sessionId,
          epoch: owner.epoch,
          expiresAt: body.expiresAt,
          status: 'pending',
          approvedBy: who.name,
          approvedAt: Date.now(),
        };
        owner.handoffOperationId = operationId;
      } else if (action === 'cancel') {
        if (
          body.expectedEpoch !== owner.epoch ||
          body.nominationId !== owner.successor?.id ||
          owner.successor?.status !== 'pending'
        )
          refuse('nomination changed', 409);
        owner.successor.status = 'cancelled';
      } else if (action === 'acquire') acquire(owner, board, who, body, operationId);
      else if (action === 'attach' || action === 'detach') {
        if (!validId(body.processId)) refuse('explicit processId required', 400);
        if (action === 'detach' && captain(who, board)) {
          const process = owner.processes[body.processId];
          if (body.expectedEpoch !== owner.epoch || body.confirmStopped !== true)
            refuse('exact epoch and explicit stopped-process confirmation required', 409);
          if (!process || (process.sessionId && process.sessionId === owner.holderSessionId))
            refuse('owner may retire only obsolete non-holder processes', 409);
        } else {
          if (who.epoch !== owner.epoch) refuse('exact attachment epoch required', 409);
          if (owner.processes[body.processId] && owner.processes[body.processId].sessionId !== who.sessionId)
            refuse('process belongs to another session', 409);
        }
        if (action === 'detach') delete owner.processes[body.processId];
        else {
          const inventory = ctx.dispatchLedger?.record(board)?.inventories[body.journalId];
          if (
            ctx.activation?.active(board) &&
            (body.protocol !== 'session-epochs-v1' ||
              !body.capabilities?.includes('dispatch-ledger-v1') ||
              body.kitVersion !== ctx.activation.version ||
              body.journalVersion !== 1 ||
              !(inventory?.complete || inventory?.resolved) ||
              inventory.originSessionId !== who.sessionId ||
              inventory.originEpoch !== who.epoch ||
              !/^[a-f0-9]{64}$/.test(body.loadedMcp || '') ||
              body.loadedMcp !== body.installedMcp)
          )
            refuse('reconnect a matching migrated kit before attaching to this activated board', 409);
          owner.processes[body.processId] = {
            sessionId: who.sessionId,
            protocol: body.protocol === 'session-epochs-v1' ? body.protocol : 'legacy',
            kitVersion: typeof body.kitVersion === 'string' ? body.kitVersion.slice(0, 80) : null,
            loadedMcp: body.loadedMcp,
            installedMcp: body.installedMcp,
            journalVersion: body.journalVersion,
            ...(Array.isArray(body.capabilities)
              ? {
                  capabilities: body.capabilities.filter(value => value === 'dispatch-ledger-v1'),
                  journalId: validId(body.journalId) ? body.journalId : null,
                }
              : {}),
            seenAt: Date.now(),
          };
        }
      } else if (action === 'activate') activate(owner, body, board);
      else refuse('unknown ownership action', 400);
      ctx.store.boards[board].ownership = publicRecord(board);
      const result = { ok: true, ownership: publicRecord(board) };
      data().audit.push({
        board,
        operationId,
        action,
        epoch: owner.epoch,
        by: who.name,
        sessionId: who.sessionId || null,
        ...(action === 'detach' ? { processId: body.processId, confirmedStopped: body.confirmStopped === true } : {}),
        at: Date.now(),
      });
      data().operations[key] = { digest, result: structuredClone(result) };
      ctx.change('ownership', board, who.name, board);
      return result;
    });
  }
  function register(board, body) {
    if (
      !validId(body.sessionId) ||
      !validId(body.installationId) ||
      typeof body.credential !== 'string' ||
      !/^[A-Za-z0-9_-]{43,128}$/.test(body.credential)
    )
      refuse('explicit session, installation and private random credential required', 400);
    if (typeof body.principal !== 'string' || ctx.roleOn({ name: body.principal }, board) < 3)
      refuse('operator membership required');
    const scope = body.scope || 'operator';
    if (!['operator', 'collector'].includes(scope)) refuse('unsupported session scope', 400);
    const key = board + '|' + body.sessionId + (scope === 'operator' ? '' : '|' + scope);
    if (data().sessions[key]) refuse('session already registered', 409);
    const installation = ctx.registry?.credentials().installations[body.installationId];
    if (
      installation &&
      (installation.revoked ||
        installation.scope.boardId !== board ||
        installation.scope.principal !== body.principal ||
        installation.scope.role !== 'operator')
    )
      refuse('installation scope mismatch or revoked');
    if (Object.values(data().sessions).some(entry => entry.credentialHash === hash(body.credential)))
      refuse('credential already registered', 409);
    if (scope !== 'operator') {
      const parent = session(board, body.sessionId);
      if (!parent || parent.principal !== body.principal || parent.installationId !== body.installationId)
        refuse('collector must belong to the same explicitly registered session');
    }
    data().sessions[key] = {
      sessionId: body.sessionId,
      installationId: body.installationId,
      board,
      principal: body.principal,
      scope,
      credentialHash: hash(body.credential),
      revoked: false,
      enrollmentVersion: installation?.version ?? null,
    };
    if (scope === 'operator' && body.location)
      require('./handoff-location').locate(service, board, body.sessionId, body.location);
  }
  function acquire(owner, board, who, body, operationId) {
    const nomination = owner.successor;
    if (
      body.expectedEpoch !== owner.epoch ||
      !nomination ||
      nomination.status !== 'pending' ||
      nomination.id !== body.nominationId ||
      nomination.epoch !== owner.epoch ||
      nomination.sessionId !== who.sessionId ||
      nomination.expiresAt <= Date.now()
    )
      refuse('nomination expired, cancelled, superseded or epoch changed', 409);
    const previousLease = owner.leaseUntil;
    const checkDeadlines = () => {
      if (nomination.expiresAt <= Date.now()) refuse('nomination expired before acquisition committed', 409);
      if (previousLease && previousLease <= Date.now() && !(nomination.approvedAt >= previousLease))
        refuse('captain approval after this session loss required', 409);
    };
    checkDeadlines();
    ctx.beforeCommit(checkDeadlines);
    if (owner.holderSessionId === who.sessionId) refuse('holder cannot reacquire itself', 409);
    if (owner.epoch >= Number.MAX_SAFE_INTEGER) refuse('ownership epoch exhausted', 409);
    owner.epoch++;
    owner.holderSessionId = who.sessionId;
    owner.installationId = session(board, who.sessionId).installationId;
    owner.leaseUntil = Date.now() + LOST_AFTER_MS;
    owner.phase = 'working';
    nomination.status = 'acquired';
    owner.handoffOperationId = operationId;
  }
  function activate(owner, body, board) {
    if (ctx.activation) refuse('use the named board activation command', 409);
    if (owner.enforced) refuse('ownership enforcement cannot be disabled or reactivated', 409);
    if (
      Object.values(ctx.store.tickets || {}).some(
        ticket => ticket.board === board && !ticket.used && !ticket.evidenceHash,
      )
    )
      refuse('settle legacy relay tickets before activation', 409);
    const processes = Object.entries(owner.processes).filter(
      ([, process]) => Date.now() - process.seenAt < LOST_AFTER_MS,
    );
    const expected = processes.map(([id]) => id).sort();
    if (
      !owner.holderSessionId ||
      owner.leaseUntil <= Date.now() ||
      !expected.length ||
      processes.some(
        ([, process]) => process.protocol !== 'session-epochs-v1' || process.sessionId !== owner.holderSessionId,
      ) ||
      body.confirmAllWriters !== true ||
      JSON.stringify(expected) !== JSON.stringify([...(body.processIds || [])].sort())
    )
      refuse('readiness barrier incomplete: all attached writers must speak session-epochs-v1', 409);
    owner.enforced = true;
    ctx.store.schemaVersion = Math.max(ctx.store.schemaVersion || 1, 3);
    const shift = ctx.store.boards[board].shift;
    if (shift?.state === 'on' && !shift.id) shift.id = require('node:crypto').randomUUID();
  }
  function observeLegacy(board, processId) {
    if (service.enabled(board) || ctx.cfg.boards?.[board]?.protocol !== 'tools') return;
    const owner = data().boards[board] || (data().boards[board] = record(board));
    owner.processes['legacy-' + processId] = { protocol: 'legacy', sessionId: null, seenAt: Date.now() };
  }
  return { control, observeLegacy };
};
