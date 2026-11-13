'use strict';
module.exports = function dispatchRoutes(ctx) {
  return async (req, res, route) => {
    const match = /^\/api\/boards\/([A-Za-z0-9_-]+)\/dispatch-ledger$/.exec(route.p);
    if (!match) return ctx.NEXT;
    const board = match[1];
    if (ctx.roleOn(route.who, board) < 3 || route.who?.sessionScope === 'collector' || route.who?.shadow)
      return ctx.send(res, 403, { error: 'operator session or board owner required' });
    if (req.method === 'GET') return ctx.send(res, 200, ctx.dispatchLedger.status(board));
    if (req.method !== 'POST') return ctx.send(res, 405, { error: 'method' });
    if (!/^Bearer /i.test(req.headers.authorization || '') || req.headers.origin || Object.keys(route.q).length)
      return ctx.send(res, 403, { error: 'private bearer controls required; no browser forms or query credentials' });
    if (!require('./registry-routes').loopback(req.socket.remoteAddress) && !req.socket.encrypted)
      return ctx.send(res, 403, { error: 'ledger controls require TLS off loopback' });
    const body = await ctx.readBody(req).catch(() => null);
    if (!body) return ctx.send(res, 400, { error: 'invalid ledger request' });
    return ctx.send(res, 200, ctx.dispatchLedger.control(board, route.who, body));
  };
};
