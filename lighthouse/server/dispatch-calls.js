'use strict';

module.exports = function calls(service) {
  const { ctx, ownership, data, enabled, requested, record, refuse, callHash, audit } = service;
  const terminal = new Set(['acknowledged', 'rejected', 'superseded']);
  const tracksCall = (board, call) => (ctx.activation || requested(board)) && !!record(board)?.calls[call.id];
  function settleCommitted(board, entry, release = true) {
    if (terminal.has(entry.disposition)) return;
    if (entry.commitAmbiguous) return;
    const principal = entry.originSessionId ? entry.originPrincipal : null;
    const records = principal
      ? [ctx.store.calls?.[board + '|' + principal + '|' + entry.id]].filter(Boolean)
      : Object.entries(ctx.store.calls || {})
          .filter(([key]) => key.startsWith(board + '|') && key.endsWith('|' + entry.id))
          .map(([, value]) => value);
    const candidates = records.filter(value => !value.dry);
    const committed = candidates[0];
    if (!principal && (candidates.length > 1 || (committed?.bodyHash && committed.bodyHash !== entry.hash))) {
      entry.commitAmbiguous = true;
      entry.history.push({ action: 'commit-evidence-ambiguous', at: Date.now() });
      return;
    }
    if (!committed) return;
    if (committed.bodyHash && committed.bodyHash !== entry.hash)
      refuse('committed call id has a different body hash', 409);
    entry.disposition = committed.ok ? 'acknowledged' : 'rejected';
    entry.result = { ok: committed.ok, summary: committed.summary, duplicate: true };
    entry.history.push({ action: entry.disposition, source: 'commit-record', at: Date.now() });
    if (release) service.releaseHolds(board);
  }
  function settleCalls(board) {
    for (const entry of Object.values(data(board).calls)) settleCommitted(board, entry);
  }
  function inventory(board, who, body) {
    if (
      !ownership.validId(body.journalId) ||
      typeof body.complete !== 'boolean' ||
      !Array.isArray(body.calls) ||
      !Array.isArray(body.relays) ||
      body.calls.length + body.relays.length > 1000
    )
      refuse('versioned complete inventory required', 400);
    const saved = data(board);
    const prior = saved.inventories[body.journalId];
    if (prior && prior.installationId !== who.sessionInstallationId)
      refuse('journal belongs to another installation; import evidence under a new local journal id', 409);
    const migration = body.migration;
    if (migration) {
      if (
        !ownership.validId(migration.id) ||
        !/^[a-f0-9]{64}$/.test(migration.hash || '') ||
        !Number.isSafeInteger(migration.parts) ||
        migration.parts < 1 ||
        !Number.isSafeInteger(migration.index) ||
        migration.index < 0 ||
        migration.index >= migration.parts
      )
        refuse('versioned journal migration page required', 400);
      if (
        migration.index > 0 &&
        (prior?.migration?.id !== migration.id ||
          prior.migration.hash !== migration.hash ||
          prior.migration.parts !== migration.parts ||
          prior.migration.nextIndex !== migration.index ||
          prior.originSessionId !== who.sessionId ||
          prior.originEpoch !== who.epoch ||
          prior.migration.sourceComplete !== body.complete ||
          JSON.stringify(prior.migration.sourceGaps) !== JSON.stringify(body.gaps || []))
      )
        refuse('journal migration changed or page missing; restart the snapshot', 409);
    }
    for (const call of body.calls) importCall(board, who, call);
    for (const relay of body.relays) importRelay(board, who, relay);
    const carried = prior?.migration;
    const previousGaps = carried?.previousGaps ?? prior?.resolution?.gaps ?? prior?.gaps ?? [];
    const previousComplete = carried
      ? carried.previousComplete && carried.sourceComplete
      : !prior || prior.complete || prior.resolved;
    const previousResolved = carried
      ? carried.previousResolved && carried.sourceGaps.every(gap => previousGaps.includes(String(gap)))
      : prior?.resolved;
    const pending = migration && migration.index + 1 < migration.parts;
    const complete = !pending && body.complete && previousComplete;
    saved.inventories[body.journalId] = {
      id: body.journalId,
      installationId: who.sessionInstallationId,
      originSessionId: who.sessionId,
      originEpoch: who.epoch,
      complete: !!complete,
      gaps: [...new Set([...(prior?.gaps || []), ...(Array.isArray(body.gaps) ? body.gaps.map(String) : [])])].slice(
        0,
        20,
      ),
      at: Date.now(),
      ...(prior?.resolution ? { resolution: structuredClone(prior.resolution) } : {}),
      resolved:
        !pending &&
        previousResolved === true &&
        (!body.gaps?.length || (body.gaps || []).every(gap => previousGaps.includes(gap))),
      ...(pending
        ? {
            migration: {
              id: migration.id,
              hash: migration.hash,
              parts: migration.parts,
              nextIndex: migration.index + 1,
              previousComplete: !!previousComplete,
              previousResolved: !!previousResolved,
              previousGaps,
              sourceComplete: body.complete,
              sourceGaps: body.gaps || [],
            },
          }
        : {}),
    };
    return { inventory: saved.inventories[body.journalId], calls: body.calls.map(call => saved.calls[call.id]) };
  }
  function importCall(board, who, call) {
    if (
      !ownership.validId(call?.id) ||
      typeof call.tool !== 'string' ||
      call.tool.startsWith('_') ||
      call.tool === 'board_relay' ||
      call.hash !== callHash(call)
    )
      refuse('invalid queued call and body hash', 400);
    const saved = data(board);
    const prior = saved.calls[call.id];
    if (prior) {
      if (prior.hash !== call.hash) refuse('original call id has a different body hash', 409);
      settleCommitted(board, prior, false);
      return;
    }
    const origin = ownership.session(board, call.originSessionId);
    const principal = origin?.principal || null;
    saved.calls[call.id] = {
      ...structuredClone(call),
      board,
      originSessionId: call.originSessionId || null,
      originEpoch: call.originEpoch ?? null,
      originInstallationId: origin?.installationId || call.originInstallationId || who.sessionInstallationId,
      originPrincipal: principal,
      disposition: 'unacknowledged',
      result: null,
      history: [{ action: 'inventory', by: who.sessionId, at: Date.now() }],
    };
    const entry = saved.calls[call.id];
    settleCommitted(board, entry, false);
    if (!terminal.has(entry.disposition) && !entry.commitAmbiguous && call.disposition === 'rejected')
      entry.disposition = 'rejected';
  }
  function importRelay(board, who, relay) {
    if (!ownership.validId(relay?.id)) refuse('relay journal reference id required', 400);
    const saved = data(board);
    if (relay.intentId && saved.intents[relay.intentId]) return;
    const id = 'import-' + ownership.hash(relay.id).slice(0, 40);
    if (saved.intents[id]) return;
    const ticket = ctx.store.tickets?.[relay.ticket];
    if (ticket?.board && ticket.board !== board) refuse('imported ticket belongs to another board', 400);
    if (ticket?.ledgerIntentId && saved.intents[ticket.ledgerIntentId]) return;
    if (relay.state === 'recorded' && (!ticket || ticket.used)) return;
    const attemptId = id + '-attempt';
    saved.intents[id] = {
      id,
      board,
      state: 'unknown',
      target: ticket?.to || relay.target || 'firstmate',
      instructionHash: ticket?.hash || relay.hash || null,
      originSessionId: ticket?.sessionId || relay.originSessionId || null,
      originEpoch: ticket?.epoch ?? relay.originEpoch ?? null,
      originInstallationId: ownership.session(board, ticket?.sessionId)?.installationId || who.sessionInstallationId,
      attemptIds: [attemptId],
      imported: true,
      history: [],
    };
    saved.attempts[attemptId] = {
      id: attemptId,
      intentId: id,
      ticketId: ticket?.id || null,
      state: 'unknown',
      permissionId: null,
      receipts: [],
      imported: true,
    };
    if (ticket && !ticket.ledgerIntentId) {
      ticket.ledgerIntentId = id;
      ticket.attemptId = attemptId;
    }
  }
  function apply(board, who, body) {
    if (body.action === 'resolve-gap') {
      if (
        !ownership.captain(who, board) ||
        body.independent !== true ||
        typeof body.evidence !== 'string' ||
        !body.evidence.trim()
      )
        refuse('owner and independent gap evidence required');
      const item = data(board).inventories[body.journalId];
      if (!item) refuse('no such journal inventory', 404);
      if (item.migration) {
        if (body.abandonMigrationId !== item.migration.id || body.expectedEpoch !== ownership.record(board).epoch)
          refuse('finish the migration or explicitly abandon its exact id at the current epoch', 409);
        const migration = item.migration;
        item.gaps = [...new Set(['migration-pages-missing:' + migration.id, ...item.gaps])].slice(0, 20);
        item.complete = false;
        item.abandonedMigration = { ...migration, at: Date.now(), by: who.name };
        delete item.migration;
        audit(board, who, 'migration-abandoned', migration.id, { journalId: body.journalId });
      }
      item.resolved = true;
      item.resolution = { by: who.name, evidence: body.evidence, gaps: [...item.gaps], at: Date.now() };
      return { inventory: item };
    }
    if (body.action !== 'review-call') return null;
    const call = data(board).calls[body.callId];
    if (!call || call.hash !== body.hash) refuse('review the exact original queued call and hash', 409);
    if (
      !['adopted', 'superseded', 'rejected'].includes(body.disposition) ||
      typeof body.reason !== 'string' ||
      !body.reason.trim()
    )
      refuse('explicit disposition and review reason required', 400);
    if (terminal.has(call.disposition)) return { call, duplicate: true };
    settleCommitted(board, call);
    if (terminal.has(call.disposition)) return { call, duplicate: true };
    if (call.commitAmbiguous && body.disposition === 'adopted')
      refuse('ambiguous legacy commit evidence must be resolved separately; this call cannot be adopted', 409);
    call.disposition = body.disposition;
    call.adopter = { sessionId: who.sessionId, epoch: who.epoch };
    call.history.push({ action: body.disposition, reason: body.reason, ...call.adopter, at: Date.now() });
    return { call: structuredClone(call) };
  }
  function canApply(board, who, call) {
    if (!enabled(board)) return false;
    const entry = data(board).calls[call.id];
    return (
      !entry?.commitAmbiguous &&
      entry?.hash === callHash(call) &&
      entry.disposition === 'adopted' &&
      entry.adopter?.sessionId === who.sessionId &&
      entry.adopter?.epoch === who.epoch
    );
  }
  function previousCall(board, call) {
    if (!enabled(board) && !tracksCall(board, call)) return null;
    const entry = data(board).calls[call.id];
    if (!entry) return null;
    if (entry.hash !== callHash(call)) refuse('original call id reused with a different body hash', 409);
    settleCommitted(board, entry);
    if (terminal.has(entry.disposition)) return entry.result || { ok: false, summary: entry.disposition };
    return null;
  }
  function requireReview(board, who, call) {
    if (!enabled(board)) return;
    const entry = data(board).calls[call.id];
    if (entry && !terminal.has(entry.disposition) && !canApply(board, who, call))
      refuse('queued intent requires explicit current-authority review and adoption', 409);
  }
  function rememberCall(board, who, call, result) {
    if (
      (!enabled(board) && !tracksCall(board, call)) ||
      ['board_status', 'board_authorities', 'board_relay', '_relay_result'].includes(call.tool) ||
      call.args?.dry_run ||
      result.retry
    )
      return;
    if (!data(board).calls[call.id]) importCall(board, who, { ...call, hash: callHash(call) });
    const entry = data(board).calls[call.id];
    if (entry.hash !== callHash(call)) refuse('original call id reused with a different body hash', 409);
    if (terminal.has(entry.disposition)) return;
    entry.disposition = result.ok ? 'acknowledged' : 'rejected';
    entry.result = structuredClone(result);
    entry.history.push({ action: entry.disposition, sessionId: who.sessionId, epoch: who.epoch, at: Date.now() });
    audit(board, who, 'call-' + entry.disposition, call.id, { bodyHash: entry.hash });
    service.releaseHolds(board);
  }
  return {
    inventory,
    importRelay,
    apply,
    canApply,
    previousCall,
    rememberCall,
    requireReview,
    tracksCall,
    settleCalls,
  };
};
