'use strict';
const cards = require('./card-transitions');
const prompts = require('./prompt-transitions');
// The routes for cards and a board's records: the transcript, the conduct report, notes, archive.

module.exports = function makeCardRoutes(ctx) {
  const { store, NEXT, roleOn, send, readBody, now, change, pushLog, transcriptOf, archiveDone, ARCHIVE_DIR } = ctx;
  const { conductOf } = ctx;
  function cardRoutes(req, res, { q, p, who, cors, payload }) {
    const mtx = /^\/api\/boards\/([A-Za-z0-9_-]+)\/transcript$/.exec(p);
    if (mtx && req.method === 'GET') {
      const board = mtx[1];
      if (!store.boards[board]) return send(res, 404, { error: 'no such board' }, cors);
      if (roleOn(who, board) < 1) return send(res, 403, { error: 'no access' }, cors);
      return send(res, 200, { entries: transcriptOf(board) }, cors);
    }
    const mc = /^\/api\/comments\/([A-Za-z0-9._-]+)$/.exec(p);
    if (req.method === 'PATCH' && mc) {
      const c = store.comments[mc[1]];
      if (!c) return send(res, 404, { error: 'no such comment' }, cors);
      if (roleOn(who, c.board) < 3) return send(res, 403, { error: 'operator rights required' }, cors);
      const b = payload || {};
      if (b.handled !== undefined) {
        c.handled = !!b.handled;
        c.handledAt = now();
        c.handledBy = who.name;
      }
      change('comment', c.id, who.name, c.board);
      return send(res, 200, c, cors);
    }
    // Owner settles an ask himself, when he has already dealt with it: a person's identity resolves one decision, or
    // every open one on the card, in his name.
    const mres = /^\/api\/cards\/([A-Za-z0-9._:@+~-]+)\/resolve$/.exec(p);
    if (mres && req.method === 'POST') {
      const card = store.cards[mres[1]];
      if (!card) return send(res, 404, { error: 'no such card' }, cors);
      if (roleOn(who, card.board) < 2) return send(res, 403, { error: 'no comment rights on this board' }, cors);
      if (who.via === 'api') return send(res, 403, { error: 'a person settles an ask' }, cors);
      const b = payload || {};
      const t = now();
      const legacy = card.needsAction && (!b.decision || b.decision === 'legacy');
      const selected = cards.openAsks(card).filter(decision => !b.decision || decision.id === b.decision);
      const n =
        prompts.settle(
          store,
          card,
          selected,
          { resolvedAt: t, resolvedBy: who.name, settledByOwner: true },
          { clearLegacy: !!legacy },
        ) + (legacy ? 1 : 0);
      if (!n) return send(res, 404, { error: 'nothing open to settle' }, cors);
      // his move is over
      pushLog(card, { t, kind: 'OWNER', who: who.name, text: 'handled it' + (n > 1 ? ' (' + n + ' asks)' : '') });
      card.updatedAt = t;
      card.updatedBy = who.name;
      change('card', card.id, who.name, card.board);
      return send(res, 200, { settled: n, card }, cors);
    }
    const mcard = /^\/api\/cards\/([A-Za-z0-9._:@+~-]+)$/.exec(p);
    if (mcard && (req.method === 'PUT' || req.method === 'PATCH')) {
      const b = payload;
      if (!b) return send(res, 400, { error: 'bad json' }, cors);
      const board = (store.cards[mcard[1]] || {}).board || b.board;
      if (!board || !store.boards[board]) return send(res, 400, { error: 'board unknown' }, cors);
      if (roleOn(who, board) < 3) return send(res, 403, { error: 'operator rights required' }, cors);
      const referenceError = ctx.attachmentError(b.attachments, who);
      if (referenceError) return send(res, 403, { error: referenceError }, cors);
      const t = now();
      const counts = store.boards[board].legacyCardWrites || { PUT: 0, PATCH: 0 };
      counts[req.method]++;
      store.boards[board].legacyCardWrites = counts;
      const result = cards.legacyWrite(
        store.cards[mcard[1]],
        { ...b, id: mcard[1], board, updatedAt: t, updatedBy: who.name },
        req.method === 'PUT',
      );
      if (!result.ok) {
        change('board', board, who.name, board);
        return send(res, 409, { error: result.reason }, cors);
      }
      store.cards[mcard[1]] = result.card;
      prompts.load(store);
      if (result.completion)
        pushLog(result.card, {
          ...result.completion,
          kind: 'FYI',
          who: who.name,
          text: 'Finished by explicit legacy card update.',
        });
      change('card', mcard[1], who.name, board);
      return send(res, 200, store.cards[mcard[1]], cors);
    }
    if (mcard && req.method === 'DELETE') {
      const c = store.cards[mcard[1]];
      if (!c) return send(res, 404, { error: 'no such card' }, cors);
      if (roleOn(who, c.board) < 3) return send(res, 403, { error: 'operator rights required' }, cors);
      delete store.cards[mcard[1]];
      prompts.load(store);
      change('card-deleted', mcard[1], who.name, c.board);
      return send(res, 200, { deleted: mcard[1] }, cors);
    }
    const ma = /^\/api\/boards\/([A-Za-z0-9_-]+)\/archive$/.exec(p);
    if (ma && req.method === 'POST') {
      const board = ma[1];
      if (!store.boards[board]) return send(res, 404, { error: 'no such board' }, cors);
      if (roleOn(who, board) < 3) return send(res, 403, { error: 'operator rights required' }, cors);
      const b = payload || {};
      const days = b.days == null ? 7 : Number(b.days);
      if (isNaN(days) || days < 0) return send(res, 400, { error: 'days must be a number' }, cors);
      const moved = archiveDone(board, days, ARCHIVE_DIR(), who.name);
      return send(res, 200, { archived: moved, out: ARCHIVE_DIR() }, cors);
    }
    // ---- the conduct report: every fault the brief forbids, counted from the store over a window, plus the
    // instruments' own telemetry and Jev's verdicts; read by the page and by conductwatch.cjs ----
    const mcd = /^\/api\/boards\/([A-Za-z0-9_-]+)\/conduct$/.exec(p);
    if (mcd && req.method === 'GET') {
      const board = mcd[1];
      if (!store.boards[board]) return send(res, 404, { error: 'no such board' }, cors);
      if (roleOn(who, board) < 1) return send(res, 403, { error: 'no access' }, cors);
      return send(res, 200, conductOf(board, Math.max(5, Math.min(24 * 60, Number(q.minutes) || 60))), cors);
    }
    const mn = /^\/api\/boards\/([A-Za-z0-9_-]+)\/notes$/.exec(p);
    if (mn && req.method === 'GET') {
      // the board's notes to its operator: by id (the board watch, on a change) or since a time
      const board = mn[1];
      if (!store.boards[board]) return send(res, 404, { error: 'no such board' }, cors);
      if (roleOn(who, board) < 1) return send(res, 403, { error: 'no access' }, cors);
      const all = store.boards[board].notes || [];
      const notes = q.id
        ? all.filter(n => n.id === q.id)
        : q.since
          ? all.filter(n => (n.t || '') > String(q.since))
          : all.slice(-50);
      return send(res, 200, { notes }, cors);
    }
    return NEXT;
  }

  return { cardRoutes };
};
