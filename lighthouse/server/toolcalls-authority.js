'use strict';
// The tool-call engine's standing authorities (see toolcalls.js): board_authorities, board_handoff, the /yolo switch
// Owner types on his page, and the route a person records an authority through.

module.exports = function makeAuthorities(tc) {
  const { ctx, now, newId, S, change, tms, authorOf, assign, lookup, q, et, message, receipt, T, W } = tc;

  // standing authorities: records made only by a person (section 7)
  function activeAuthority(t, board) {
    return t && t.board === board && !t.revokedAt && !t.supersededBy && (!t.expires || tms(t.expires) > Date.now());
  }
  T.board_authorities = board => {
    const list = Object.values(S().authorities || {})
      .filter(t => t.board === board)
      .sort((x, y) => tms(y.t) - tms(x.t));
    return {
      ok: true,
      summary: list.length
        ? list
            .map(
              t =>
                `${assign(t, 't', 'authority')} ` +
                `${
                  activeAuthority(t, board) ? 'in force' : t.supersededBy ? 'superseded by ' + t.supersededBy : 'ended'
                }` +
                `: ${q(t.scope && t.scope.covers, Infinity)} (Owner, ${et(t.ownerAt)}: ${q(t.ownerWords, Infinity)})`,
            )
            .join('\n')
        : 'No standing authorities on this board.',
    };
  };
  T.board_handoff = (board, who, a) => {
    if (!W(who, board)) return { ok: false, reason: "Only this board's operator writes its handoff." };
    const st = S(),
      b = st.boards[board],
      auth = Object.values(st.authorities || {}).filter(t => t.board === board);
    const md = [
      `# Handoff: ${b.name || board}`,
      '',
      `Written ${now()} by ${who.name} through board_handoff. Read it whole, then call board_status.`,
      '',
      '## Standing authorities (records made by Owner; nothing else is authority)',
      ...(auth.length
        ? auth.map(
            t =>
              `- ${assign(t, 't', 'authority')} ` +
              `${
                activeAuthority(t, board) ? 'IN FORCE' : t.supersededBy ? 'SUPERSEDED by ' + t.supersededBy : 'ENDED'
              }` +
              `: ${q(t.scope && t.scope.covers, Infinity)}. Owner, ${t.ownerAt}: ${q(t.ownerWords, Infinity)}` +
              `${t.supersedes ? ` (supersedes ${t.supersedes})` : ''}`,
          )
        : ['- none recorded']),
      '',
      "## People and channels (the operator's notes)",
      String(a.people || '(none given)').slice(0, 4000),
      '',
      "## Preferences (the operator's notes)",
      String(a.preferences || '(none given)').slice(0, 4000),
      '',
      "## Open commitments (the operator's notes)",
      String(a.commitments || '(none given)').slice(0, 4000),
      '',
      '## The board now',
      '```',
      receipt(board, who, 'full'),
      '```',
    ];
    b.handoffAt = now();
    return { ok: true, summary: 'Handoff written.', handoff: md.join('\n') };
  };

  // /yolo: a mode in which the operator prompts firstmate without waiting for Owner's Send, except for critical
  // direction decisions. He types /yolo or /yolo off on the board, on his page; the board records, or ends, a standing
  // authority from that message of his
  const YOLO_CRITICAL =
    'Critical direction decisions still come to me as asks: choosing between directions ' +
    '(which approach, what to build, whether to stop), anything touching reps or distribution, ' +
    "and anything that deletes data or can't be taken back.";
  // a scope narrows it: only that work goes without his Send
  const yoloCovers = scope =>
    scope
      ? `/yolo, ${scope} only: the operator prompts firstmate on that without my Send each time; ` +
        `anything else waits for my Send. ${YOLO_CRITICAL}`
      : `/yolo: the operator prompts firstmate without my Send each time. ${YOLO_CRITICAL}`;
  // a /yolo authority, or one the chief developer recorded from his words before the switch existed
  const isYolo = t => !!t.yolo || /^\/yolo\b/i.test(String((t.scope || {}).covers || ''));
  function yoloOf(board) {
    const y = Object.values(S().authorities || {})
      .filter(t => isYolo(t) && activeAuthority(t, board))
      .sort((x, z) => tms(z.t) - tms(x.t))[0];
    if (y) assign(y, 't', 'authority');
    return y || null;
  }
  // rest: what he typed after /yolo ("", "on", "off", "on <a few words>", "<a few words>")
  function yoloSwitch(board, who, msg, rest) {
    if (ctx.ownership?.enabled(board)) {
      const authorize = () => {
        ctx.ownership.ctx.registry?.refresh();
        if (!ctx.ownership.captain(who, board)) ctx.ownership.refuse('explicit captain scope required');
      };
      if (!ctx.inTransaction()) return ctx.transact(authorize, () => yoloSwitch(board, who, msg, rest));
      authorize();
    }
    const st = S(),
      t = now(),
      cur = yoloOf(board);
    st.authorities = st.authorities || {};
    rest = String(rest || '')
      .trim()
      .replace(/[.!]+$/, '')
      .trim();
    const on = !/^off\b/i.test(rest),
      scope = on
        ? rest
            .replace(/^on\b\s*/i, '')
            .replace(/^(for|on)\s+/i, '')
            .trim()
        : '';
    let said;
    if (scope.length > 80)
      said =
        `A /yolo scope is a few words, like "/yolo on hyperenriched matters": ` +
        `this one is ${scope.length} characters, so nothing was switched.`;
    else if (on && cur && (cur.yoloScope || '') === scope)
      said = `/yolo is already on (${cur.sid}${scope ? ', ' + scope + ' only' : ''}, since ${et(cur.t)}).`;
    else if (on) {
      const id = newId(),
        a = {
          id,
          board,
          t,
          by: who.name,
          ownerWords: String(msg.text).trim().slice(0, 2000),
          ownerAt: msg.t,
          scope: { covers: yoloCovers(scope), relay: true, target: 'firstmate' },
          expires: null,
          supersedes: null,
          messageId: msg.id,
          yolo: true,
          yoloScope: scope || null,
        };
      st.authorities[id] = a;
      assign(a, 't', 'authority');
      if (cur) {
        a.supersedes = cur.sid;
        cur.supersededBy = a.sid;
      }
      said =
        `/yolo is on (${a.sid}${cur ? ', replacing ' + cur.sid : ''})` +
        `${
          scope
            ? ` for ${scope} only: the operator prompts firstmate on that without your Send, ` +
              `and anything else waits for your Send`
            : ': the operator prompts firstmate without your Send'
        }` +
        `. Critical direction decisions still come to you as asks. /yolo off ends it.`;
    } else {
      const ended = Object.values(st.authorities).filter(x => isYolo(x) && activeAuthority(x, board));
      for (const x of ended) {
        assign(x, 't', 'authority');
        x.revokedAt = t;
        x.revokedBy = who.name;
        x.revokedMessageId = msg.id;
      }
      said = ended.length
        ? `/yolo is off (${ended.map(x => x.sid).join(', ')} ended): ` +
          `every prompt to firstmate waits for your Send again.`
        : '/yolo was not on.';
    }
    // the board answered it: nothing owed by the operator
    Object.assign(msg, {
      handled: true,
      handledAt: t,
      handledBy: 'board',
      yolo: scope.length > 80 ? 'refused' : on ? 'on' : 'off',
    });
    message({
      board,
      cardId: msg.cardId,
      cardTitle: msg.cardTitle,
      text: said,
      by: 'board',
      via: 'board',
      label: 'YOLO',
      author: 'system',
      replyTo: msg.id,
    });
    ctx.pushActivity(st.boards[board], `owner: /yolo ${on ? 'on' : 'off'}`, t);
    change('board', board, who.name, board);
    ctx.saveNow();
    return said;
  }

  // a person records a standing authority from his own words (section 7). The chief developer may record one only from
  // a message Owner wrote on the board, quoting it exactly: the words are his, the record only formalises them.
  function createAuthority(board, who, body) {
    if (ctx.ownership?.enabled(board)) {
      const authorize = () => {
        ctx.ownership.ctx.registry?.refresh();
        if (!ctx.ownership.captain(who, board)) ctx.ownership.refuse('explicit captain scope required');
      };
      if (!ctx.inTransaction()) return ctx.transact(authorize, () => createAuthority(board, who, body));
      authorize();
    }
    if (!who) return { status: 401, body: { error: 'no access' } };
    if (!ctx.store().boards[board]) return { status: 404, body: { error: 'no such board' } };
    const person = who.via === 'page' && ctx.roleOn(who, board) >= 4,
      chief = who.name === 'chief developer' && ctx.roleOn(who, board) >= 3 && (who.mode || 'lines') === 'lines';
    if (!person && !chief)
      return {
        status: 403,
        body: {
          error: 'only Owner, or the chief developer quoting his message on this board, records a standing authority',
        },
      };
    const words = String(body.owner_words || '').trim(),
      covers = String(body.covers || '').trim();
    if (!words || !covers) return { status: 400, body: { error: 'owner_words and covers are required' } };
    let src = null;
    if (body.message_id || !person) {
      const l = lookup(String(body.message_id || ''), 'message', board);
      if (l.err) return { status: 400, body: { error: 'message_id: ' + l.err } };
      src = l.ref;
      const norm = s =>
        String(s || '')
          .replace(/\s+/g, ' ')
          .trim()
          .toLowerCase();
      if (authorOf(src) !== 'owner' || src.channel === 'operator-chat' || src.kind === 'prompt-send')
        return { status: 400, body: { error: `${src.sid} is not Owner's own message on the board` } };
      if (!norm(src.text).includes(norm(words)))
        return { status: 400, body: { error: `owner_words must be quoted exactly from ${src.sid}` } };
    }
    const st = ctx.store();
    st.authorities = st.authorities || {};
    const id = newId(),
      t = {
        id,
        board,
        t: now(),
        by: who.name,
        ownerWords: words.slice(0, 2000),
        ownerAt: src ? src.t : String(body.owner_at || now()),
        scope: {
          covers: covers.slice(0, 400),
          relay: !!body.relay,
          target: ['firstmate', 'steward'].includes(body.target) ? body.target : null,
        },
        expires: body.expires || null,
        supersedes: null,
        messageId: src ? src.id : null,
      };
    // a /yolo he typed before the switch read scopes, recorded by hand
    if (body.yolo_scope) Object.assign(t, { yolo: true, yoloScope: String(body.yolo_scope).trim().slice(0, 80) });
    if (body.supersedes) {
      const l = lookup(String(body.supersedes), 'authority', board);
      if (l.err) return { status: 400, body: { error: l.err } };
      t.supersedes = l.ref.sid;
      st.authorities[id] = t;
      l.ref.supersededBy = assign(t, 't', 'authority');
    }
    st.authorities[id] = t;
    assign(t, 't', 'authority');
    ctx.saveNow();
    ctx.change('board', board, who.name, board);
    return { status: 201, body: { authority: t } };
  }

  return { activeAuthority, isYolo, yoloOf, yoloSwitch, createAuthority };
};
