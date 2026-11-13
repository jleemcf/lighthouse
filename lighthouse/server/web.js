'use strict';
// Requests: who is asking (a token, or Tailscale's own header), the role a name has on each board, and reading and
// answering an HTTP request.
const zlib = require('zlib');
const access = require('./access');

// a route group answers NEXT when none of its routes matched, so the next group is tried
const NEXT = Symbol('next route');

module.exports = function makeWeb(ctx) {
  const { cfg } = ctx;
  const compatibility = ctx.compatibility || require('./compatibility').codec(cfg);
  // ---------- identity ----------
  // watch: reads a board and may leave a NOTICE on it, nothing else
  const ROLE_RANK = access.ranks;
  const membership = (name, board) => cfg.boards?.[board]?.access?.[name];
  const isWatchOn = (name, board) => access.hasRole(membership(name, board), 'watch');
  function principalOf(req, q) {
    const auth = req.headers['authorization'] || '';
    if (!auth) {
      const administrator = ctx.registrySession?.(req);
      if (administrator) return administrator;
    }
    let token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : q.token || '';
    if (!token) {
      const m = /(?:^|;\s*)lhtoken=([^;]+)/.exec(req.headers.cookie || '');
      if (m) {
        try {
          token = decodeURIComponent(m[1]);
        } catch {
          token = '';
        }
      }
    }
    if (token && cfg.tokens && cfg.tokens[token]) {
      const tk = cfg.tokens[token];
      return {
        name: tk.name,
        source: 'token',
        via: tk.via || 'api',
        mode: tk.mode || 'lines',
        shadow: !!tk.shadow,
        board: tk.board || null,
      };
    }
    if (auth.startsWith('Bearer ')) {
      const session = ctx.ownership?.authenticate(token);
      if (session) {
        const epoch = req.headers['x-lighthouse-epoch'];
        session.epoch = /^(0|[1-9][0-9]*)$/.test(String(epoch || '')) ? Number(epoch) : null;
        return session;
      }
      const enrolled = ctx.enrollment?.authenticate(token);
      if (enrolled) return enrolled;
    }
    const remote = req.socket.remoteAddress || '';
    if (
      cfg.trustTailscaleHeaders &&
      /^(::1|127\.0\.0\.1|::ffff:127\.0\.0\.1)$/.test(remote) &&
      req.headers['tailscale-user-login']
    ) {
      const login = String(req.headers['tailscale-user-login']);
      const mapped = (cfg.tailscaleUsers || {})[login];
      return { name: mapped || login, source: 'tailscale', via: 'page' };
    }
    return null;
  }
  function roleOn(p, board) {
    if (!p) return 0;
    if (ctx.registry && !ctx.registry.board(board)) return 0;
    if (p.installationId && p.board !== board) return 0;
    if (p.installationId && ctx.registry) {
      const installed = ctx.registry.credentials().installations[p.installationId];
      if (!installed || installed.revoked || installed.version !== p.installationVersion) return 0;
    }
    const acc = ((cfg.boards || {})[board] || {}).access || {};
    const r = Object.hasOwn(acc, p.name) ? acc[p.name] : (cfg.defaultRole || {})[p.name] || null;
    let rank = access.rank(r);
    if (p.sessionId) rank = Math.min(rank, p.board === board ? 3 : isWatchOn(p.name, board) ? 1 : 0);
    if (p.installationId) rank = Math.min(rank, ROLE_RANK[p.installationRole] || 0);
    if (ctx.registry?.board(board)?.lifecycle === 'archived') rank = Math.min(rank, 1);
    return rank;
  }
  function canNotice(principal, source, target) {
    if (roleOn(principal, source) < 1 || roleOn(principal, target) < 1) return false;
    const boards = cfg.boards || {};
    if (boards[source]?.lifecycle === 'archived' || boards[target]?.lifecycle === 'archived') return false;
    if (principal.installationId && principal.installationRole !== 'watch') return false;
    return isWatchOn(principal.name, target);
  }
  const isCoordinatorOn = (p, board) =>
    roleOn(p, board) >= 1 &&
    cfg.boards?.[board]?.lifecycle !== 'archived' &&
    access.hasRole(membership(p.name, board), 'coordinator') &&
    (!p.installationId || p.installationRole === 'coordinator');
  const isOwner = p => p && Object.values(cfg.boards || {}).some(b => access.hasRole(b.access?.[p.name], 'owner'));

  // ---------- helpers ----------
  // A reply over 16 KB goes compressed to a client that asks for it: the page's state runs to megabytes and is read
  // again at every change, over a remote link. The compressing runs off the main thread, so a big reply never holds up
  // the others; the board's own scripts, which do not ask, get it plain
  function send(res, code, body, headers) {
    if (ctx.inTransaction?.()) return ctx.afterCommit(() => send(res, code, body, headers));
    const h = Object.assign(
      { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
      headers || {},
    );
    const text = typeof body === 'string' ? body : JSON.stringify(compatibility.wire(body));
    const gzip = String((res.req && res.req.headers['accept-encoding']) || '')
      .split(',')
      .find(value => /^\s*gzip(?:\s*;|\s*$)/i.test(value));
    const quality = gzip && /;\s*q=([0-9.]+)/i.exec(gzip);
    if (text.length < 16384 || !gzip || (quality && Number(quality[1]) === 0)) {
      res.writeHead(code, h);
      return res.end(text);
    }
    zlib.gzip(text, { level: 4 }, (err, z) => {
      if (res.writableEnded || res.destroyed) return;
      if (err) {
        res.writeHead(code, h);
        return res.end(text);
      }
      res.writeHead(
        code,
        Object.assign(h, { 'Content-Encoding': 'gzip', 'Content-Length': z.length, Vary: 'Accept-Encoding' }),
      );
      res.end(z);
    });
  }
  function readBody(req) {
    return new Promise((resolve, reject) => {
      let d = '';
      req.setEncoding('utf8');
      req.on('data', c => {
        d += c;
        if (d.length > 2e6) {
          reject(new Error('body too large'));
          req.destroy();
        }
      });
      req.on('end', () => {
        try {
          resolve(compatibility.read(d ? JSON.parse(d) : {}));
        } catch (e) {
          reject(e);
        }
      });
      req.on('error', reject);
      req.on('aborted', () => reject(new Error('request aborted')));
    });
  }
  function readRaw(req, max) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      let n = 0;
      req.on('data', c => {
        n += c.length;
        if (n > max) {
          reject(new Error('body too large'));
          req.destroy();
          return;
        }
        chunks.push(c);
      });
      req.on('end', () => resolve(Buffer.concat(chunks)));
      req.on('error', reject);
      req.on('aborted', () => reject(new Error('request aborted')));
    });
  }

  return {
    NEXT,
    ROLE_RANK,
    isWatchOn,
    isCoordinatorOn,
    canNotice,
    principalOf,
    roleOn,
    isOwner,
    send,
    readBody,
    readRaw,
  };
};
