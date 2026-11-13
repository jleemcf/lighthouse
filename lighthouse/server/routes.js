'use strict';
const { ownerId, isOwnerName } = require('./configuration');
// The HTTP entry: who may call what, the page and its static files, the board reads, and the order the route
// groups are tried in.
const fs = require('fs'),
  path = require('path');

module.exports = function makeRoutes(ctx) {
  const { cfg, store, PUBLIC, CLAIMS, WX, NEXT, principalOf, roleOn, isOwner, send, readBody, readRaw } = ctx;
  const { quietEntry, sseClients, importData, pushRoutes, messageRoutes, cardRoutes, operatorRoutes } = ctx;
  const handoffRoutes = require('./handoff-routes')(ctx);
  const dispatchRoutes = require('./dispatch-routes')(ctx);
  const activationRoutes = require('./activation-routes')(ctx);

  // ---------- routes ----------
  async function handle(req, res) {
    ctx.registry?.refresh();
    ctx.registry?.ensureBoards(store);
    const u = new URL(req.url, 'http://localhost'),
      q = Object.fromEntries(u.searchParams),
      p = u.pathname;
    const who = principalOf(req, q);
    const cors = cfg.allowOrigin
      ? {
          'Access-Control-Allow-Origin': cfg.allowOrigin,
          'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Lighthouse-Epoch, X-Lighthouse-Board',
          'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,OPTIONS',
        }
      : {};
    // what a route group is handed besides the request and the response
    const route = { q, p, who, cors };
    const dispatchResult = await dispatchRoutes(req, res, route);
    if (dispatchResult !== NEXT) return dispatchResult;
    const activationResult = await activationRoutes(req, res, route);
    if (activationResult !== NEXT) return activationResult;
    const handoffResult = await handoffRoutes(req, res, route);
    if (handoffResult !== NEXT) return handoffResult;
    const ownershipPath = /^\/api\/boards\/([A-Za-z0-9_-]+)\/ownership$/.exec(p);
    if (ownershipPath) {
      const board = ownershipPath[1];
      if (roleOn(who, board) < 1) return send(res, 403, { error: 'no board access' }, cors);
      if (req.method === 'GET') return send(res, 200, ctx.ownership.publicRecord(board), cors);
      if (req.method !== 'POST') return send(res, 405, { error: 'method' }, cors);
      if (!/^Bearer /i.test(req.headers.authorization || '') || req.headers.origin || u.search)
        return send(
          res,
          403,
          { error: 'private bearer control required; no query credentials or browser forms' },
          cors,
        );
      if (!require('./registry-routes').loopback(req.socket.remoteAddress) && !req.socket.encrypted)
        return send(res, 403, { error: 'session controls require TLS off loopback' }, cors);
      const body = await readBody(req).catch(() => null);
      if (!body) return send(res, 400, { error: 'bad json' }, cors);
      return send(res, 200, ctx.ownership.control(board, who, body), cors);
    }
    if (ctx.registryRoutes) {
      const result = await ctx.registryRoutes(req, res, route);
      if (result !== NEXT) return result;
    }
    if (req.method === 'OPTIONS') return send(res, 204, '', cors);

    if (req.method === 'GET' && (p === '/' || p === '/index.html')) {
      const f = path.join(PUBLIC, 'index.html');
      const html = fs.existsSync(f)
        ? fs.readFileSync(f, 'utf8')
        : '<!doctype html><title>Lighthouse</title><p>No page installed.';
      const h = { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' };
      const had = /(?:^|;\s*)lhtoken=([^;]+)/.exec(req.headers.cookie || ''),
        hadOk =
          had &&
          cfg.tokens &&
          cfg.tokens[
            (() => {
              try {
                return decodeURIComponent(had[1]);
              } catch (e) {
                return '';
              }
            })()
          ];
      // a link never replaces a signed-in session that this board knows; a cookie it does not know (another board on
      // the same host shares cookies across ports) is replaced
      if (q.token && cfg.tokens && cfg.tokens[q.token] && !hadOk)
        h['Set-Cookie'] = `lhtoken=${encodeURIComponent(q.token)}; Path=/; SameSite=Lax; Max-Age=31536000`;
      return send(res, 200, html, h);
    }
    const STATIC = {
      '/manifest.webmanifest': 'application/manifest+json',
      '/sw.js': 'text/javascript; charset=utf-8',
      '/icon-192.png': 'image/png',
      '/icon-512.png': 'image/png',
      '/apple-touch-icon.png': 'image/png',
    };
    if (req.method === 'GET' && STATIC[p]) {
      // the home-screen app and its notification worker; nothing here is private
      const f = path.join(PUBLIC, p.slice(1));
      if (!fs.existsSync(f)) return send(res, 404, { error: 'not installed' }, cors);
      const h = { 'Content-Type': STATIC[p], 'Cache-Control': 'no-cache' };
      if (p === '/sw.js') h['Service-Worker-Allowed'] = '/';
      res.writeHead(200, h);
      return res.end(fs.readFileSync(f));
    }
    if (p === '/api/push' || p.startsWith('/api/push/')) return pushRoutes(req, res, route);
    // TOOLCALL-DESIGN §3: the legacy routes cannot undo the records
    if (
      who &&
      who.mode === 'tools' &&
      req.method !== 'GET' &&
      !/^\/api\/(attachments|push|client-error|boards\/[A-Za-z0-9_-]+\/(calls|status|shift|heartbeat))/.test(p)
    )
      return send(res, 403, { error: 'a tool-mode token writes only through /api/boards/<board>/calls' }, cors);
    // a collector token (the tool-mode home's second token, used only by collector.py) reports and does nothing else:
    // it cannot read the board, answer, or act, so the operator's own token can be a tool-mode one
    if (
      who &&
      who.mode === 'collector' &&
      p !== '/api/whoami' &&
      !(
        req.method === 'POST' &&
        /^\/api\/(attachments|boards\/[A-Za-z0-9_-]+\/(events|transcript|instruments|chat))$/.test(p)
      )
    )
      return send(
        res,
        403,
        { error: 'a collector token only reports lines, the transcript, instruments and chat words' },
        cors,
      );
    // a steward token (STEWARD-ASSISTANT-DESIGN.md) is held by the kit's stwake.cjs, never the model: it claims jobs,
    // posts results, a diagram and a heartbeat for its one board, and reads nothing else
    if (who && who.mode === 'steward' && !/^\/api\/steward\/(next|result|heartbeat|review|diagram)$/.test(p))
      return send(res, 403, { error: 'a steward token only claims jobs and posts their results' }, cors);
    if (
      p.startsWith('/api/steward/') ||
      /^\/api\/boards\/[A-Za-z0-9_-]+\/steward$/.test(p) ||
      /^\/api\/advice\/[a-f0-9]{16}(\/put)?$/.test(p)
    ) {
      if (!who) return send(res, 401, { error: 'no access' }, cors);
      if (p.startsWith('/api/steward/') && who.mode !== 'steward')
        return send(res, 403, { error: "the steward's own routes" }, cors);
      const r = await ctx.ST.route(req, p, q, who, {
        body: () => readBody(req).catch(() => null),
        raw: n => readRaw(req, n),
      });
      if (r) return send(res, r.status, r.body, cors);
    }
    if (p === '/api/whoami')
      return send(
        res,
        200,
        {
          principal: who ? who.name : null,
          source: who ? who.source : null,
          capabilities: {
            sessionOwnership: 'session-epochs-v1',
            handoff: 'board-checkpoint-v1',
            dispatchLedger: 'dispatch-ledger-v1',
          },
          roles: Object.fromEntries(
            Object.keys(store.boards)
              .filter(board => roleOn(who, board) >= 1)
              .map(board => [board, roleOn(who, board)]),
          ),
        },
        cors,
      );
    if (req.method === 'POST' && p === '/api/client-error') {
      // the page's own errors, to the log, for faults that cannot be reproduced elsewhere
      const b = (await readBody(req).catch(() => null)) || {};
      console.log(
        `client error (${who ? who.name : 'nobody'}, view ${b.view || '?'}, panel ${
          b.panel || '-'
        }): ${String(b.text || '').slice(0, 800)} | ${String(b.ua || '').slice(0, 120)}`,
      );
      return send(res, 204, '', cors);
    }
    // A claim carries a token to another machine without carrying a file: `board.sh claim <name>` on the board machine
    // writes a one-time code good for an hour; the operator's `shift.sh claim <code>` exchanges it here for that
    // identity's token, straight into its token files. The code is the only credential this route takes; it is spent on
    // first use and never returns the same token twice.
    if (req.method === 'POST' && p === '/api/claim') {
      const b = await readBody(req).catch(() => null);
      const code = String((b && b.code) || '')
        .trim()
        .toUpperCase();
      if (!/^[A-Z0-9]{8}$/.test(code))
        return send(res, 400, { error: 'a claim code is eight letters and digits' }, cors);
      const f = path.join(CLAIMS, code + '.json');
      let claim = null;
      try {
        claim = JSON.parse(fs.readFileSync(f, 'utf8'));
      } catch {
        claim = null;
      }
      // spent, whatever happens next
      if (claim) {
        try {
          fs.unlinkSync(f);
        } catch {}
      }
      if (!claim || !(claim.exp > Date.now()))
        return send(res, 404, { error: 'no such claim, or it expired; ask Owner for a fresh code' }, cors);
      // one name can hold several tokens at a switch (lines, shadow, tool mode, collector): the claim names which
      // (board.sh claim <name> <kind>); steward is the advice steward's own token, for stwake.cjs
      const kind = ['lines', 'tools', 'shadow', 'collector', 'steward'].includes(claim.kind) ? claim.kind : 'lines';
      const fits = v => (kind === 'shadow' ? !!v.shadow : !v.shadow && (v.mode || 'lines') === kind);
      const tok = Object.keys(cfg.tokens || {}).find(
        t =>
          (cfg.tokens[t] || {}).name === claim.name && (cfg.tokens[t] || {}).via === 'api' && fits(cfg.tokens[t] || {}),
      );
      if (!tok) return send(res, 404, { error: `no ${kind} token is issued for ${claim.name}` }, cors);
      console.log(`claim [used] (${kind}) spent by ${claim.name} from ${req.socket.remoteAddress}`);
      return send(res, 200, { name: claim.name, token: tok, kind }, cors);
    }
    if (!who)
      return send(
        res,
        401,
        { error: 'no identity: open the board through the link you were given, or send a bearer token' },
        cors,
      );

    if (req.method === 'GET' && p === '/api/state') {
      const boards = {},
        cards = {};
      const configured = cfg.boards || {};
      const rank = id => (Number.isFinite(configured[id]?.order) ? configured[id].order : Infinity);
      const ids = Object.keys(configured).sort((left, right) => rank(left) - rank(right));
      ids.push(...Object.keys(store.boards).filter(id => !Object.hasOwn(configured, id)));
      let position = 0;
      for (const id of ids) {
        const b = store.boards[id],
          presentation = configured[id] || {};
        if (!b) continue;
        if (roleOn(who, id) >= 1) {
          const tx = b.transcript || [],
            last = tx.filter(e => !quietEntry(e)).pop() || null;
          boards[id] = Object.assign({}, b, {
            name: presentation.name || b.name || id,
            displayName: presentation.displayName || presentation.name || b.name || id,
            order: position++,
            protocol: ((cfg.boards || {})[id] || {}).protocol || 'lines',
            lifecycle: ctx.registry?.board(id)?.lifecycle || 'active',
            version: ctx.registry?.board(id)?.version,
            ...(ctx.handoff?.enabled(id)
              ? { handoff: { ...ctx.handoff.status(id), canManage: ctx.ownership.captain(who, id) } }
              : {}),
            transcript: undefined,
            transcriptCount: tx.length,
            transcriptLast: last ? last.t : null,
            transcriptLastRole: last ? last.role : null,
            yolo: (y => (y ? { sid: y.sid, since: y.t, scope: y.yoloScope || null } : null))(ctx.TC.yoloOf(id)),
          });
        }
      }
      // a card done for more than three days rides without its log and context, which would otherwise be most of every
      // read; the Done lane shows the newest few, and a card he opens comes whole from /api/cards/<id>
      const liteBefore = Date.now() - 3 * 86400000;
      for (const [id, c] of Object.entries(store.cards))
        if (boards[c.board])
          cards[id] =
            c.status === 'done' && Date.parse(c.updatedAt || c.createdAt || 0) < liteBefore
              ? Object.assign({}, c, {
                  log: undefined,
                  context: undefined,
                  detail: undefined,
                  judge: undefined,
                  lite: true,
                  logN: (c.log || []).length,
                })
              : c;
      // the Home feed: the newest messages across the boards this identity can read
      const recent = Object.values(store.comments)
        .filter(c => boards[c.board])
        .sort((x, y) => (y.t || '').localeCompare(x.t || ''))
        .slice(0, 120);
      return send(
        res,
        200,
        Object.assign(
          {
            seq: store.seq,
            boards,
            cards,
            recent,
            weather: WX.data,
            doorbells: ctx.doorbellStatus(boards),
            ownerId: cfg.ownerId,
            ownerAliases: cfg.ownerAliases || [],
            ownerName: cfg.ownerName,
            timeZone: cfg.timeZone,
            timeZoneLabel: cfg.timeZoneLabel,
          },
          ctx.ST.forPage(boards, who),
        ),
        cors,
      );
    }
    {
      // one card whole: an old finished card, when he opens it
      const mc = /^\/api\/cards\/([A-Za-z0-9_.:-]+)$/.exec(p);
      if (req.method === 'GET' && mc) {
        const c = Object.prototype.hasOwnProperty.call(store.cards, mc[1]) ? store.cards[mc[1]] : null;
        if (!c || roleOn(who, c.board) < 1) return send(res, 404, { error: 'no such card' }, cors);
        return send(res, 200, { card: c }, cors);
      }
    }
    if (req.method === 'GET' && p === '/api/weather') {
      if (!who) return send(res, 401, { error: 'no access' }, cors);
      return send(res, 200, { configured: !!cfg.weather, weather: WX.data, error: WX.error }, cors);
    }
    if (req.method === 'GET' && p === '/api/changes') {
      const since = Number(q.since || 0);
      const list = store.changes.filter(c => c.seq > since && (!c.board || roleOn(who, c.board) >= 1));
      return send(res, 200, { seq: store.seq, changes: list.slice(-500) }, cors);
    }
    if (req.method === 'GET' && p === '/api/stream') {
      res.writeHead(
        200,
        Object.assign(
          { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' },
          cors,
        ),
      );
      res.write(`event: hello\ndata: ${JSON.stringify({ seq: store.seq })}\n\n`);
      const client = { res, who };
      sseClients.add(client);
      const ka = setInterval(() => {
        try {
          res.write(': keepalive\n\n');
        } catch {
          clearInterval(ka);
        }
      }, 25000);
      // a page that goes away takes its keepalive with it
      req.on('close', () => {
        sseClients.delete(client);
        clearInterval(ka);
      });
      return;
    }
    if (req.method === 'GET' && p === '/api/comments') {
      const list = Object.values(store.comments).filter(
        c =>
          (!q.board || c.board === q.board) &&
          (!q.cardId || c.cardId === q.cardId) &&
          (!q.general || (c.cardId == null && c.kind !== 'direct')) &&
          (!q.bundleId || c.bundleId === q.bundleId) &&
          (q.handled === undefined || String(!!c.handled) === String(q.handled === 'true')) &&
          roleOn(who, c.board) >= 1,
      );
      list.sort((a, b) => (a.t || '').localeCompare(b.t || ''));
      // last=N: only the newest N, with the whole count and how many of his still wait, so a long General is not read
      // whole every time
      const last = Number(q.last) > 0 ? Math.floor(Number(q.last)) : 0,
        shown = last && list.length > last ? list.slice(-last) : list;
      // short ids for Owner's messages, notices and prompts (TOOLCALL-DESIGN §4)
      for (const c of shown) ctx.TC.ensureSid(c);
      return send(
        res,
        200,
        last
          ? {
              comments: shown,
              total: list.length,
              waiting: list.filter(c => isOwnerName(ctx.cfg, c.by) && !c.handled).length,
            }
          : { comments: list },
        cors,
      );
    }
    // the route groups, in order: each answers NEXT when none of its routes matched
    const result = await ctx.mutations.route(req, res, route, [messageRoutes, cardRoutes, operatorRoutes]);
    if (result !== NEXT) return result;
    if (req.method === 'POST' && p === '/api/import') {
      if (!who.hostAdmin || !/^Bearer /i.test(req.headers.authorization || ''))
        return send(res, 403, { error: 'explicit host administrator bearer required' }, cors);
      if (Object.keys(store.boards).some(ctx.ownership.enabled))
        return send(res, 409, { error: 'import requires separate fenced migration on activated boards' }, cors);
      const b = await readBody(req).catch(() => null);
      if (!b) return send(res, 400, { error: 'bad json' }, cors);
      return send(res, 200, importData(b, who.name), cors);
    }
    send(res, 404, { error: 'no such route' }, cors);
  }

  return { handle };
};
