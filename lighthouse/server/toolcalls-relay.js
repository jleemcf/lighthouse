'use strict';
const lifecycle = require('./card-transitions');
const prompts = require('./prompt-transitions');
// The tool-call engine's prompts and relays (see toolcalls.js): board_prompt suggests a prompt for Owner's Send, and
// board_relay with _relay_result passes his words or a prompt he allowed to firstmate.
const crypto = require('crypto');

module.exports = function addRelayTools(tc) {
  const {
    ctx,
    now,
    newId,
    S,
    change,
    notify,
    tms,
    authorOf,
    assign,
    lookup,
    ensureSid,
    q,
    et,
    sl,
    openAsks,
    resolveCard,
    laneFollows,
    message,
    logLine,
    crmWorking,
    activeAuthority,
    isYolo,
    T,
    W,
  } = tc;

  T.board_prompt = (board, who, a) => {
    if (!W(who, board)) return { ok: false, reason: "Only this board's operator suggests prompts here." };
    const r = resolveCard(board, a.card);
    if (r.err) return { ok: false, reason: r.err };
    const card = r.card;
    if (card.status === 'done') return { ok: false, reason: `${sl(board, card.id)} is closed.` };
    const to = a.to === 'firstmate' ? a.to : null;
    if (!to) return { ok: false, reason: 'to is firstmate.' };
    const prompt = String(a.prompt || '').trim(),
      purpose = String(a.purpose || '').trim();
    if (!prompt || !purpose)
      return { ok: false, reason: 'A prompt needs its purpose (one line, for Owner) and the prompt itself.' };
    const open = openAsks(card);
    let replaced = null,
      joined = null;
    // a prompt can be the follow-through of the card's open ask: it sits under that ask, one question and one ping for
    // Owner, and his Send sends it and settles the ask
    if (a.for_ask && a.replaces) return { ok: false, reason: 'for_ask or replaces, not both.' };
    if (a.for_ask) {
      if (a.for_ask === true || a.for_ask === 'open') {
        if (open.length !== 1)
          return {
            ok: false,
            reason: open.length
              ? `${sl(board, card.id)} has ${open.length} open asks: name one, for_ask: "<ask id>".`
              : `${sl(board, card.id)} has no open ask: leave for_ask out.`,
          };
        joined = open[0];
      } else {
        const l = lookup(String(a.for_ask), 'ask', board);
        if (l.err) return { ok: false, reason: l.err };
        if (!open.includes(l.ref)) return { ok: false, reason: `${a.for_ask} is not an open ask on this card.` };
        joined = l.ref;
      }
      if (joined.kind === 'prompt')
        return {
          ok: false,
          reason:
            `${assign(joined, 'a', 'ask', card)} is itself a prompt: ` + `pass replaces to put a new one in its place.`,
        };
    }
    // an ask made earlier in the same batch, on this card, is the one it follows through: for_ask is understood
    if (
      !a.for_ask &&
      !a.replaces &&
      open.length === 1 &&
      open[0].kind !== 'prompt' &&
      tc.BATCH_ASKS &&
      tc.BATCH_ASKS.has(open[0].id)
    )
      joined = open[0];
    if (open.length && !a.replaces && !joined)
      return {
        ok: false,
        reason:
          `${sl(board, card.id)} already has an open ask (${open.map(d => assign(d, 'a', 'ask', card)).join(', ')}). ` +
          `Pass for_ask: "<ask id>" to put this prompt under it as its follow-through, ` +
          `or replaces: "<ask id>" to replace it.`,
      };
    if (a.replaces) {
      const l = lookup(String(a.replaces), 'ask', board);
      if (l.err) return { ok: false, reason: l.err };
      if (!open.includes(l.ref)) return { ok: false, reason: `${a.replaces} is not an open ask on this card.` };
      replaced = l.ref;
    }
    const t = now();
    if (replaced) {
      prompts.settle(S(), card, [replaced], { resolvedAt: t, resolvedBy: who.name, replacedBy: true });
    }
    const pm = message({
      board,
      cardId: card.id,
      cardTitle: card.title,
      text: purpose + '\n\n' + prompt,
      by: who.name,
      label: 'PROMPT',
      about: sl(board, card.id),
      prompt: prompts.offer(to, prompt),
    });
    assign(pm, 'p', 'prompt');
    if (joined) {
      // no second ask and no second ping: the ask already reached him; a newer prompt under it replaces the older one
      const old = joined.promptId && S().comments[joined.promptId];
      prompts.supersede(old, t, who.name);
      joined.promptId = pm.id;
      logLine(card, 'PROMPT', purpose, who.name);
      crmWorking(card);
      return {
        ok: true,
        summary:
          `Prompt ${pm.sid} for the ${to} is on ${sl(board, card.id)} under ask ${assign(joined, 'a', 'ask', card)}: ` +
          `his Send sends it and settles the ask; if he answers another way, the ask stays his.`,
      };
    }
    const d = {
      id: newId(),
      ask: 'Send the suggested prompt to the ' + to + ', or answer another way.',
      openedAt: t,
      resolvedAt: null,
      by: who.name,
      kind: 'prompt',
      commentId: pm.id,
    };
    card.decisions = (card.decisions || []).filter(x => !x.resolvedAt);
    lifecycle.ask(card, d);
    assign(d, 'a', 'ask', card);
    logLine(card, 'PROMPT', purpose, who.name);
    notify(board, {
      kind: 'ask',
      title: 'Needs you: ' + (S().boards[board].name || board),
      body: (card.title + ': ' + purpose).slice(0, 200),
      url: '/#card=' + card.id,
      tag: card.id,
    });
    crmWorking(card);
    return {
      ok: true,
      summary: `Prompt ${pm.sid} for the ${to} is on ${sl(board, card.id)}, waiting for Owner's Send (ask ${d.sid}).`,
    };
  };

  // relay, step one: authorise and issue a single-use ticket carrying the exact text. Step two (_relay_result) is the
  // tool server's report of delivery; it is not offered to the model, but a token holder can always reach it, so the
  // record says whose report it is (TOOLCALL-DESIGN §12: an operator's shell is inside its own token's trust).
  T.board_relay = (board, who, a, call) => {
    if (!W(who, board)) return { ok: false, reason: "Only this board's operator relays from here." };
    if (ctx.dispatchLedger?.enabled(board) && a.dispatchProtocol !== 'dispatch-ledger-v1')
      return { ok: false, reason: 'Reconnect every MCP process: board dispatch permission protocol required.' };
    // a shadow relay is only ever checked in a rehearsal, so no ticket is issued
    if (who.shadow && !tc.REHEARSAL) return { ok: false, reason: 'A shadow session takes no external action.' };
    let l = lookup(String(a.source || ''), ['message', 'prompt'], board);
    if (l.err) return { ok: false, reason: l.err };
    const st = S();
    let text = null,
      to = null,
      cid = null,
      promptMsg = null,
      srcMsg = null,
      auth = null,
      word = null,
      approval = null,
      seenIds = [];
    // his Send names the prompt it sends: relaying the Send relays that prompt, as the receipt owes it
    const viaSend =
      l.ref.kind === 'prompt-send' &&
      authorOf(l.ref) === 'owner' &&
      st.comments[l.ref.promptOf] &&
      st.comments[l.ref.promptOf].prompt
        ? l.ref
        : null;
    if (viaSend) l = { ref: st.comments[viaSend.promptOf] };
    // his later words in the same conversation may overtake those a relay rests on: each must be read and named (seen)
    const overtaken = src => {
      const seen = new Set((Array.isArray(a.seen) ? a.seen : []).map(String));
      const later = Object.values(st.comments).filter(
        m =>
          m.board === board &&
          (m.cardId || null) === (src.cardId || null) &&
          m !== src &&
          authorOf(m) === 'owner' &&
          m.kind !== 'prompt-send' &&
          !m.handled &&
          tms(m.t) >= tms(src.t),
      );
      const unread = later.filter(m => !seen.has(ensureSid(m).sid));
      seenIds = later.map(m => m.sid);
      return unread.length
        ? `Owner wrote after ${src.sid}: ${unread
            .slice(0, 3)
            .map(m => `${m.sid} at ${et(m.t)} ${q(m.text, 80)}`)
            .join('; ')}. ` +
            `Read ${unread.length > 1 ? 'them' : 'it'}; if nothing there changes the relay, ` +
            `pass seen: [${unread.map(m => '"' + m.sid + '"').join(', ')}].`
        : null;
    };
    // Owner's own words, on the board or typed in the operator's chat: his talking to the operator directly carries his
    // authority; the record says which way they came
    const hisWords = (m, what) => {
      if (authorOf(m) !== 'owner') return `${m.sid} is not Owner's words; ${what}`;
      if (m.kind === 'prompt-send') {
        const pm = st.comments[m.promptOf];
        return (
          `${m.sid} is his Send on a prompt: relay the prompt itself` +
          `${pm ? ` (source: "${ensureSid(pm).sid}")` : ''}.`
        );
      }
      // words from the chat authorise only when Claude Code marked the entry as typed by a person (origin: human); a
      // scheduled start, a watcher or a peer session is never Owner, whatever its text
      if (m.channel === 'operator-chat' && m.origin !== 'human')
        return (
          `${m.sid} came by your chat without Claude Code's mark that a person typed it, so it authorises nothing. ` +
          `Answer it with board_reply; for a relay, ask for his fresh words on the board or suggest a new prompt.`
        );
      return null;
    };
    if (l.ref.prompt) {
      // a prompt: Owner clicked Send, asked for it in his own words (on_word), or a standing authority covers it
      promptMsg = l.ref;
      const unavailable = prompts.unavailable(st, promptMsg);
      if (unavailable) return { ok: false, reason: unavailable };
      const pendingApproval = prompts.stateOf(promptMsg.prompt) !== 'offered';
      const recovery = pendingApproval
        ? 'Ask for his fresh words (on_word), or suggest a replacement prompt.'
        : `Ask him again, or ask him to Send ${promptMsg.sid}.`;
      to = promptMsg.prompt.to;
      cid = promptMsg.cardId;
      if (to !== 'firstmate') return { ok: false, reason: 'This prompt has no supported relay destination.' };
      if (promptMsg.prompt.approval?.via === 'send') {
        text = promptMsg.prompt.sentText || promptMsg.prompt.text;
        approval = promptMsg.prompt.approval;
      } else if (a.on_word) {
        const wl = lookup(String(a.on_word), 'message', board);
        if (wl.err) return { ok: false, reason: wl.err };
        word = wl.ref;
        const bad = hisWords(word, 'only his words authorise a prompt.');
        if (bad) return { ok: false, reason: bad };
        if (Date.now() - tms(word.t) > 2 * 3600000)
          return {
            ok: false,
            reason: `${word.sid} is over two hours old. ${recovery}`,
          };
        const over = overtaken(word);
        if (over) return { ok: false, reason: over };
        text = promptMsg.prompt.text;
        approval = { via: 'on-word', at: now(), by: who.name, onWord: word.id };
      } else if (a.under_authority) {
        const al = lookup(String(a.under_authority), 'authority', board);
        if (al.err) return { ok: false, reason: al.err };
        if (al.ref.revokedAt)
          return {
            ok: false,
            reason:
              `${al.ref.sid} has ended: Owner ended it ${et(al.ref.revokedAt)}` +
              `${isYolo(al.ref) ? ' with /yolo off' : ''}. ` +
              (pendingApproval ? recovery : `${promptMsg.sid} waits for his Send.`),
          };
        if (
          !activeAuthority(al.ref, board) ||
          !(al.ref.scope || {}).relay ||
          (al.ref.scope.target && al.ref.scope.target !== to)
        )
          return { ok: false, reason: `${a.under_authority} does not cover relaying your own prompts to the ${to}.` };
        text = promptMsg.prompt.text;
        auth = al.ref.sid;
        approval = { via: isYolo(al.ref) ? 'yolo' : 'authority', at: now(), by: who.name, authority: auth };
      } else
        return {
          ok: false,
          reason: pendingApproval
            ? `Name a current standing authority that covers it. ${recovery}`
            : `Owner has not clicked Send on ${promptMsg.sid}. ` +
              `Name the message where he asked for it (on_word), or a standing authority that covers it.`,
        };
      if (promptMsg.prompt.relayedAt && !a.again)
        return {
          ok: false,
          reason:
            `${promptMsg.sid} was relayed at ${et(promptMsg.prompt.relayedAt)}. ` +
            `Pass again: true to send it a second time.`,
        };
    } else {
      srcMsg = l.ref;
      const bad = hisWords(srcMsg, 'only his words and prompts are relayed.');
      if (bad) return { ok: false, reason: bad };
      to = a.to === 'firstmate' ? a.to : null;
      if (!to) return { ok: false, reason: 'Name to: firstmate.' };
      cid = srcMsg.cardId || null;
      const over = overtaken(srcMsg);
      if (over) return { ok: false, reason: over };
      if (srcMsg.relayedAt && !a.again)
        return {
          ok: false,
          reason:
            `${srcMsg.sid} was relayed at ${et(srcMsg.relayedAt)}. ` + `Pass again: true to send it a second time.`,
        };
      text = String(srcMsg.text).replace(
        /^Send this to (?:the )?(?:firstmate|steward|its target) on my behalf, verbatim:\s*/i,
        '',
      );
    }
    if (!text || !String(text).trim()) return { ok: false, reason: 'Nothing to relay.' };
    if (tc.VALIDATE_RELAY) return { ok: true, hash: crypto.createHash('sha256').update(text).digest('hex') };
    const ledger = !tc.REHEARSAL && ctx.dispatchLedger?.enabled(board);
    const intentId = a.intentId || call?.id;
    if (ledger)
      ctx.dispatchLedger.checkIssue(
        board,
        who,
        { to, hash: crypto.createHash('sha256').update(text).digest('hex') },
        intentId,
      );
    if (promptMsg) {
      if (prompts.stateOf(promptMsg.prompt) === 'offered') {
        const approved = prompts.approve(st, promptMsg, { ...approval, at: now() });
        if (!approved.ok) return approved;
      } else if (prompts.stateOf(promptMsg.prompt) === 'approved' && promptMsg.prompt.approval?.via !== 'send') {
        const refreshed = prompts.refreshApproval(st, promptMsg, { ...approval, at: now() });
        if (!refreshed.ok) return refreshed;
      }
      auth = auth || approval?.authority || null;
      word = word || (approval?.onWord && st.comments[approval.onWord]) || null;
      change('comment', promptMsg.id, who.name, board);
    }
    const tid = newId();
    st.tickets = st.tickets || {};
    const via = srcMsg || word,
      fromChat = !!(via && via.channel === 'operator-chat');
    st.tickets[tid] = {
      id: tid,
      board,
      by: who.name,
      to,
      text,
      hash: crypto.createHash('sha256').update(text).digest('hex'),
      cardId: cid,
      promptId: promptMsg ? promptMsg.id : null,
      messageId: srcMsg ? srcMsg.id : null,
      wordId: word ? word.id : null,
      word: word ? `${word.sid} ${q(word.text, 200)}` : undefined,
      fromChat: fromChat || undefined,
      context: a.context ? String(a.context).slice(0, 2000) : null,
      underAuthority: auth,
      seen: seenIds.length ? seenIds : undefined,
      again: !!a.again,
      t: now(),
      used: false,
    };
    const evidenceCapability = ctx.ownership?.ticket(who, board, who.epoch, st.tickets[tid]);
    const permission = ledger ? ctx.dispatchLedger.issue(board, who, st.tickets[tid], intentId) : {};
    // the context is the board's note only: the relay carries the text and nothing else, and the operator is told so
    const ctxNote = a.context
      ? ` Your context stays on the board's record: the ${to} receives the text alone. ` +
        `For more than his words, relay a board_prompt that quotes him and says it (on_word: his message).`
      : '';
    return {
      ok: true,
      summary:
        `Relay authorised to the ${to}` +
        `${viaSend ? ` (prompt ${ensureSid(promptMsg).sid}, on his Send ${viaSend.sid})` : ''}.${ctxNote}`,
      ticket: { id: tid, to, text, hash: st.tickets[tid].hash, again: !!a.again, evidenceCapability, ...permission },
    };
  };
  tc.settleRelaySource = (board, who, tk, t = now(), source = 'operator') => {
    if (tk.sourceSettledAt) return;
    const st = S();
    const prompt = tk.promptId && st.comments[tk.promptId];
    if (prompt?.prompt && !prompt.prompt.relayedAt) prompts.relay(st, prompt, t, tk.again);
    const card = tk.cardId ? st.cards[tk.cardId] : null;
    const basis = tk.word
      ? ` On Owner's word ${tk.word}${tk.fromChat ? ", typed in the operator's chat" : ''}.`
      : tk.fromChat
        ? " His words as typed in the operator's chat."
        : tk.underAuthority
          ? ` Under standing authority ${tk.underAuthority}.`
          : '';
    message({
      board,
      cardId: tk.cardId,
      cardTitle: card ? card.title : null,
      text:
        `Sent to the ${tk.to}, exactly as the board gave it ` +
        (source === 'owner'
          ? `(delivery established by owner reconciliation).${basis}`
          : `(delivery reported by the operator's tool server).${basis}`) +
        (tk.context ? '\n\n' + tk.context : ''),
      by: who.name,
      label: 'RELAYED',
      underAuthority: tk.underAuthority || undefined,
      onWord: tk.wordId || undefined,
      ticket: tk.id,
      textHash: tk.hash.slice(0, 16),
    });
    if (tk.promptId && st.comments[tk.promptId]) {
      const pm = st.comments[tk.promptId];
      change('comment', pm.id, who.name, board);
    }
    if (tk.messageId && st.comments[tk.messageId]) {
      const m = st.comments[tk.messageId];
      m.relayedAt = t;
      if (!m.handled) {
        m.handled = true;
        m.handledAt = t;
        m.handledBy = who.name;
      }
      change('comment', m.id, who.name, board);
    }
    for (const pm of Object.values(st.comments))
      if (pm.kind === 'prompt-send' && tk.promptId && pm.promptOf === tk.promptId && !pm.handled) {
        pm.handled = true;
        pm.handledAt = t;
        pm.handledBy = who.name;
      }
    if (card) {
      laneFollows(card);
      logLine(card, 'RELAYED', `Sent to the ${tk.to}.`, who.name);
    }
    tk.sourceSettledAt = t;
  };
  // relay, step two: the tool server reports delivery against the ticket
  T._relay_result = (board, who, a, call) => {
    const st = S(),
      tk = (st.tickets || {})[String(a.ticket || '')];
    if (!tk || tk.board !== board || (tk.by !== who.name && !(tk.ledgerIntentId && ctx.dispatchLedger?.enabled(board))))
      return { ok: false, reason: 'No such relay ticket for you.' };
    const settled = !tc.REHEARSAL && ctx.dispatchLedger?.receipt(board, who, tk, a, call.id);
    if (settled && (!settled.ok || settled.duplicate)) return settled;
    if (tk.used) return { ok: false, reason: 'That relay ticket was already reported.' };
    if (!tk.evidenceHash && Date.now() - tms(tk.t) > 86400000)
      return { ok: false, reason: 'That relay ticket is over a day old.' };
    if (a.delivered && tk.promptId) {
      const prompt = st.comments[tk.promptId];
      if (!prompt?.prompt && !settled) return { ok: false, reason: 'This prompt is no longer available.' };
      if (prompt?.prompt) {
        const recorded = prompts.relay(st, prompt, now(), tk.again);
        if (!recorded.ok && !settled) return recorded;
      }
    }
    tk.used = true;
    tk.delivered = !!a.delivered;
    tk.detail = String(a.detail || '').slice(0, 400);
    const t = now();
    tk.reportedAt = t;
    const relay_receipt = { id: call.id, ticket: tk.id, delivered: tk.delivered };
    if (!a.delivered)
      return {
        ok: true,
        relay_receipt,
        summary: `The relay to the ${tk.to} did not go: ${tk.detail || 'no detail'}. Nothing was recorded as sent.`,
      };
    tc.settleRelaySource(board, who, tk, t);
    return {
      ok: true,
      relay_receipt,
      summary:
        `Relayed to the ${tk.to}; recorded.` +
        `${tk.context ? ` Your context is on the board's record only: the ${tk.to} received the text alone.` : ''}`,
    };
  };
};
