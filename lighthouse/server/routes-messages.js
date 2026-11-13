'use strict';
const { ownerId, isOwnerName } = require('./configuration');
const prompts = require('./prompt-transitions');
// The routes conversations are written through: bundles, comments, Global, attachments, and Owner's choice on a
// suggested prompt.
const fs = require('fs'),
  path = require('path');

module.exports = function makeMessageRoutes(ctx) {
  const { cfg, store, ATTACH, IMAGE_EXT, NEXT, roleOn, send, readBody, readRaw, now, newId, change, save } = ctx;
  const { sentBefore, remember, noteOperatorMessage, addTranscript, slugOf } = ctx;
  function messageRoutes(req, res, { q, p, who, cors, payload, raw, rawError }) {
    // A bundle: one message addressing several tasks, a comment per task and an optional general part, sent together.
    // Each part is filed in its own conversation with a shared bundleId; the change feed carries one 'bundle' change,
    // and the watcher prints the parts as one wake, each labelled with its task.
    if (req.method === 'POST' && p === '/api/bundles') {
      const b = payload;
      if (!b || !b.board || !store.boards[b.board]) return send(res, 400, { error: 'board required' }, cors);
      {
        const again = sentBefore(who, b);
        if (again) return send(res, again.status, again.body, cors);
      }
      if (roleOn(who, b.board) < 2) return send(res, 403, { error: 'no comment rights on this board' }, cors);
      const parts = Array.isArray(b.parts) ? b.parts.slice(0, 20) : [];
      for (const ids of [b.attachments, ...parts.map(part => part && part.attachments)]) {
        const referenceError = ctx.attachmentError(ids, who);
        if (referenceError) return send(res, 403, { error: referenceError }, cors);
      }
      // each part carries its own images; a bundle-level list, the older shape, lands on the general part or else the
      // first
      const attsOf = ids =>
        Array.isArray(ids)
          ? ids
              .map(id => store.attachments[String(id)])
              .filter(Boolean)
              .map(a => ({ id: a.id, name: a.name, type: a.type, size: a.size }))
          : [];
      const atts = attsOf(b.attachments);
      const clean = [];
      for (const pt of parts) {
        const text = String((pt && pt.text) || '').trim(),
          own = attsOf(pt && pt.attachments);
        if (!text && !own.length) continue;
        if (pt.cardId) {
          const card = store.cards[pt.cardId];
          if (!card || card.board !== b.board)
            return send(res, 404, { error: 'no such card on this board: ' + pt.cardId }, cors);
          clean.push({ card, text, own });
        } else clean.push({ card: null, text, own });
      }
      if (!clean.length)
        return send(res, 400, { error: 'a bundle needs at least one part with text or an image' }, cors);
      const bundleId = newId(),
        t = now(),
        agent = who.via === 'api' && roleOn(who, b.board) >= 3,
        made = [];
      const genIdx = clean.findIndex(x => !x.card),
        attachTo = genIdx >= 0 ? genIdx : 0;
      clean.forEach((x, i) => {
        const id = newId();
        store.comments[id] = {
          id,
          board: b.board,
          cardId: x.card ? x.card.id : null,
          cardTitle: x.card ? x.card.title : null,
          t,
          text: x.text.slice(0, 4000),
          by: who.name,
          via: who.via || 'api',
          handled: agent,
          replyTo: null,
          attachments: (i === attachTo ? atts : []).concat(x.own),
          bundleId,
          bundleSize: clean.length,
        };
        if (agent && x.card) noteOperatorMessage(x.card, t);
        if (!agent && x.text)
          addTranscript(store.boards[b.board], {
            t,
            role: 'owner',
            by: who.name,
            text: x.text.slice(0, 4000),
            via: x.card ? 'card ' + slugOf(b.board, x.card.id) : 'general',
          });
        made.push(store.comments[id]);
      });
      change('bundle', bundleId, who.name, b.board);
      return send(res, 201, remember(who, b, 'bundle', bundleId, { bundleId, parts: made }), cors);
    }
    if (req.method === 'POST' && p === '/api/comments') {
      const b = payload;
      const atts =
        b && Array.isArray(b.attachments)
          ? b.attachments
              .map(id => store.attachments[String(id)])
              .filter(Boolean)
              .map(a => ({ id: a.id, name: a.name, type: a.type, size: a.size }))
          : [];
      if (!b || (!b.text && !atts.length)) return send(res, 400, { error: 'text or an attachment required' }, cors);
      // a card's conversation (cardId), or the board's general conversation (board, no card): Owner's naked words
      let card = null,
        board = null;
      if (b.cardId) {
        card = store.cards[b.cardId];
        if (!card) return send(res, 404, { error: 'no such card' }, cors);
        board = card.board;
      } else {
        board = String(b.board || '');
        if (!store.boards[board]) return send(res, 400, { error: 'cardId or board required' }, cors);
      }
      const notice = b.kind === 'notice' && roleOn(who, board) < 4;
      if (notice && !ctx.isCoordinatorOn(who, board))
        return send(res, 403, { error: 'coordinator role required on this board' }, cors);
      if (!notice && roleOn(who, board) < 2) return send(res, 403, { error: 'no comment rights on this board' }, cors);
      {
        const again = sentBefore(who, b);
        if (again && notice && (again.body.board !== board || again.body.author !== 'coordinator'))
          return send(res, 409, { error: 'sendId already belongs to a different message' }, cors);
        if (again) return send(res, again.status, again.body, cors);
      }
      // Count saved notices across boards, so changing tokens or restarting cannot reset a principal's budget.
      if (
        notice &&
        Object.values(store.comments).filter(
          m => m.author === 'coordinator' && m.by === who.name && Date.parse(m.t) > Date.now() - 60000,
        ).length >= 20
      )
        return send(res, 429, { error: 'at most 20 coordinator notices per principal per minute' }, cors);
      const replyTarget = b.replyTo && Object.hasOwn(store.comments, b.replyTo) ? store.comments[b.replyTo] : null;
      if (b.replyTo && (!replyTarget || replyTarget.board !== board || roleOn(who, replyTarget.board) < 1))
        return send(res, 400, { error: 'reply target must exist on the same board and be readable' }, cors);
      const referenceError = ctx.attachmentError(b.attachments, who);
      if (referenceError) return send(res, 403, { error: referenceError }, cors);
      const id = newId(),
        t = now();
      // A human identity (a page token or a Tailscale login) posts asks, which start unhandled; an agent identity
      // (an api token with operator rights) posts replies, which are handled by definition.
      const agent = !notice && who.via === 'api' && roleOn(who, board) >= 3;
      // kind: task-request is a ready-made request to open a task (the page's New task form)
      const c = {
        id,
        board,
        cardId: card ? card.id : null,
        cardTitle: card ? card.title : null,
        t,
        text: String(b.text || '').slice(0, 4000),
        by: who.name,
        via: who.via || 'api',
        author: notice ? 'coordinator' : agent ? 'operator' : isOwnerName(ctx.cfg, who.name) ? 'owner' : 'person',
        handled: agent,
        replyTo: b.replyTo || null,
        attachments: atts,
        kind: notice ? 'notice' : b.kind === 'task-request' ? 'task-request' : b.kind === 'direct' ? 'direct' : null,
      };
      if (!agent && !notice)
        addTranscript(store.boards[board], {
          t,
          role: 'owner',
          by: who.name,
          text: c.text,
          via: c.kind === 'direct' ? 'direct' : card ? 'card ' + slugOf(board, card.id) : 'general',
        });
      if (agent && b.replyTo && store.comments[b.replyTo]) {
        const orig = store.comments[b.replyTo];
        orig.handled = true;
        orig.handledAt = t;
        orig.handledBy = who.name;
      }
      store.comments[id] = c;
      if (agent && card) noteOperatorMessage(card, t);
      change('comment', id, who.name, board);
      // /yolo and /yolo off, typed by Owner on his page, switch the mode (toolcalls.js yoloSwitch); nobody else's words
      // do; "/yolo on <scope>" narrows it
      {
        const ym = /^\s*\/yolo\b([\s\S]*)$/i.exec(c.text);
        if (ym && !agent && !notice && isOwnerName(cfg, who.name) && who.via === 'page' && roleOn(who, board) >= 4)
          ctx.TC.yoloSwitch(board, who, c, ym[1]);
      }
      return send(res, 201, remember(who, b, 'comment', id, c), cors);
    }
    // Global: Owner's way to send one ask to all his operators at once, apart from each board's General. One
    // message from Owner, from his page, goes to every board he writes on: on each it is his words on General marked
    // Global, in that operator's inbox, and each operator answers its own copy. /yolo in it switches every board,
    // each with its own record (so one can be ended alone).
    if (req.method === 'POST' && p === '/api/global') {
      const b = payload;
      if (!who || !isOwnerName(ctx.cfg, who.name) || who.via !== 'page')
        return send(res, 403, { error: "Global is Owner's, sent from his page" }, cors);
      const referenceError = b && ctx.attachmentError(b.attachments, who);
      if (referenceError) return send(res, 403, { error: referenceError }, cors);
      const atts =
        b && Array.isArray(b.attachments)
          ? b.attachments
              .map(id => store.attachments[String(id)])
              .filter(Boolean)
              .map(a => ({ id: a.id, name: a.name, type: a.type, size: a.size }))
          : [];
      const text = String((b && b.text) || '')
        .trim()
        .slice(0, 4000);
      if (!text && !atts.length) return send(res, 400, { error: 'text or an attachment required' }, cors);
      {
        const again = sentBefore(who, b);
        if (again) return send(res, again.status, again.body, cors);
      }
      const boards = Object.keys(store.boards).filter(bd => roleOn(who, bd) >= 2);
      if (!boards.length) return send(res, 403, { error: 'no board to write on' }, cors);
      const gid = newId(),
        t = now(),
        copies = [],
        ym = /^\s*\/yolo\b([\s\S]*)$/i.exec(text);
      for (const board of boards) {
        const id = newId(),
          c = {
            id,
            board,
            cardId: null,
            cardTitle: null,
            t,
            text,
            by: who.name,
            via: who.via,
            author: 'owner',
            handled: false,
            replyTo: null,
            attachments: atts,
            kind: null,
            global: gid,
            globalBoards: boards,
          };
        store.comments[id] = c;
        copies.push(c);
        addTranscript(store.boards[board], { t, role: 'owner', by: who.name, text, via: 'global' });
        change('comment', id, who.name, board);
        if (ym && roleOn(who, board) >= 4) ctx.TC.yoloSwitch(board, who, c, ym[1]);
      }
      return send(res, 201, remember(who, b, 'global', gid, { global: gid, copies }), cors);
    }
    // Global's messages, newest last, each with how every operator's copy stands: answered (and the answer), holding,
    // noted, answered by the board (/yolo), or waiting
    if (req.method === 'GET' && p === '/api/global') {
      if (!who || !isOwnerName(ctx.cfg, who.name)) return send(res, 403, { error: "Global is Owner's" }, cors);
      const groups = new Map();
      for (const c of Object.values(store.comments)) {
        if (!c.global || roleOn(who, c.board) < 1) continue;
        ctx.TC.ensureSid(c);
        const g = groups.get(c.global) || {
          id: c.global,
          t: c.t,
          text: c.text,
          attachments: c.attachments || [],
          copies: [],
        };
        groups.set(c.global, g);
        const ans = c.answeredBy && store.comments[c.answeredBy];
        g.copies.push({
          board: c.board,
          id: c.id,
          sid: c.sid,
          handled: !!c.handled,
          handledAt: c.handledAt || null,
          handledBy: c.handledBy || null,
          holdAt: c.holdAt || null,
          noted: !!c.noted,
          yolo: c.yolo || null,
          reply: ans ? { text: ans.text, t: ans.t, by: ans.by } : null,
        });
      }
      const last = Math.max(1, Math.min(50, Math.floor(Number(q.last) || 20)));
      return send(
        res,
        200,
        { globals: [...groups.values()].sort((x, y) => String(x.t).localeCompare(String(y.t))).slice(-last) },
        cors,
      );
    }
    // Images for a conversation: upload the raw file (png, jpeg, gif, webp, svg; 10 MB), then name its id in a
    // comment's attachments. Reads follow authorized references or the uploader's pending files; stored beside the
    // store, never in git.
    if (req.method === 'POST' && p === '/api/attachments') {
      if (!who || !Object.keys(cfg.boards || {}).some(bd => roleOn(who, bd) >= 2))
        return send(res, 403, { error: 'no comment rights' }, cors);
      const type = String(req.headers['content-type'] || '')
          .split(';')[0]
          .trim(),
        ext = IMAGE_EXT[type];
      if (!ext) return send(res, 415, { error: 'png, jpeg, gif, webp, svg, csv, txt or pdf only' }, cors);
      let buf;
      try {
        if (rawError) throw rawError;
        buf = raw;
      } catch (e) {
        return send(res, 413, { error: e.message }, cors);
      }
      if (!buf.length) return send(res, 400, { error: 'empty body' }, cors);
      // an SVG is cleaned as the steward's diagrams are
      if (type === 'image/svg+xml') {
        const c = ctx.ST.cleanSvg(buf);
        if (c.error) return send(res, 415, { error: c.error }, cors);
        buf = Buffer.from(c.svg, 'utf8');
      }
      const id = newId();
      fs.mkdirSync(ATTACH, { recursive: true });
      fs.writeFileSync(path.join(ATTACH, id + '.' + ext), buf);
      let name = '';
      try {
        name = decodeURIComponent(String(req.headers['x-name'] || ''));
      } catch {
        name = '';
      }
      const a = { id, name: (name || 'image.' + ext).slice(0, 120), type, size: buf.length, by: who.name, t: now() };
      store.attachments[id] = a;
      save();
      return send(res, 201, a, cors);
    }
    const matt = /^\/api\/attachments\/([a-f0-9]{16})$/.exec(p);
    if (req.method === 'GET' && matt) {
      if (!who || !Object.keys(cfg.boards || {}).some(bd => roleOn(who, bd) >= 1))
        return send(res, 403, { error: 'no access' }, cors);
      const a = store.attachments[matt[1]];
      if (!a) return send(res, 404, { error: 'no such attachment' }, cors);
      if (a.steward && !(who.via === 'page' && roleOn(who, a.board) >= 4))
        return send(res, 403, { error: "the steward's diagrams are Owner's" }, cors);
      if (!ctx.canReadAttachment(who, a)) return send(res, 403, { error: 'no attachment access' }, cors);
      // an SVG (a steward's diagram, or anyone's), opened alone, runs nothing and loads nothing but its own styles and
      // pictures
      const svg = a.type === 'image/svg+xml',
        f = path.join(ATTACH, a.id + '.' + IMAGE_EXT[a.type]);
      if (!fs.existsSync(f)) return send(res, 404, { error: 'file missing' }, cors);
      res.writeHead(
        200,
        Object.assign(
          {
            'Content-Type': a.type,
            'Content-Length': fs.statSync(f).size,
            'Cache-Control': 'private, no-store',
            'X-Content-Type-Options': 'nosniff',
          },
          a.type === 'application/pdf'
            ? {}
            : {
                'Content-Security-Policy': svg
                  ? "sandbox; default-src 'none'; img-src data:; style-src 'unsafe-inline'"
                  : "sandbox; default-src 'none'; img-src 'self'; style-src 'unsafe-inline'",
              },
          cors,
        ),
      );
      return fs.createReadStream(f).pipe(res);
    }
    // Owner decides a suggested prompt: Send makes the board tell the operator, in his name and at his click, to send
    // the prompt on his behalf verbatim; No, something else only takes the choice away, and he answers as he likes.
    // Either way the card's open decision is resolved: he has taken it. A person decides, never an api identity.
    const md = /^\/api\/comments\/([A-Za-z0-9._-]+)\/decide$/.exec(p);
    if (md && req.method === 'POST') {
      const c = store.comments[md[1]];
      if (!c || !c.prompt) return send(res, 404, { error: 'no such prompt' }, cors);
      if (roleOn(who, c.board) < 2) return send(res, 403, { error: 'no comment rights on this board' }, cors);
      if (who.via === 'api') return send(res, 403, { error: 'a person decides a prompt' }, cors);
      const b = payload || {};
      const choice = b.choice === 'send' ? 'send' : b.choice === 'other' ? 'other' : null;
      if (!choice) return send(res, 400, { error: 'choice must be send or other' }, cors);
      // Send with edit: the same instruction, his version of the prompt
      const edited = choice === 'send' && b.text != null ? String(b.text).trim().slice(0, 8000) : '';
      const t = now();
      const result =
        choice === 'send'
          ? prompts.approve(store, c, { via: 'send', at: t, by: who.name }, edited)
          : prompts.decline(store, c, t, who.name);
      if (!result.ok) return send(res, 409, { error: result.reason }, cors);
      const card = c.cardId ? store.cards[c.cardId] : null;
      let sent = null;
      if (choice === 'send') {
        const id = newId(),
          text =
            'Send this to ' +
            (c.prompt.to ? 'the ' + c.prompt.to : 'its target') +
            ' on my behalf, verbatim:\n\n' +
            (edited || c.prompt.text);
        sent = store.comments[id] = {
          id,
          board: c.board,
          cardId: c.cardId || null,
          cardTitle: c.cardTitle || null,
          t,
          text,
          by: who.name,
          via: who.via || 'page',
          handled: false,
          replyTo: c.id,
          attachments: [],
          kind: 'prompt-send',
          promptOf: c.id,
        };
        addTranscript(store.boards[c.board], {
          t,
          role: 'owner',
          by: who.name,
          text,
          via: c.cardId ? 'card ' + slugOf(c.board, c.cardId) : 'general',
        });
        change('comment', id, who.name, c.board);
      }
      change('comment', c.id, who.name, c.board);
      if (card) change('card', card.id, who.name, c.board);
      return send(res, 200, { comment: c, sent }, cors);
    }
    return NEXT;
  }

  return { messageRoutes };
};
