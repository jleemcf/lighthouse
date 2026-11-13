'use strict';

module.exports = function mutations(ctx) {
  const { store, ownership, NEXT } = ctx;
  function boards(route, req) {
    const { p, payload, who } = route;
    const boardPath = /^\/api\/boards\/([A-Za-z0-9_-]+)\//.exec(p);
    if (boardPath) {
      const call = payload?.calls?.[0];
      return call?.tool === 'board_notice' ? [boardPath[1], call.args?.board].filter(Boolean) : [boardPath[1]];
    }
    const cardPath = /^\/api\/cards\/([^/]+)/.exec(p);
    if (cardPath) return [store.cards[cardPath[1]]?.board || payload?.board].filter(Boolean);
    const commentPath = /^\/api\/comments\/([^/]+)/.exec(p);
    if (commentPath) return [store.comments[commentPath[1]]?.board].filter(Boolean);
    if (p === '/api/comments' && payload?.cardId) return [store.cards[payload.cardId]?.board].filter(Boolean);
    if (p !== '/api/global' && payload?.board) return [payload.board];
    if (p === '/api/attachments' && (who?.board || req.headers['x-lighthouse-board']))
      return [who?.board || req.headers['x-lighthouse-board']];
    if (p === '/api/attachments' && !who?.sessionId) return [];
    return Object.keys(store.boards).filter(board => ctx.roleOn(who, board) >= (p === '/api/global' ? 2 : 1));
  }
  function authorize(route, req, targets) {
    ctx.registry?.refresh();
    const { p, payload, who } = route;
    const humanRoute =
      (req.method === 'POST' && /^\/api\/(comments|bundles|global|attachments)$/.test(p)) ||
      /^\/api\/(cards\/[^/]+\/resolve|comments\/[^/]+\/decide)$/.test(p);
    for (const board of targets.filter(ownership.enabled)) {
      if (p.endsWith('/heartbeat') && ctx.handoff?.enabled(board)) {
        ownership.holding(who, board, who?.epoch);
        continue;
      }
      if (!who?.sessionId && who?.via === 'page' && humanRoute) continue;
      if (p.endsWith('/calls')) {
        const calls = payload?.calls;
        const call = Array.isArray(calls) && calls.length === 1 ? calls[0] : null;
        const source = /^\/api\/boards\/([^/]+)\//.exec(p)?.[1];
        if (call?.tool === 'board_notice' && board !== source && ctx.canNotice(who, source, call.args?.board)) continue;
        if (call?.tool === '_relay_result' && !call.queued && !call.args?.dry_run) {
          const args = call.args || {};
          const ledgerTicket = ctx.dispatchLedger?.enabled(board) && ctx.store.tickets?.[args.ticket]?.ledgerIntentId;
          ownership.evidence(
            who,
            board,
            ledgerTicket ? (args.originEpoch ?? who.epoch) : who.epoch,
            args.ticket,
            args.evidenceCapability,
            args.originSessionId,
          );
          continue;
        }
        ownership.acting(who, board, who?.epoch);
        continue;
      }
      if (who?.sessionScope === 'collector' && /\/(chat|events|transcript|instruments)$/.test(p)) {
        ownership.acting(who, board, who.epoch, 'collector');
        continue;
      }
      if (p === '/api/comments' && payload?.kind === 'notice' && ctx.isCoordinatorOn(who, board)) continue;
      if (ownership.captain(who, board) && !/\/(events|activity|heartbeat|chat|transcript|instruments)$/.test(p))
        continue;
      ownership.acting(who, board, who?.epoch);
      if (/\/(events|chat|transcript|instruments)$/.test(p)) ownership.refuse('collector scope required');
    }
  }
  async function route(req, res, info, groups) {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      for (const group of groups) {
        const result = group(req, res, info);
        if (result !== NEXT) return result;
      }
      return NEXT;
    }
    const matches = new RegExp(
      '^/api/(bundles|comments(?:/[^/]+(?:/decide)?)?|global|attachments|' +
        'cards/[^/]+(?:/resolve)?|boards/[^/]+/' +
        '(calls|status|authorities|chat|events|shift|heartbeat|activity|transcript|instruments|archive))$',
    );
    if (!matches.test(info.p)) return NEXT;
    const input = { ...info };
    if (info.p === '/api/attachments') {
      if (!info.who) return ctx.send(res, 403, { error: 'no comment rights' }, info.cors);
      try {
        input.raw = await ctx.readRaw(req, 10 * 1024 * 1024);
      } catch (error) {
        input.rawError = error;
      }
    } else input.payload = await ctx.readBody(req).catch(() => null);
    const targets = boards(input, req);
    if (info.who?.via === 'api' && !info.who.sessionId && ['tools', 'lines', 'collector'].includes(info.who.mode))
      for (const board of targets)
        if (ctx.roleOn(info.who, board) >= 3)
          ownership.observeLegacy(board, ownership.hash(info.who.name + '|' + info.who.mode).slice(0, 16));
    const dispatch = () => {
      for (const group of groups) {
        const result = group(req, res, input);
        if (result !== NEXT) return result;
      }
      return NEXT;
    };
    if (!targets.some(ownership.enabled) && !info.who?.sessionId) return dispatch();
    return ctx.transact(() => authorize(input, req, targets), dispatch);
  }
  return { route, authorize, boards };
};
