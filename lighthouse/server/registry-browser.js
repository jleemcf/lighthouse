'use strict';
const crypto = require('node:crypto');
const { digest, secret, fail } = require('./registry');

function makeBrowser(ctx, clock = Date.now) {
  const sessions = new Map();
  const cookieName =
    'lhadmin_' +
    crypto
      .createHash('sha256')
      .update(ctx.CONFIG_PATH || '')
      .digest('hex')
      .slice(0, 12);
  function registrySession(req) {
    if (ctx.cfg?.enrollment?.enabled !== true) return null;
    const value = (req.headers.cookie || '')
      .split(';')
      .map(part => part.trim())
      .find(part => part.startsWith(cookieName + '='));
    const session = value && sessions.get(digest(value.slice(cookieName.length + 1)));
    if (!session || session.expires <= clock() || !ctx.registry.credentials().admins[session.verifier]) return null;
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      let expected = (req.socket.encrypted ? 'https://' : 'http://') + req.headers.host;
      const origin = ctx.cfg.enrollment.browserOrigin;
      if (origin && /^(127\.0\.0\.1|::1|::ffff:127\.0\.0\.1)$/.test(req.socket.remoteAddress || '')) {
        try {
          const configured = new URL(origin);
          if (configured.protocol !== 'https:' || configured.origin !== origin) return null;
          expected = origin;
        } catch {
          return null;
        }
      }
      if (req.headers.origin !== expected) return null;
    }
    return session.who;
  }
  function login(req, res, who) {
    if (ctx.cfg.enrollment?.enabled !== true || !ctx.registry.persistent || !who?.hostAdmin)
      throw fail('host administrator required on an enabled schema 2 host', 403);
    const token = secret();
    for (const [key, session] of sessions) if (session.expires <= clock()) sessions.delete(key);
    if (sessions.size >= 100) throw fail('too many administration sessions', 429);
    sessions.set(digest(token), {
      who: { ...who, via: 'page' },
      expires: clock() + 1800000,
      verifier: digest(req.headers.authorization.slice(7).trim()),
    });
    const secure = req.socket.encrypted || ctx.cfg.enrollment?.browserOrigin ? '; Secure' : '';
    res.setHeader(
      'Set-Cookie',
      cookieName + '=' + token + '; Path=/; HttpOnly; SameSite=Strict; Max-Age=1800' + secure,
    );
    return { signedIn: true };
  }
  function logout(req, res) {
    const value = (req.headers.cookie || '')
      .split(';')
      .map(part => part.trim())
      .find(part => part.startsWith(cookieName + '='));
    if (value) sessions.delete(digest(value.slice(cookieName.length + 1)));
    const secure = req.socket.encrypted || ctx.cfg.enrollment?.browserOrigin ? '; Secure' : '';
    res.setHeader('Set-Cookie', cookieName + '=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0' + secure);
    return { signedIn: false };
  }
  return { registrySession, login, logout };
}
module.exports = { makeBrowser };
