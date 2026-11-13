'use strict';
const crypto = require('node:crypto');
const { fail } = require('./registry');

const loopback = address => /^(127\.0\.0\.1|::1|::ffff:127\.0\.0\.1)$/.test(address || '');

function makeRegistryRoutes(ctx) {
  const browser = require('./registry-browser').makeBrowser(ctx, ctx.registryClock || Date.now);
  const management = require('./registry-management').makeManagement(ctx);
  const csrfKey = crypto.randomBytes(32);
  const attempts = new Map();
  const clock = ctx.registryClock || Date.now;
  let windowStart = clock(),
    total = 0;
  const csrf = who =>
    crypto
      .createHmac('sha256', csrfKey)
      .update(JSON.stringify([who.name, who.source, who.board]))
      .digest('base64url');
  function limit(req) {
    const now = clock();
    if (now - windowStart >= 60000) {
      attempts.clear();
      total = 0;
      windowStart = now;
    }
    const reading = req.method === 'GET';
    const address = (reading ? 'read:' : 'write:') + (req.socket.remoteAddress || '');
    const count = (attempts.get(address) || 0) + 1;
    attempts.set(address, count);
    total++;
    if (count > (reading ? 120 : 20) || total > 200) throw fail('registry request limit; try later', 429);
  }
  async function registryRoutes(req, res, route) {
    const { p, who } = route;
    if (!p.startsWith('/api/registry/') && !p.startsWith('/api/enrollment/')) return ctx.NEXT;
    if (who?.sessionId) return ctx.send(res, 403, { error: 'session credentials have no administration scope' });
    const answer = (status, body) => ctx.send(res, status, body);
    try {
      limit(req);
      if (!loopback(req.socket.remoteAddress) && !req.socket.encrypted)
        throw fail('registry administration and enrollment require TLS off loopback', 403);
      if (new URL(req.url, 'http://localhost').search) throw fail('registry credentials never belong in URLs');
      const origin = req.headers.origin;
      let expected = (req.socket.encrypted ? 'https://' : 'http://') + req.headers.host;
      const browserOrigin = ctx.cfg?.enrollment?.browserOrigin;
      if (browserOrigin && loopback(req.socket.remoteAddress)) {
        const configured = new URL(browserOrigin);
        if (configured.protocol !== 'https:' || configured.origin !== browserOrigin)
          throw fail('browserOrigin must be an exact HTTPS origin', 403);
        expected = browserOrigin;
      }
      if (origin && origin !== expected) throw fail('cross-origin registry requests are refused', 403);
      if (p === '/api/registry/context' && req.method === 'GET') return answer(200, management.context(who));
      if (p === '/api/registry/session' && req.method === 'POST') {
        if (origin !== expected || !String(req.headers.authorization || '').startsWith('Bearer '))
          throw fail('same-origin credential sign-in required', 403);
        return answer(200, browser.login(req, res, who));
      }
      if (p === '/api/enrollment/consume' && req.method === 'POST') {
        if (origin) throw fail('enrollment uses a protected file client, not browser forms', 403);
        const input = await ctx.readBody(req).catch(() => {
          throw fail('invalid enrollment JSON');
        });
        const result = ctx.enrollment.consume(input);
        ctx.registry.ensureBoards(ctx.store);
        return answer(200, result);
      }
      if (p === '/api/enrollment/doctor' && req.method === 'POST') {
        if (origin || !String(req.headers.authorization || '').startsWith('Bearer '))
          throw fail('doctor uses an installation client', 403);
        return answer(200, management.doctor(who, await ctx.readBody(req)));
      }
      if (!who || who.shadow || ['collector', 'steward'].includes(who.mode))
        throw fail('no administration access', 403);
      if (p === '/api/registry/csrf' && req.method === 'GET') return answer(200, { csrf: csrf(who) });
      if (req.method !== 'POST') throw fail('no such registry route', 404);
      if (
        (origin || !String(req.headers.authorization || '').startsWith('Bearer ')) &&
        req.headers['x-lighthouse-csrf'] !== csrf(who)
      )
        throw fail('registry CSRF check failed', 403);
      const action = p.slice('/api/registry/'.length);
      const input = await ctx.readBody(req).catch(() => {
        throw fail('invalid administration JSON');
      });
      let result;
      if (action === 'logout') result = browser.logout(req, res);
      else if (action === 'handoff') result = ctx.handoff.page(who, input);
      else if (action === 'grant') {
        let handoff;
        ctx.enrollment.issue(who, input, value => {
          handoff = value;
        });
        result = handoff;
        res.setHeader('Referrer-Policy', 'no-referrer');
        res.setHeader('X-Content-Type-Options', 'nosniff');
      } else if (action === 'revoke-grant') result = ctx.enrollment.revokeGrant(who, input);
      else if (action === 'member') result = management.member(who, input);
      else if (['revoke', 'rotate'].includes(action)) result = ctx.enrollment.installation(who, action, input);
      else result = ctx.lifecycle.change(who, action, input);
      ctx.registry.ensureBoards(ctx.store);
      return answer(200, result);
    } catch (error) {
      return answer(error.status || 503, {
        error: error.status ? error.message : 'registry unavailable; retry safely',
      });
    }
  }
  return { registryRoutes, registrySession: browser.registrySession };
}

module.exports = { makeRegistryRoutes, loopback };
