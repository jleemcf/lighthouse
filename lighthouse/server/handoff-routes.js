'use strict';
module.exports = function handoffRoutes(ctx) {
  return async (req, res, route) => {
    const match = /^\/api\/boards\/([A-Za-z0-9_-]+)\/handoff$/.exec(route.p);
    if (!match) return ctx.NEXT;
    const board = match[1];
    if (
      ['collector', 'steward'].includes(route.who?.mode) ||
      route.who?.sessionScope === 'collector' ||
      route.who?.shadow
    )
      return ctx.send(res, 403, { error: 'handoff requires an operator or board reader' });
    if (ctx.roleOn(route.who, board) < 1) return ctx.send(res, 403, { error: 'no board access' });
    if (req.method === 'GET')
      return ctx.send(res, 200, {
        ...ctx.handoff.status(board),
        ...(ctx.handoff.enabled(board) ? { checkpointRecord: ctx.handoff.checkpoint(board) } : {}),
      });
    if (req.method !== 'POST') return ctx.send(res, 405, { error: 'method' });
    if (!/^Bearer /i.test(req.headers.authorization || '') || req.headers.origin || route.q.token)
      return ctx.send(res, 403, {
        error: 'use private bearer handoff controls, not browser forms or query credentials',
      });
    if (!require('./registry-routes').loopback(req.socket.remoteAddress) && !req.socket.encrypted)
      return ctx.send(res, 403, { error: 'handoff requires TLS off loopback' });
    const body = await ctx.readBody(req).catch(() => null);
    if (!body || Object.keys(route.q).length) return ctx.send(res, 400, { error: 'invalid handoff request' });
    return ctx.send(res, 200, ctx.handoff.control(board, route.who, body));
  };
};
