'use strict';
const crypto = require('node:crypto');

module.exports = function attempts(service) {
  const { ctx, ownership, data, enabled, refuse, guardTarget, audit, digest } = service;
  function checkIssue(board, who, ticket, intentId) {
    if (!ownership.validId(intentId)) refuse('stable logical intent id required', 400);
    guardTarget(board, who, ticket.to);
    const saved = data(board);
    if (saved.intents[intentId]) refuse('logical intent already exists; review its ledger', 409);
    if (
      Object.values(saved.intents).some(
        item =>
          item.target === ticket.to &&
          item.instructionHash === ticket.hash &&
          !['delivered', 'quiesced', 'superseded'].includes(item.state),
      )
    )
      refuse('unresolved target and instruction already has a logical intent', 409);
  }
  function issue(board, who, ticket, intentId) {
    if (!enabled(board)) return {};
    checkIssue(board, who, ticket, intentId);
    const saved = data(board);
    const attemptId = crypto.randomUUID();
    const permissionId = crypto.randomUUID();
    const intent = (saved.intents[intentId] = {
      id: intentId,
      board,
      instructionHash: ticket.hash,
      target: ticket.to,
      targetBinding: structuredClone(saved.targetBinding),
      originSessionId: who.sessionId,
      originEpoch: who.epoch,
      originInstallationId: who.sessionInstallationId,
      authorization: {
        source: ticket.messageId,
        prompt: ticket.promptId,
        word: ticket.wordId,
        authority: ticket.underAuthority,
      },
      state: 'issued',
      attemptIds: [attemptId],
      createdAt: Date.now(),
      history: [],
    });
    saved.attempts[attemptId] = {
      id: attemptId,
      intentId,
      ticketId: ticket.id,
      permissionId,
      state: 'issued',
      sessionId: who.sessionId,
      epoch: who.epoch,
      createdAt: Date.now(),
      receipts: [],
    };
    Object.assign(ticket, { ledgerIntentId: intentId, attemptId, permissionId });
    audit(board, who, 'issue', intentId, { attemptId, instructionHash: intent.instructionHash });
    return { intentId, attemptId, permissionId, ledgerVersion: 1 };
  }
  function find(board, body) {
    const saved = data(board);
    const intent = saved.intents[body.intentId];
    const attempt = saved.attempts[body.attemptId];
    if (!intent || !attempt || attempt.intentId !== intent.id) refuse('no such intent and attempt', 404);
    return { intent, attempt, ticket: ctx.store.tickets?.[attempt.ticketId] };
  }
  function apply(board, who, body) {
    if (!['consume', 'adopt-intent', 'unknown', 'reconcile'].includes(body.action)) return null;
    const { intent, attempt, ticket } = find(board, body);
    if (body.action === 'consume') {
      if (attempt.state !== 'issued' || intent.state !== 'issued')
        return { dispatch: false, possiblySent: true, state: attempt.state };
      if (
        attempt.sessionId !== who.sessionId ||
        attempt.epoch !== who.epoch ||
        body.permissionId !== attempt.permissionId
      )
        refuse('explicit adoption of undispatched intent required', 409);
      guardTarget(board, who, intent.target, intent.id);
      ctx.handoff?.dispatch(board, who, intent.target);
      // This durable boundary precedes every external invocation. No retry can return another positive grant.
      attempt.state = intent.state = 'consumed';
      attempt.consumedAt = Date.now();
      attempt.consumeOperationId = body.operationId;
      intent.history.push({ action: 'consume', attemptId: attempt.id, at: Date.now() });
      return { dispatch: true, intentId: intent.id, attemptId: attempt.id, permissionId: attempt.permissionId };
    }
    if (body.action === 'adopt-intent') {
      if (intent.state !== 'issued' || attempt.state !== 'issued' || !ticket || ticket.used)
        refuse('only a board-proven undispatched permission may be adopted; never resend started or unknown work', 409);
      if (typeof body.reason !== 'string' || !body.reason.trim()) refuse('explicit review reason required', 400);
      const validation = ctx.TC?.revalidateRelay(board, who, ticket, body);
      if (!validation?.ok)
        refuse(
          'source authorization changed; review current owner words and authority: ' +
            (validation?.reason || 'source validation unavailable'),
          409,
        );
      attempt.state = 'superseded';
      const next = structuredClone(ticket);
      next.id = crypto.randomBytes(8).toString('hex');
      next.by = who.name;
      const capability = crypto.randomBytes(32).toString('base64url');
      next.sessionId = who.sessionId;
      next.epoch = who.epoch;
      next.evidenceHash = ownership.hash(capability);
      next.attemptId = crypto.randomUUID();
      next.permissionId = crypto.randomUUID();
      ctx.store.tickets[next.id] = next;
      data(board).attempts[next.attemptId] = {
        id: next.attemptId,
        intentId: intent.id,
        ticketId: next.id,
        permissionId: next.permissionId,
        state: 'issued',
        sessionId: who.sessionId,
        epoch: who.epoch,
        createdAt: Date.now(),
        receipts: [],
      };
      intent.attemptIds.push(next.attemptId);
      intent.history.push({
        action: 'adopt',
        from: attempt.id,
        to: next.attemptId,
        reason: body.reason,
        sessionId: who.sessionId,
        epoch: who.epoch,
        at: Date.now(),
      });
      return {
        ticket: {
          id: next.id,
          to: next.to,
          text: next.text,
          hash: next.hash,
          again: next.again,
          intentId: intent.id,
          attemptId: next.attemptId,
          permissionId: next.permissionId,
          evidenceCapability: capability,
          ledgerVersion: 1,
        },
      };
    }
    if (body.action === 'unknown') {
      ownership.evidence(
        who,
        board,
        body.originEpoch ?? who.epoch,
        ticket?.id,
        body.evidenceCapability,
        body.originSessionId,
      );
      if (['consumed', 'unknown'].includes(attempt.state)) attempt.state = intent.state = 'unknown';
      return { state: attempt.state, dispatch: false };
    }
    if (!ownership.captain(who, board)) refuse('independent evidence and board captain decision required');
    if (
      body.quiesced !== true ||
      typeof body.evidence !== 'string' ||
      !body.evidence.trim() ||
      typeof body.reason !== 'string' ||
      !body.reason.trim() ||
      body.independent !== true ||
      !['delivered', 'not-delivered', 'conflict-resolved'].includes(body.outcome)
    )
      refuse('owner must record independent evidence, outcome, reason and quiescence; timeout is not evidence', 400);
    if (['issued', 'superseded'].includes(attempt.state)) refuse('no started attempt to reconcile', 409);
    attempt.state = intent.state = 'quiesced';
    attempt.ownerOutcome = body.outcome;
    if (ticket) {
      if (body.outcome === 'delivered') ctx.TC?.settleRelaySource?.(board, who, ticket, undefined, 'owner');
      ticket.used = true;
      if (body.outcome !== 'conflict-resolved') ticket.delivered = body.outcome === 'delivered';
    }
    intent.history.push({
      action: 'owner-reconciliation',
      attemptId: attempt.id,
      by: who.name,
      at: Date.now(),
      evidence: body.evidence,
      reason: body.reason,
      outcome: body.outcome,
      independent: true,
      quiesced: true,
    });
    releaseHolds(board);
    return { state: intent.state, dispatch: false };
  }
  function releaseHolds(board) {
    if (!enabled(board)) return;
    const transfer = ctx.handoff?.current(board);
    if (!transfer?.heldTargets.length) return;
    const pending = require('./handoff-checkpoint').pending(ctx, board, ctx.handoff.checkpoint(board));
    if (pending.effectBlockers.every(value => value.startsWith('retained-dispatch-hold:'))) {
      transfer.heldTargets = [];
      transfer.inheritedBlockers = [];
    }
  }
  function receipt(board, who, ticket, args, callId) {
    if (!enabled(board) || !ticket.ledgerIntentId) return null;
    const { intent, attempt } = find(board, { intentId: ticket.ledgerIntentId, attemptId: ticket.attemptId });
    if (!['consumed', 'unknown', 'delivered', 'conflict', 'quiesced'].includes(attempt.state))
      return { ok: false, reason: 'receipt has no consumed dispatch permission' };
    if (typeof args.delivered !== 'boolean') return { ok: false, reason: 'explicit delivery outcome required' };
    const value = { id: callId, delivered: args.delivered, detail: String(args.detail || '').slice(0, 400) };
    const hash = digest(value);
    if (!attempt.receipts.some(item => item.hash === hash)) {
      const conflict = attempt.ownerOutcome
        ? (attempt.ownerOutcome === 'delivered' && !args.delivered) ||
          (attempt.ownerOutcome === 'not-delivered' && args.delivered)
        : attempt.receipts.some(item => item.delivered !== args.delivered);
      attempt.receipts.push({ ...value, hash, at: Date.now(), reportedBy: who.sessionId });
      if (conflict || !attempt.ownerOutcome)
        attempt.state = intent.state = conflict ? 'conflict' : args.delivered ? 'delivered' : 'unknown';
      audit(board, who, 'receipt', intent.id, { attemptId: attempt.id, receiptHash: hash });
      if (!conflict && args.delivered) releaseHolds(board);
      if (conflict)
        return { ok: false, reason: 'conflicting receipt retained; independent evidence and owner decision required' };
    }
    return {
      ok: true,
      relay_receipt: { id: callId, ticket: ticket.id, delivered: args.delivered },
      duplicate: ticket.used === true,
    };
  }
  return { checkIssue, issue, apply, receipt, releaseHolds };
};
