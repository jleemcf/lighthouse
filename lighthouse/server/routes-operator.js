'use strict';
const { ownerId, isOwnerName } = require('./configuration');
const shifts = require('./shift');
const cleanUsage = require('./usage');
// The routes an operator's collector and tools post to: chat words, tool calls, lines, the shift, the activity
// line, the instruments and the transcript.

module.exports = function makeOperatorRoutes(ctx) {
  const { cfg, store, NEXT, roleOn, send, readBody, now, newId, change, save, rowKey, ROW_SEEN, ROWKEYS_KEEP } = ctx;
  const { attsOf, pushActivity, addTranscript, HARNESS_TEXT, HARNESS_LEAD, batch, applyEvent } = ctx;
  const { flushNotes, flushCopies } = ctx;
  function operatorRoutes(req, res, { q, p, who, cors, payload }) {
    const mch = /^\/api\/boards\/([A-Za-z0-9_-]+)\/chat$/.exec(p);
    if (mch && req.method === 'POST') {
      // what Owner typed in the operator's own chat, reported by its collector (TOOLCALL-DESIGN §4): a message with an
      // id, marked as typed in chat
      const board = mch[1];
      if (!store.boards[board]) return send(res, 404, { error: 'no such board' }, cors);
      if (roleOn(who, board) < 3 || who.mode !== 'collector')
        return send(res, 403, { error: 'only the collector token reports chat words' }, cors);
      const b = payload;
      if (!b) return send(res, 400, { error: 'bad json' }, cors);
      store.chatSeen = store.chatSeen || [];
      const seenSet = new Set(store.chatSeen);
      let added = 0;
      for (const r of (Array.isArray(b.rows) ? b.rows : []).slice(0, 50)) {
        if (!r.uuid || seenSet.has(r.uuid) || !String(r.text || '').trim()) continue;
        // Claude Code's own text (a note on an image read, say) is never his words, and never something owed to him
        if (HARNESS_LEAD.test(String(r.text))) {
          store.chatSeen.push(String(r.uuid).slice(0, 80));
          seenSet.add(r.uuid);
          continue;
        }
        const id = newId(),
          t = r.t || now();
        // origin: Claude Code's own mark on the entry; only 'human' can authorise a relay (toolcalls.js hisWords)
        store.comments[id] = {
          id,
          board,
          cardId: null,
          cardTitle: null,
          t: isNaN(Date.parse(t)) ? now() : String(t).slice(0, 40),
          text: String(r.text).slice(0, 4000),
          by: ownerId(ctx.cfg),
          via: 'chat',
          author: 'owner',
          channel: 'operator-chat',
          origin: r.origin === 'human' && !HARNESS_TEXT.test(String(r.text)) ? 'human' : 'unmarked',
          handled: false,
          replyTo: null,
          attachments: [],
        };
        ctx.TC.ensureSid(store.comments[id]);
        store.chatSeen.push(String(r.uuid).slice(0, 80));
        seenSet.add(r.uuid);
        added++;
        change('comment', id, who.name, board);
      }
      store.chatSeen = store.chatSeen.slice(-5000);
      save();
      return send(res, 200, { added }, cors);
    }
    const mtc = /^\/api\/boards\/([A-Za-z0-9_-]+)\/(calls|status|authorities)$/.exec(p);
    if (mtc) {
      // the tool-call protocol (TOOLCALL-DESIGN.md)
      const board = mtc[1];
      if (mtc[2] === 'status' && req.method === 'GET') {
        if (!store.boards[board]) return send(res, 404, { error: 'no such board' }, cors);
        if (roleOn(who, board) < 1) return send(res, 403, { error: 'no access' }, cors);
        return send(res, 200, { receipt: ctx.TC.receipt(board, who, q.detail === 'full' ? 'full' : 'brief') }, cors);
      }
      if (req.method !== 'POST') return send(res, 405, { error: 'method' }, cors);
      const b = payload;
      if (!b) return send(res, 400, { error: 'bad json' }, cors);
      const r =
        mtc[2] === 'calls'
          ? ctx.TC.handleCalls(board, who, b)
          : mtc[2] === 'authorities'
            ? ctx.TC.createAuthority(board, who, b)
            : { status: 404, body: { error: 'no such route' } };
      return send(res, r.status, r.body, cors);
    }
    const mb = /^\/api\/boards\/([A-Za-z0-9_-]+)\/(events|shift|heartbeat|activity|transcript|instruments)$/.exec(p);
    if (mb && req.method === 'POST') {
      const board = mb[1];
      if (!store.boards[board]) return send(res, 404, { error: 'no such board' }, cors);
      if (roleOn(who, board) < 3) return send(res, 403, { error: 'operator rights required' }, cors);
      const b = payload;
      if (!b) return send(res, 400, { error: 'bad json' }, cors);
      // a line already applied is never applied again: a replay changes nothing
      if (mb[2] === 'events' && ((cfg.boards || {})[board] || {}).protocol === 'tools') {
        // tool mode: lines are notes, never answers (TOOLCALL-DESIGN §9)
        const results = (b.rows || []).map(r => {
          const referenceError = ctx.attachmentError(r.attachments, who);
          if (referenceError) return { ok: false, reason: referenceError };
          const k = rowKey(board, r);
          if (k && ROW_SEEN.has(k)) return { ok: true, duplicate: true };
          const cid =
              r.task && r.task !== 'general'
                ? String(r.task).startsWith(board + '-')
                  ? r.task
                  : board + '-' + r.task
                : null,
            card = cid && store.cards[cid] ? store.cards[cid] : null,
            id = newId(),
            t = r.t || now();
          // "For you:" opens what the operator writes in its chat because Owner asked for it there (a file, an
          // artifact, a chart): kept as meant for him, not as drift. Anything else in the chat is still said in chat.
          // And what it says in a turn he started by typing in its chat answers him there, since he may talk to it
          // either there or on the board: the collector marks it, and it is not drift either. Narration in other
          // turns still is.
          const forOwner = /^\s*for you:/i.test(String(r.text || '')),
            chatReply = !forOwner && !!r.chatReply;
          store.comments[id] = Object.assign(
            {
              id,
              board,
              cardId: card ? card.id : null,
              cardTitle: card ? card.title : null,
              t,
              text: `${r.label && !forOwner && !chatReply ? r.label + ': ' : ''}${String(r.text || '')}${
                r.body ? '\n\n' + String(r.body).slice(0, 8000) : ''
              }`.slice(0, 12000),
              by: who.name,
              via: 'api',
              handled: true,
              replyTo: null,
              attachments: attsOf(r.attachments),
              label: 'CHAT',
              author: 'operator',
            },
            forOwner ? { forOwner: true } : chatReply ? { chatReply: true } : { saidInChat: true },
          );
          change('comment', id, who.name, board);
          if (k) {
            ROW_SEEN.add(k);
            store.rowKeys.push(k);
            if (store.rowKeys.length > ROWKEYS_KEEP) {
              for (const x of store.rowKeys.splice(0, store.rowKeys.length - ROWKEYS_KEEP)) ROW_SEEN.delete(x);
            }
          }
          return { ok: true, note: true };
        });
        save();
        return send(res, 200, { results }, cors);
      }
      if (mb[2] === 'events') {
        batch.notes = [];
        batch.copies = {};
        let results;
        try {
          results = (b.rows || []).map(r => {
            const referenceError = ctx.attachmentError(r.attachments, who);
            if (referenceError) return { ok: false, reason: referenceError };
            const k = rowKey(board, r);
            if (k && ROW_SEEN.has(k)) return { ok: true, duplicate: true };
            const res = applyEvent(board, r, who.name, who);
            if (k && res && res.ok) {
              ROW_SEEN.add(k);
              store.rowKeys.push(k);
              if (store.rowKeys.length > ROWKEYS_KEEP) {
                for (const x of store.rowKeys.splice(0, store.rowKeys.length - ROWKEYS_KEEP)) ROW_SEEN.delete(x);
              }
            }
            return res;
          });
        } finally {
          const buf = batch.notes,
            cb = batch.copies;
          batch.notes = null;
          batch.copies = null;
          try {
            flushNotes(buf);
            flushCopies(cb, who.name, now());
          } catch (e) {
            console.log('notes: ' + e.message);
          }
        }
        return send(res, 200, { results }, cors);
      }
      if (mb[2] === 'shift') {
        if (who.shadow) return send(res, 403, { error: 'shadow tokens cannot change the live shift' }, cors);
        const bd = store.boards[board];
        if (!shifts.validate(b)) return send(res, 400, { error: 'state must be on or off; invalid shift body' }, cors);
        shifts.transition(ctx, board, b.state === 'on' ? 'start' : 'end', who.name, b.since || now());
        return send(res, 200, bd.shift, cors);
      }
      if (mb[2] === 'heartbeat') {
        if (who.mode !== 'tools' || who.shadow || ((cfg.boards || {})[board] || {}).protocol !== 'tools')
          return send(res, 403, { error: 'only the live tool server reports a session heartbeat' }, cors);
        if (who.sessionId) {
          if (b.session !== who.sessionId) return send(res, 403, { error: 'session mismatch' }, cors);
          ctx.ownership.renew(who, board, who.epoch, b.processId);
        } else {
          if (typeof b.session !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(b.session))
            return send(res, 400, { error: 'session id required' }, cors);
          ctx.ownership.observeLegacy(board, b.session);
        }
        shifts.heartbeat(ctx, board, b.session);
        return send(res, 200, { ok: true }, cors);
      }
      if (mb[2] === 'activity') {
        pushActivity(store.boards[board], `${who.name}: ${b.text || ''}`);
        change('board', board, who.name, board);
        return send(res, 200, { ok: true }, cors);
      }
      if (mb[2] === 'instruments') {
        // the collector's telemetry: the gate's heartbeat, the operator's own compaction, the outbox itself (no change
        // is recorded: it is a pulse, not an event). The stored gate keeps lastFail, so the board can show why a gate
        // failed
        const bd = store.boards[board];
        const g = b.gate && typeof b.gate === 'object' ? b.gate : null;
        bd.instruments = {
          usage: b.usage === undefined ? bd.instruments?.usage || null : cleanUsage(b.usage),
          t: now(),
          by: who.name,
          gate: g
            ? {
                t: g.t,
                mode: g.mode,
                effective: g.effective,
                failOpenSince: g.failOpenSince || null,
                lastFail:
                  g.lastFail && typeof g.lastFail === 'object'
                    ? {
                        t: String(g.lastFail.t || '').slice(0, 30),
                        reason: String(g.lastFail.reason || '').slice(0, 160),
                      }
                    : null,
                judged: g.judged,
                held: g.held,
                woke: g.woke,
                dropped: g.dropped,
                failed: g.failed,
                pid: g.pid,
              }
            : null,
          compactedAt: b.compactedAt ? String(b.compactedAt).slice(0, 40) : null,
          outbox: b.outbox && typeof b.outbox === 'object' ? { pid: b.outbox.pid, since: b.outbox.since } : null,
        };
        return send(res, 200, { ok: true }, cors);
      }
      if (mb[2] === 'transcript') {
        // the collector's copy of the operator's own words and of what Owner typed in its chat
        const bd = store.boards[board];
        let n = 0;
        for (const r of b.rows || []) {
          const text = String((r && r.text) || '')
            .trim()
            .slice(0, 6000);
          if (!text || (r.role === 'owner' && HARNESS_LEAD.test(text))) continue;
          addTranscript(bd, {
            t: (r.t && String(r.t)) || now(),
            role: r.role === 'owner' ? 'owner' : 'operator',
            by: r.role === 'owner' ? ownerId(ctx.cfg) : who.name,
            text,
            via: r.role === 'owner' ? 'chat' : undefined,
          });
          n++;
        }
        if (n) change('transcript', board, who.name, board);
        return send(res, 200, { ok: true, added: n }, cors);
      }
    }
    return NEXT;
  }

  return { operatorRoutes };
};
