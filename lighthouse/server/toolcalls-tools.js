'use strict';
const lifecycle = require('./card-transitions');
const prompts = require('./prompt-transitions');
const shifts = require('./shift');
// The tool-call engine's card and board tools (see toolcalls.js): board_status, board_open, board_post, board_reply,
// board_ask, board_withdraw, board_close, board_ops, board_shift, board_ack, board_dispute and board_notice.

module.exports = function addTools(tc) {
  const {
    ctx,
    now,
    newId,
    S,
    fx,
    change,
    notify,
    crmSend,
    judge,
    tms,
    authorOf,
    assign,
    lookup,
    ensureSid,
    q,
    sl,
    similar,
    cardsOf,
    openAsks,
    cardId,
    resolveCard,
    message,
    logLine,
    staffOpen,
    crmWorking,
    activeAuthority,
    T,
    W,
  } = tc;

  // a new card's slug from its title, when the operator gives none
  const slugify = t =>
    String(t || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'task';
  // an ask that is only housekeeping ("can I close it?"): closing a card is the operator's own job
  const HOUSEKEEPING = new RegExp(
    /\b(can|may|should|shall) (i|we) (close|finish|archive|mark (it|this) (done|finished))\b/.source +
      /|\b(ok|okay|safe|fine) to close\b|\bready to (be )?close/.source,
    'i',
  );

  T.board_status = (board, who, a) => ({
    ok: true,
    summary: 'Status.',
    detail: a.detail === 'full' ? 'full' : 'brief',
  });

  T.board_open = (board, who, a) => {
    if (!W(who, board)) return { ok: false, reason: "Only this board's operator opens cards here." };
    const title = String(a.title || '').trim();
    if (!title) return { ok: false, reason: 'A card needs a title, in plain words.' };
    const open = cardsOf(board).filter(c => c.status !== 'done');
    const near = open
      .map(c => [similar(title, c.title), c])
      .filter(x => x[0] >= 0.75)
      .sort((x, y) => y[0] - x[0]);
    if (near.length && !a.distinct)
      return {
        ok: false,
        reason: `An open card looks the same: ${near
          .slice(0, 3)
          .map(x => `${sl(board, x[1].id)} ${q(x[1].title, 60)}`)
          .join('; ')}. Post on it, or pass distinct: true if this is different work.`,
      };
    // a slug that starts with the board's name drops it: "board-x" on that board is x, so the id is never board-board-x
    const given = a.slug && String(a.slug).startsWith(board + '-') ? String(a.slug).slice(board.length + 1) : a.slug;
    let slug = given && /^[a-z0-9][a-z0-9-]{1,47}$/.test(given) ? given : slugify(title),
      id = board + '-' + slug,
      n = 2;
    const st = S();
    if (st.cards[id] && st.cards[id].status !== 'done')
      return { ok: false, reason: `The card ${slug} is already open. Post on it.` };
    while (st.cards[id]) id = board + '-' + slug + '-' + n++;
    const state = ['queued', 'inflight', 'held'].includes(a.state) ? a.state : 'queued',
      t = now();
    const card = lifecycle.open({
      id,
      board,
      title: title.slice(0, 120),
      status: state,
      source: 'operator:' + who.name,
      createdAt: t,
      updatedAt: t,
      updatedBy: who.name,
      decisions: [],
      log: [],
      context: String(a.context || '').slice(0, 8000),
    }).card;
    st.cards[id] = card;
    for (const k of ['severity', 'complexity', 'nature']) if (a[k]) card[k] = String(a[k]).slice(0, 20);
    logLine(card, 'FYI', 'Opened: ' + title, who.name);
    ctx.pushActivity(st.boards[board], `${who.name} opened ${title}`, t);
    fx(() =>
      setImmediate(() => {
        try {
          ctx.judgeCard(id);
        } catch (e) {}
      }),
    );
    return { ok: true, summary: `Opened ${sl(board, id)}.`, card: id };
  };

  T.board_post = (board, who, a) => {
    if (!W(who, board)) return { ok: false, reason: "Only this board's operator posts here." };
    const attachmentError = ctx.attachmentError(a.attachments, who, S());
    if (attachmentError) return { ok: false, reason: attachmentError };
    const kind = ['status', 'context', 'fyi'].includes(a.kind) ? a.kind : null;
    if (!kind) return { ok: false, reason: 'kind is status, context or fyi.' };
    const text = String(a.text || '').trim();
    if (!text) return { ok: false, reason: 'The post needs text.' };
    // no post on General: news always belongs to a task, and news that fits no task gets a new one
    if (a.general)
      return {
        ok: false,
        reason:
          'News always belongs to a card (ruling 42): post it on the card it is about, or board_open one for it. ' +
          'On General you only answer his messages there (board_reply).',
      };
    const r = resolveCard(board, a.card);
    if (r.err) return { ok: false, reason: r.err + (a.card ? '' : ' News that fits no card: board_open one for it.') };
    const card = r.card;
    if (card.status === 'done')
      return { ok: false, reason: `${sl(board, card.id)} is closed. Open a new card, or post on an open one.` };
    if (a.state === 'done') return { ok: false, reason: 'Only board_close finishes a card.' };
    if (a.state === 'waiting')
      return {
        ok: false,
        reason: 'A card waits on Owner only through board_ask or board_prompt; a wait on someone else is state: held.',
      };
    if (a.state && !['queued', 'inflight', 'held'].includes(a.state))
      return { ok: false, reason: 'state is queued, inflight or held.' };
    let auth = null;
    if (a.under_authority) {
      const l = lookup(a.under_authority, 'authority', board);
      if (l.err) return { ok: false, reason: l.err };
      if (!activeAuthority(l.ref, board))
        return { ok: false, reason: `${a.under_authority} is not in force on this board.` };
      auth = l.ref.sid;
    }
    if (kind === 'status') card.description = text;
    if (kind === 'context') card.context = text;
    if (a.title) card.title = String(a.title).slice(0, 120);
    if (a.state) lifecycle.move(card, a.state);
    logLine(card, kind.toUpperCase(), text, who.name, auth ? { underAuthority: auth } : null);
    const atts = ctx.attsOf(a.attachments);
    if (atts.length)
      message({
        board,
        cardId: card.id,
        cardTitle: card.title,
        text,
        by: who.name,
        label: kind.toUpperCase(),
        attachments: atts,
      });
    crmWorking(card);
    return { ok: true, summary: `Posted ${kind} on ${sl(board, card.id)}.` };
  };

  T.board_reply = (board, who, a, call) => {
    if (!W(who, board)) return { ok: false, reason: "Only this board's operator replies here." };
    const attachmentError = ctx.attachmentError(a.attachments, who, S());
    if (attachmentError) return { ok: false, reason: attachmentError };
    const text = String(a.text || '').trim();
    if (!text && !a.noted) return { ok: false, reason: 'The reply needs text.' };
    if (a.noted && a.hold) return { ok: false, reason: 'hold or noted, not both.' };
    const ids = Array.isArray(a.to) ? a.to.map(String) : a.to == null || a.to === '' ? [] : [String(a.to)];
    if (!ids.length)
      return {
        ok: false,
        reason:
          'Name the message you are answering: to: "<id>" (from the receipt or the route line), ' +
          'a list of ids, or "chat".',
      };
    if (ids.length > 20) return { ok: false, reason: 'One reply answers at most 20 messages.' };
    const targets = [];
    for (const sid of [...new Set(ids)]) {
      const l = lookup(sid, 'message', board);
      if (l.err) return { ok: false, reason: l.err };
      targets.push(l.ref);
    }
    const want = a.general ? null : a.card ? cardId(board, a.card) : undefined;
    if (want === undefined) return { ok: false, reason: 'Name where the message is: card: "<slug>" or general: true.' };
    // what he typed in the operator's chat lands on General (the board cannot tell which card it is about); answered on
    // a card, it moves there with its answer, so a chat message about a card can be answered on that card
    const moves = m => want && !m.cardId && m.channel === 'operator-chat';
    for (const m of targets) {
      if (!moves(m) && (m.cardId || null) !== want)
        return {
          ok: false,
          reason:
            `${m.sid} is on ${m.cardId ? 'card ' + sl(board, m.cardId) : 'General'}, ` +
            `not ${want ? 'card ' + sl(board, want) : 'General'}. Check the id.`,
        };
      if (m.handled && !a.follow_up)
        return { ok: false, reason: `${m.sid} is already answered. For more on it, pass follow_up: true.` };
      if (a.noted && authorOf(m) === 'staff')
        return {
          ok: false,
          reason:
            `${m.sid} is a staff question: the asker is waiting for an answer (kind: answer, or declined), ` +
            `never just a note.`,
        };
    }
    const t = now(),
      card = want ? S().cards[want] : null;
    if (want && !card) return { ok: false, reason: `There is no card ${q(a.card, 60)} on this board.` };
    if (a.state && !['queued', 'inflight', 'held'].includes(a.state))
      return { ok: false, reason: 'state is queued, inflight or held; board_close finishes a card.' };
    const settle = [];
    for (const sid of Array.isArray(a.settles) ? a.settles : []) {
      const l = lookup(String(sid), 'ask', board);
      if (l.err) return { ok: false, reason: l.err };
      if (l.ref.resolvedAt) return { ok: false, reason: `${sid} is already settled.` };
      settle.push(l);
    }
    for (const m of targets)
      if (moves(m)) {
        m.cardId = want;
        m.cardTitle = card.title;
      }
    if (a.noted) {
      for (const m of targets) {
        m.handled = true;
        m.handledAt = t;
        m.handledBy = who.name;
        m.noted = true;
        change('comment', m.id, who.name, board);
      }
      return { ok: true, summary: `Marked ${targets.map(m => m.sid).join(', ')} as needing no answer.` };
    }
    const atts = ctx.attsOf(a.attachments);
    const reply = message({
      board,
      cardId: want,
      cardTitle: card ? card.title : null,
      text,
      by: who.name,
      label: 'REPLY',
      replyTo: targets[targets.length - 1].id,
      attachments: atts,
      hold: a.hold ? true : undefined,
      toolCall: call.id,
    });
    judge(reply.id);
    for (const l of settle) {
      const d = l.ref;
      if (l.card) {
        prompts.settle(S(), l.card, [d], { resolvedAt: t, resolvedBy: who.name, resolvedVia: reply.id });
        change('card', l.card.id, who.name, board);
      }
    }
    let sending = false;
    for (const m of targets) {
      if (a.hold) {
        m.holdAt = t;
        m.holdBy = who.name;
      } else {
        m.handled = true;
        m.handledAt = t;
        m.handledBy = who.name;
        m.answeredBy = reply.id;
      }
      change('comment', m.id, who.name, board);
      if (authorOf(m) === 'staff' && card && card.crm && !a.hold) {
        const kind = ['answer', 'declined', 'needs_owner'].includes(a.kind) ? a.kind : 'answer';
        crmSend(
          'reply',
          card.crm.id,
          card.id,
          { text, answeredAt: t, by: who.name, kind },
          { closeOnDelivery: !a.state },
        );
        sending = true;
      }
    }
    if (a.hold) crmWorking(card);
    if (card) {
      if (a.state) lifecycle.move(card, a.state);
      logLine(card, 'REPLY', text, who.name);
    }
    return {
      ok: true,
      summary:
        `${a.hold ? 'Holding answer on' : 'Answered'} ${targets.map(m => m.sid).join(', ')}` +
        `${settle.length ? '; settled ' + settle.map(l => l.ref.sid).join(', ') : ''}` +
        `${sending ? '; sending to the CRM; awaiting delivery' : ''}.`,
    };
  };

  T.board_ask = (board, who, a) => {
    if (!W(who, board)) return { ok: false, reason: "Only this board's operator asks here." };
    const r = resolveCard(board, a.card);
    if (r.err) return { ok: false, reason: r.err };
    const card = r.card;
    if (card.status === 'done') return { ok: false, reason: `${sl(board, card.id)} is closed.` };
    const question = String(a.question || '').trim();
    if (!question) return { ok: false, reason: 'The ask needs a one-line question.' };
    if (/\n/.test(question) || question.length > 300)
      return { ok: false, reason: 'Keep the question to one line; put the rest in detail.' };
    if (HOUSEKEEPING.test(question))
      return { ok: false, reason: "Housekeeping is yours, not Owner's: if the card is over, board_close it." };
    const open = openAsks(card);
    let replaced = null,
      under = null;
    // an ask after its own prompt: the prompt goes under the ask, as for_ask puts it there the other way round, so
    // Owner has one question and his Send settles it
    if (open.length === 1 && open[0].kind === 'prompt' && !a.replaces) {
      const pm = S().comments[open[0].commentId];
      if (pm && pm.prompt && prompts.stateOf(pm.prompt) === 'offered') under = open[0];
    }
    if (open.length && !a.replaces && !under)
      return {
        ok: false,
        reason:
          `${sl(board, card.id)} already has an open ask ` +
          `(${open.map(d => assign(d, 'a', 'ask', card) + ' ' + q(d.ask, Infinity)).join('; ')}). ` +
          `Pass replaces: "<ask id>" to replace it, or wait for his answer.`,
      };
    if (a.replaces) {
      const l = lookup(String(a.replaces), 'ask', board);
      if (l.err) return { ok: false, reason: l.err };
      if (!open.includes(l.ref)) return { ok: false, reason: `${a.replaces} is not an open ask on this card.` };
      replaced = l.ref;
    }
    // the options are kept whole: no length cap
    const t = now(),
      options = Array.isArray(a.options) ? a.options.slice(0, 6).map(x => String(x)) : null;
    if (replaced) {
      prompts.settle(S(), card, [replaced], { resolvedAt: t, resolvedBy: who.name, replacedBy: true });
    }
    const rev = ['yes', 'no', 'partly'].includes(String(a.reversible || '').toLowerCase())
        ? String(a.reversible).toLowerCase()
        : undefined,
      rec = a.recommendation ? String(a.recommendation).slice(0, 1000) : undefined;
    // the brief (STEWARD-ASSISTANT-DESIGN.md section 6): marked when missing, never refused
    const d = {
      id: newId(),
      ask: question,
      options,
      detail: a.detail ? String(a.detail).slice(0, 4000) : undefined,
      openedAt: t,
      resolvedAt: null,
      by: who.name,
      kind: 'ask',
      reversible: rev,
      recommendation: rec,
      urgent: a.urgent === false ? false : undefined,
      briefMissing: !rec ? true : undefined,
    };
    if (under) {
      prompts.settle(
        S(),
        card,
        [under],
        { resolvedAt: t, resolvedBy: who.name, mergedInto: d.id },
        { keepPrompt: under.commentId },
      );
      d.promptId = under.commentId;
    }
    if (tc.BATCH_ASKS) tc.BATCH_ASKS.add(d.id);
    card.decisions = (card.decisions || []).filter(x => !x.resolvedAt || x === replaced || x === under);
    lifecycle.ask(card, d);
    assign(d, 'a', 'ask', card);
    const body =
      question +
      (options ? '\n\n' + options.map((o, i) => `${String.fromCharCode(65 + i)}. ${o}`).join('\n') : '') +
      (d.detail ? '\n\n' + d.detail : '');
    message({ board, cardId: card.id, cardTitle: card.title, text: body, by: who.name, label: 'ACTION', askId: d.id });
    logLine(card, 'ACTION', question, who.name);
    // the prompt pinged him minutes ago: the question it now sits under adds no second ping
    if (!(under && Date.now() - tms(under.openedAt) < 10 * 60000))
      fx(() => {
        if (
          !(
            ctx.holdPing &&
            ctx.holdPing(
              board,
              ctx.store().cards[card.id],
              [ctx.store().cards[card.id].decisions.find(x => x.id === d.id)].filter(Boolean),
            )
          )
        )
          ctx.notify(board, {
            kind: 'ask',
            title: 'Needs you: ' + (ctx.store().boards[board].name || board),
            body: (card.title + ': ' + question).slice(0, 200),
            url: '/#card=' + card.id,
            tag: card.id,
          });
      });
    if (card.crm) {
      const sm = staffOpen(card);
      if (sm) {
        sm.handled = true;
        sm.handledAt = t;
        sm.handledBy = who.name;
        crmSend('reply', card.crm.id, card.id, {
          text: 'This needs a decision from Owner before anything changes; the operator has put it to him.',
          answeredAt: t,
          by: who.name,
          kind: 'needs_owner',
        });
      }
    }
    return {
      ok: true,
      summary:
        `Asked Owner on ${sl(board, card.id)}: ${d.sid}.` +
        (under
          ? ` Prompt ${ensureSid(S().comments[under.commentId]).sid} is under it: his Send sends it and settles ` +
            `the ask; if he answers another way, the ask stays his.`
          : ''),
    };
  };

  T.board_withdraw = (board, who, a) => {
    if (!W(who, board)) return { ok: false, reason: "Only this board's operator withdraws asks here." };
    const l = lookup(String(a.ask_id || ''), 'ask', board);
    if (l.err) return { ok: false, reason: l.err };
    const d = l.ref,
      card = l.card;
    if (d.resolvedAt) return { ok: false, reason: `${a.ask_id} is already settled.` };
    const reason = String(a.reason || '').trim();
    if (!reason) return { ok: false, reason: 'Say why it is withdrawn.' };
    prompts.settle(S(), card, [d], { resolvedAt: now(), resolvedBy: who.name, withdrawn: reason });
    message({
      board,
      cardId: card.id,
      cardTitle: card.title,
      text: `Withdrawn: ${d.ask}\n\n${reason}`,
      by: who.name,
      label: 'REPLY',
    });
    logLine(card, 'FYI', 'Ask withdrawn: ' + reason, who.name);
    return { ok: true, summary: `Withdrew ${d.sid}.` };
  };

  T.board_close = (board, who, a) => {
    if (!W(who, board)) return { ok: false, reason: "Only this board's operator closes cards here." };
    const r = resolveCard(board, a.card);
    if (r.err) return { ok: false, reason: r.err };
    const card = r.card;
    if (card.status === 'done') return { ok: false, reason: `${sl(board, card.id)} is already closed.` };
    const open = openAsks(card);
    if (open.length)
      return {
        ok: false,
        reason:
          `${sl(board, card.id)} still has an open ask (${open.map(d => assign(d, 'a', 'ask', card)).join(', ')}). ` +
          'Get it answered, or board_withdraw it, first.',
      };
    if (card.crm && staffOpen(card))
      return {
        ok: false,
        reason:
          'The staff question on this card is unanswered. ' +
          'board_reply to it (kind: declined if you will not answer) first.',
      };
    const outcome = String(a.outcome || '').trim();
    if (!outcome) return { ok: false, reason: 'Say how it ended.' };
    const closed = prompts.close(S(), card, now());
    if (!closed.ok) return closed;
    logLine(card, 'FYI', 'Finished: ' + outcome, who.name, closed.completion);
    return { ok: true, summary: `Closed ${sl(board, card.id)}.` };
  };

  T.board_ops = (board, who, a) => {
    if (!W(who, board)) return { ok: false, reason: "Only this board's operator writes its Ops." };
    const text = String(a.text || '').trim();
    if (!text) return { ok: false, reason: 'Ops needs text.' };
    const b = S().boards[board];
    b.ops = (b.ops || [])
      .concat([
        {
          t: now(),
          text: text.slice(0, 2000),
          by: who.name,
          kind: ['fault', 'change', 'restart_failed', 'note'].includes(a.kind) ? a.kind : 'note',
        },
      ])
      .slice(-200);
    change('board', board, who.name, board);
    return { ok: true, summary: 'Noted in Ops.' };
  };

  T.board_shift = (board, who, a, call) => {
    if (!W(who, board)) return { ok: false, reason: "Only this board's operator changes its shift." };
    const b = S().boards[board],
      t = call?.queued ? new Date(call.at).toISOString() : now();
    if (a.action === 'start' || a.action === 'end') {
      shifts.transition({ store: S, change, pushActivity: ctx.pushActivity }, board, a.action, who.name, t);
    } else if (a.action === 'compacting') {
      // the PreCompact hook calls this with no note: a note the operator wrote in the last six hours is kept
      const note = String(a.note || '').trim(),
        keep = !note && b.pickup && b.pickup.note && Date.now() - tms(b.pickup.noteAt || b.pickup.t) < 6 * 3600000;
      b.pickup = {
        t,
        by: who.name,
        note: keep ? b.pickup.note : note.slice(0, 4000),
        noteAt: keep ? b.pickup.noteAt || b.pickup.t : t,
      };
    } else if (a.action === 'compacted') {
      /* the receipt comes back in full, with the rules (from the MCP server) */
    } else return { ok: false, reason: 'action is start, end, compacting or compacted.' };
    if (a.action !== 'start' && a.action !== 'end') change('board', board, who.name, board);
    return {
      ok: true,
      summary: `Shift ${a.action}.`,
      detail: a.action === 'compacted' || a.action === 'start' ? 'full' : 'brief',
      pickup: a.action === 'compacted' ? b.pickup || null : undefined,
    };
  };

  T.board_ack = (board, who, a, call, dispute) => {
    if (!W(who, board)) return { ok: false, reason: "Only this board's operator answers its notices." };
    const l = lookup(String(a.notice_id || ''), 'notice', board);
    if (l.err) return { ok: false, reason: l.err };
    const n = l.ref;
    if (n.handled) return { ok: false, reason: `${a.notice_id} is already settled.` };
    const text = String(dispute ? a.reason || '' : a.text || '').trim();
    if (!text) return { ok: false, reason: dispute ? 'Say why the notice is wrong.' : 'Say what you did about it.' };
    const t = now();
    if (dispute) {
      n.disputed = { t, by: who.name, reason: text };
    } else {
      n.handled = true;
      n.handledAt = t;
      n.handledBy = who.name;
      n.ackText = text;
    }
    const b = S().boards[board];
    b.ops = (b.ops || [])
      .concat([
        {
          t,
          text: (dispute ? 'Disputed notice: ' : 'Acknowledged notice: ') + text,
          by: who.name,
          kind: dispute ? 'dispute' : 'ack',
        },
      ])
      .slice(-200);
    change('comment', n.id, who.name, board);
    return {
      ok: true,
      summary: dispute ? `Disputed ${n.sid}; it waits for the watch or Owner.` : `Acknowledged ${n.sid}.`,
    };
  };
  T.board_dispute = (board, who, a, call) => T.board_ack(board, who, a, call, true);

  T.board_notice = (board, who, a) => {
    // sent from the watch's own board (the URL's), to the board it watches
    const target = String(a.board || '');
    if (!S().boards[target]) return { ok: false, reason: `There is no board ${q(target, 30)}.` };
    if (!ctx.canNotice(who, board, target)) return { ok: false, reason: `You are not the watch on ${target}.` };
    const text = String(a.text || '').trim();
    if (!text) return { ok: false, reason: 'A notice needs text.' };
    const n = message({
      board: target,
      cardId: null,
      cardTitle: null,
      text: (a.rule ? `[${String(a.rule).slice(0, 40)}] ` : '') + text.slice(0, 4000),
      by: who.name,
      kind: 'notice',
      handled: false,
      label: 'NOTICE',
      author: 'watch',
      fromBoard: board,
      refs: Array.isArray(a.refs) ? a.refs.slice(0, 10).map(x => String(x).slice(0, 20)) : undefined,
    });
    assign(n, 'n', 'notice');
    message({
      board,
      cardId: null,
      cardTitle: null,
      text: 'To ' + target + ': ' + text.slice(0, 4000),
      by: who.name,
      kind: 'notice-sent',
      label: 'NOTICE',
      author: 'watch',
      about: target,
    });
    notify(target, {
      kind: 'notice',
      title: 'Watch notice for ' + (S().boards[target].name || target),
      body: who.name + ': ' + text.slice(0, 180),
      url: '/#board=' + target,
      tag: 'notice-' + target,
    });
    return { ok: true, summary: `Notice ${n.sid} sent to ${target}.` };
  };
};
