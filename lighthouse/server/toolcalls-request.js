'use strict';
const { ownerId, isOwnerName } = require('./configuration');
// The tool-call engine's request handling (see toolcalls.js): one request carries one call, or a board_batch of
// calls, which runs on a rehearsal first; a queued call refused on arrival is kept as undelivered, never dropped.
const crypto = require('crypto');
const shifts = require('./shift');

module.exports = function makeRequests(tc) {
  const { ctx, cfg, now, S, rehearse, tms, authorOf, ensureSid, q, et, cardId, message, receipt, T } = tc;

  // a quote the operator wrote escaped, \" as inside a hand-written JSON string, is a plain quote on the board. Code,
  // in backticks or a fence, keeps what it says.
  const CODE = /```[\s\S]*?```|`[^`\n]*`/g;
  const plainQuotes = s => {
    let out = '',
      last = 0,
      m;
    CODE.lastIndex = 0;
    while ((m = CODE.exec(s))) {
      out += s.slice(last, m.index).replace(/\\(["“”])/g, '$1') + m[0];
      last = m.index + m[0].length;
    }
    return out + s.slice(last).replace(/\\(["“”])/g, '$1');
  };
  const plainArgs = v =>
    typeof v === 'string'
      ? v.includes('\\')
        ? plainQuotes(v)
        : v
      : Array.isArray(v)
        ? v.map(plainArgs)
        : v && typeof v === 'object'
          ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, plainArgs(x)]))
          : v;

  const WRITE_EXEMPT = new Set(['board_status', 'board_authorities']);
  const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  function runOne(board, who, call, batch) {
    const tool = String(call.tool || ''),
      a = Object.assign({}, call.args && typeof call.args === 'object' ? call.args : {});
    const fn = has(T, tool) ? T[tool] : null;
    if (!fn) return { ok: false, reason: `There is no tool ${q(tool, 30)}.` };
    if (batch && (tool === 'board_relay' || tool === '_relay_result' || tool === 'board_batch'))
      return { ok: false, reason: 'Relays and batches cannot be inside a batch.' };
    if (batch && a.dry_run) return { ok: false, reason: 'dry_run goes on the batch itself, not on a call inside it.' };
    // a queued call reaching a board Owner has written on since asks for confirmation (section 8), by the board's clock
    if (call.queued && !a.confirm && call.at) {
      const age = Date.now() - call.at;
      if ((tool === 'board_ask' || tool === 'board_prompt') && age > 3600000)
        return {
          ok: false,
          reason:
            `This ask was queued ${Math.round(age / 60000)} minutes ago. ` +
            `Confirm it is still needed (confirm: true) or drop it.`,
        };
      const cid = a.card ? cardId(board, a.card) : null;
      const since = Object.values(S().comments)
        .filter(
          m =>
            m.board === board &&
            authorOf(m) === 'owner' &&
            m.kind !== 'prompt-send' &&
            tms(m.t) > call.at &&
            (!cid || (m.cardId || null) === cid),
        )
        .sort((x, y) => tms(x.t) - tms(y.t))[0];
      if (
        since &&
        ['board_close', 'board_post', 'board_reply', 'board_ask', 'board_prompt', 'board_withdraw'].includes(tool)
      )
        return {
          ok: false,
          reason:
            `Owner wrote ${since.cardId ? 'on this card' : 'on General'} at ${et(since.t)}, ` +
            `after this call was queued (${et(new Date(call.at).toISOString())}). ` +
            `Read it (${ensureSid(since).sid}), then confirm: true or drop the call.`,
        };
    }
    return fn(board, who, a, call);
  }
  function runCall(board, who, call, inner) {
    if (!inner) return runOne(board, who, call, false);
    if (!inner.length || inner.length > 20) return { ok: false, reason: 'A batch holds 1 to 20 calls.' };
    const results = [],
      outer = tc.BATCH_ASKS;
    tc.BATCH_ASKS = new Set();
    try {
      for (const [i, c] of inner.entries()) {
        const r = runOne(
          board,
          who,
          { id: call.id + ':' + i, tool: c && c.tool, args: c && c.args, queued: call.queued, at: call.at },
          true,
        );
        results.push(r);
        if (!r.ok) return { ok: false, reason: `call ${i + 1} (${q(c && c.tool, 30)}) was refused: ${r.reason}` };
      }
    } finally {
      tc.BATCH_ASKS = outer;
    }
    return { ok: true, summary: results.map(r => r.summary).join(' ') };
  }
  function resolveChat(board, args, field, answered, standIn) {
    // "chat" names the newest thing Owner typed in the operator's chat; never a wait inside a call
    let m = Object.values(S().comments)
      .filter(x => x.board === board && x.channel === 'operator-chat' && (answered || !x.handled))
      .sort((x, y) => tms(y.t) - tms(x.t))[0];
    // a shadow trial's board stays in line mode, where the collector does not report the chat, so the rehearsal answers
    // a stand-in for his words; otherwise every reply to "chat" in a shadow trial would be refused
    if (!m && standIn && tc.REHEARSAL) {
      const id = 'shadow-chat-' + crypto.randomUUID();
      m = S().comments[id] = {
        id,
        board,
        cardId: null,
        cardTitle: null,
        t: now(),
        text: "(a stand-in for what Owner typed in your chat: a shadow trial's board does not see your chat)",
        by: ownerId(ctx.cfg),
        via: 'chat',
        author: 'owner',
        channel: 'operator-chat',
        origin: 'human',
        handled: false,
        replyTo: null,
        attachments: [],
      };
    }
    if (!m)
      return {
        ok: false,
        retry: 5,
        reason:
          'Nothing Owner typed in your chat has reached the board yet (your collector reports it within seconds). ' +
          'Try again shortly, or name the message by id from the receipt.',
      };
    args[field] = ensureSid(m).sid;
    return null;
  }
  function prune() {
    const st = ctx.store(),
      cut = Date.now() - 30 * 86400000;
    for (const [k, v] of Object.entries(st.calls || {})) if (tms(v.t) < cut) delete st.calls[k];
    for (const [k, v] of Object.entries(st.tickets || {}))
      if (tms(v.t) < cut && !v.ledgerIntentId && (!v.evidenceHash || v.used)) delete st.tickets[k];
    const keys = Object.keys(st.calls || {});
    if (keys.length > 20000) for (const k of keys.slice(0, keys.length - 20000)) delete st.calls[k];
  }
  function undelivered(board, who, call, reason) {
    // a queued call refused on drain: never dropped (section 8)
    const st = ctx.store(),
      b = st.boards[board],
      a = call.args || {},
      text = JSON.stringify(a).slice(0, 1500);
    b.undelivered = (b.undelivered || [])
      .concat([{ t: now(), client_at: call.client_at, tool: call.tool, reason, args: text }])
      .slice(-20);
    const cid = a.card ? cardId(board, a.card) : null,
      card = cid && st.cards[cid] && st.cards[cid].board === board ? st.cards[cid] : null;
    message({
      board,
      cardId: card ? card.id : null,
      cardTitle: card ? card.title : null,
      text:
        `A ${String(call.tool).replace(/[^a-z_]/g, '')} queued at ${et(call.client_at)} ` +
        `was refused when it reached the board: ${reason}\n\n` +
        `What it carried: ${String(a.text || a.question || a.outcome || a.prompt || text).slice(0, 4000)}`,
      by: who.name,
      label: 'UNDELIVERED',
      author: 'system',
    });
  }
  const answer = (board, who, res, detail, dry) => {
    let r;
    try {
      r = (dry ? 'DRY RUN: nothing posted.\n' : '') + receipt(board, who, detail === 'full' ? 'full' : 'brief');
    } catch (e) {
      r = 'The receipt could not be built: ' + e.message;
    }
    return { status: 200, body: { results: [res], ticket: res.ticket, handoff: res.handoff, receipt: r } };
  };

  function handleCalls(board, who, body) {
    if (ctx.ownership?.enabled(board)) {
      const authorize = () => ctx.authorizeCall(board, who, body);
      if (!ctx.inTransaction()) return ctx.transact(authorize, () => applyCalls(board, who, body));
      authorize();
    }
    return applyCalls(board, who, body);
  }
  function applyCalls(board, who, body) {
    // async for the route; nothing inside awaits
    if (!who) return { status: 401, body: { error: 'no access' } };
    if (!ctx.store().boards[board]) return { status: 404, body: { error: 'no such board' } };
    // any role will do here: a notice is sent from the watch's own board
    if (ctx.roleOn(who, board) < 1) return { status: 403, body: { error: 'no access to this board' } };
    const archived = (cfg.boards || {})[board]?.lifecycle === 'archived';
    // shadow runs beside the line protocol, never instead of it: on a board in tool mode nothing else would answer
    // Owner, so his messages would go unanswered and his Sends refused
    if (who.shadow && ((cfg.boards || {})[board] || {}).protocol === 'tools')
      return {
        status: 409,
        body: {
          error:
            'this board is in tool mode, and a shadow session only dry-runs, so nothing would answer Owner: ' +
            'shadow runs only while the board stays in line mode. ' +
            "Remove LH-SHADOW-TOKEN.txt from the operator home and use the board's tool-mode token.",
        },
      };
    const calls = Array.isArray(body.calls) ? body.calls : [];
    if (calls.length !== 1)
      return { status: 400, body: { error: 'send one call; several go together in one board_batch call' } };
    const raw = calls[0] && typeof calls[0] === 'object' ? calls[0] : {};
    if (
      ctx.ownership?.enabled(board) &&
      raw.queued &&
      (raw.originSessionId !== who.sessionId || raw.originEpoch !== who.epoch) &&
      !ctx.dispatchLedger?.canApply(board, who, raw) &&
      !ctx.dispatchLedger?.previousCall(board, raw)
    )
      return { status: 409, body: { error: 'queued call belongs to another session or epoch; adoption required' } };
    const call = {
      id: String(raw.id || crypto.randomUUID()).slice(0, 100),
      tool: String(raw.tool || ''),
      args: raw.args && typeof raw.args === 'object' && !Array.isArray(raw.args) ? plainArgs(raw.args) : {},
      queued: !!raw.queued,
      client_at: raw.client_at ? String(raw.client_at).slice(0, 40) : null,
    };
    const real = ctx.store();
    const ledgerEnabled = ctx.dispatchLedger?.enabled(board);
    const ledgerTracked = ledgerEnabled || ctx.dispatchLedger?.tracksCall(board, raw);
    const bodyHash = ledgerTracked ? ctx.dispatchLedger.callHash(raw) : null;
    const committed = ctx.dispatchLedger?.previousCall(board, raw);
    if (committed) return answer(board, who, { ...committed, duplicate: true }, 'brief', false);
    ctx.dispatchLedger?.requireReview(board, who, raw);
    if (archived) {
      const ticket = real.tickets?.[String(call.args.ticket || '')];
      if (
        call.tool !== '_relay_result' ||
        call.queued ||
        call.args.dry_run ||
        who.shadow ||
        !ticket ||
        ticket.board !== board ||
        ticket.by !== who.name
      )
        return { status: 403, body: { error: 'archived boards are read-only' } };
    }
    if (call.queued) {
      // when it was queued, on the board's clock: the tool server sends its own clock at sending (sent_at), so a skew
      // between machines cancels out
      const c = Date.parse(call.client_at || ''),
        s = Date.parse(raw.sent_at || '');
      call.at = isNaN(c) ? Date.now() : Math.min(Date.now(), c + (isNaN(s) ? 0 : Date.now() - s));
    }
    real.calls = real.calls || {};
    // ids are the caller's, so they are kept per board and caller
    const key = board + '|' + who.name + '|' + call.id,
      prev = real.calls[key];
    if (prev && ledgerTracked && prev.bodyHash && prev.bodyHash !== bodyHash && call.tool !== '_relay_result')
      return { status: 409, body: { error: 'call id reused with different body hash' } };
    const changedEvidence = ledgerEnabled && call.tool === '_relay_result' && prev?.bodyHash !== bodyHash;
    if (prev && !changedEvidence) {
      if (ledgerTracked && !prev.dry) ctx.dispatchLedger.rememberCall(board, who, raw, prev);
      let relayReceipt = prev.relay_receipt;
      if (prev.ok && prev.tool === '_relay_result' && call.tool === '_relay_result' && !relayReceipt) {
        const ticket = real.tickets?.[String(call.args.ticket || '')];
        if (
          ticket?.used &&
          ticket.board === board &&
          ticket.by === who.name &&
          call.id === 'relay-result-' + ticket.id &&
          ticket.delivered === call.args.delivered
        )
          relayReceipt = { id: call.id, ticket: ticket.id, delivered: ticket.delivered };
      }
      if (!prev.ok && call.queued && !prev.undelivered && !prev.dry) {
        prev.undelivered = true;
        tc.FX = [];
        try {
          undelivered(board, who, call, prev.summary);
        } finally {
          const f2 = tc.FX;
          tc.FX = null;
          for (const f of f2) {
            try {
              f();
            } catch (e) {}
          }
        }
        ctx.saveNow();
      }
      return answer(
        board,
        who,
        {
          ok: prev.ok,
          duplicate: true,
          relay_receipt: relayReceipt,
          summary: (prev.ok ? 'Already done: ' : 'Already refused: ') + prev.summary,
        },
        'brief',
        false,
      );
    }
    const inner =
      call.tool === 'board_batch'
        ? Array.isArray(call.args.calls)
          ? call.args.calls.map(c =>
              Object.assign({}, c, {
                args: c && c.args && typeof c.args === 'object' ? Object.assign({}, c.args) : {},
              }),
            )
          : []
        : null;
    const dry = !!call.args.dry_run || (who.shadow && !WRITE_EXEMPT.has(call.tool)),
      standIn = dry && !!who.shadow;
    const chat = () => {
      for (const c of inner || [call])
        for (const [tool, field, answered] of [
          ['board_reply', 'to', false],
          ['board_relay', 'source', true],
          ['board_relay', 'on_word', true],
        ])
          if (c.tool === tool && c.args[field] === 'chat') {
            const r = resolveChat(board, c.args, field, answered, standIn);
            if (r) return r;
          }
      return null;
    };
    // "chat" is resolved here, or in shadow inside the rehearsal below
    if (!standIn) {
      const r = chat();
      if (r) return answer(board, who, r, 'brief', false);
    }
    let res,
      effects = [];
    try {
      if (dry || inner) {
        // the real store is untouched; the rehearsal's effects are dropped
        res = rehearse(() => (standIn && chat()) || runCall(board, who, call, inner));
        if (!res.ok && inner)
          res = Object.assign({}, res, { reason: 'Nothing in the batch was applied: ' + res.reason });
        if (res.ok && !dry) {
          tc.FX = [];
          try {
            res = runCall(board, who, call, inner);
          } finally {
            effects = tc.FX;
            tc.FX = null;
          }
          if (!res.ok) {
            console.log(
              `toolcalls: a batch by ${who.name} rehearsed cleanly and was refused when applied: ${res.reason}`,
            );
            res = Object.assign({}, res, {
              reason:
                'The batch rehearsed cleanly, then was refused while being applied, ' +
                'so part of it may be on the board (read the receipt): ' +
                res.reason,
            });
          }
        }
      } else {
        tc.FX = [];
        try {
          res = runOne(board, who, call, false);
        } finally {
          effects = tc.FX;
          tc.FX = null;
        }
      }
    } catch (e) {
      tc.FX = null;
      console.log(`toolcalls: ${call.tool} by ${who.name} failed: ${e.stack || e.message}`);
      res = { ok: false, reason: 'The board could not apply the call: ' + e.message };
    }
    if (!dry)
      for (const f of effects) {
        try {
          f();
        } catch (e) {}
      }
    if (!res.ok && call.queued && !dry) {
      tc.FX = [];
      try {
        undelivered(board, who, call, res.reason);
      } finally {
        const f2 = tc.FX;
        tc.FX = null;
        for (const f of f2) {
          try {
            f();
          } catch (e) {}
        }
      }
    }
    if (!dry && !res.retry)
      real.calls[key] = {
        t: now(),
        board,
        by: who.name,
        tool: call.tool,
        ok: !!res.ok,
        relay_receipt: res.relay_receipt,
        ...(ledgerTracked ? { bodyHash } : {}),
        summary: String(res.summary || res.reason || '').slice(0, 1000),
        undelivered: !res.ok && call.queued ? true : undefined,
      };
    if (ledgerTracked && !dry)
      ctx.dispatchLedger.rememberCall(board, who, { ...raw, id: call.id, tool: call.tool, args: raw.args || {} }, res);
    // every call is a sign of life: a STATUS here goes to its card's log, never a message, so without this the silence
    // clock would read only the shift's start. A queued call counts from when it was queued
    const evidenceOnly = ctx.ownership?.enabled(board) && ['_relay_result', 'board_notice'].includes(call.tool);
    if (
      !dry &&
      !archived &&
      !evidenceOnly &&
      !(call.tool === 'board_shift' && ['start', 'end'].includes(call.args.action))
    ) {
      const at = call.queued ? new Date(call.at).toISOString() : now();
      shifts.touch(real.boards[board], at);
    }
    // the shadow trial's record: each rehearsed call, so the trial can be measured against the lines (acts made through
    // the tools unprompted, refusals that were right). Kept two weeks, at most 5,000
    if (dry && who.shadow) {
      const log = (real.shadowCalls = real.shadowCalls || []);
      log.push({
        t: now(),
        board,
        by: who.name,
        tool: call.tool,
        ok: !!res.ok,
        said: String(res.summary || res.reason || '').slice(0, 300),
      });
      const cut = Date.now() - 14 * 86400000;
      while (log.length && (log.length > 5000 || tms(log[0].t) < cut)) log.shift();
    }
    if (dry && res.ok)
      res = Object.assign({}, res, {
        summary: 'DRY RUN, nothing posted. Would have: ' + res.summary,
        ticket: undefined,
        relay_receipt: undefined,
      });
    prune();
    ctx.saveNow();
    const detail = res.detail || (call.tool === 'board_status' ? call.args.detail : 'brief');
    return answer(board, who, res, detail, dry);
  }

  return { handleCalls };
};
