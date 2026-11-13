'use strict';
module.exports = function activationRoutes(ctx) {
  return async (req, res, route) => {
    const match = /^\/api\/boards\/([A-Za-z0-9_-]+)\/activation$/.exec(route.p);
    if (!match) return ctx.NEXT;
    const board = match[1];
    if (!ctx.ownership.captain(route.who, board) && !route.who?.sessionId)
      return ctx.send(res, 403, { error: 'board captain or explicit session required' });
    if (ctx.roleOn(route.who, board) < 3 || route.who?.shadow || route.who?.sessionScope === 'collector')
      return ctx.send(res, 403, { error: 'no activation authority on this board' });
    if (!/^Bearer /i.test(req.headers.authorization || '') || req.headers.origin || Object.keys(route.q).length)
      return ctx.send(res, 403, { error: 'private bearer controls required; no forms or query credentials' });
    if (!require('./registry-routes').loopback(req.socket.remoteAddress) && !req.socket.encrypted)
      return ctx.send(res, 403, { error: 'activation requires TLS off loopback' });
    if (req.method === 'GET') return ctx.send(res, 200, ctx.activation.status(board));
    if (req.method !== 'POST') return ctx.send(res, 405, { error: 'method' });
    const body = await ctx.readBody(req).catch(() => null);
    if (!body) return ctx.send(res, 400, { error: 'invalid activation request' });
    return ctx.send(res, 200, ctx.activation.control(board, route.who, body));
  };
};
