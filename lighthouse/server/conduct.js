'use strict';
const { ownerId, isOwnerName } = require('./configuration');
const { presence, active } = require('./shift-presence');
// The conduct report: every fault the operator's brief forbids, counted from the store over a window, plus the
// instruments' own telemetry and Jev's verdicts; read by the page and by conductwatch.cjs.
// the card log's kinds that are news of the work itself, as opposed to asks, prompts, replies and relays
const WORK_KINDS = new Set(['STATUS', 'CONTEXT', 'FYI']);
const { questionState } = require('./crm-state');
// Historical finish wording is evidence for the report, not permission to close a card or settle an ask.
const LEGACY_FINISHED = new RegExp(
  /^(finished|done|delivered|closed[- ]out|completed?)\b/.source + /|\btask (is )?(done|finished|completed?)\b/.source,
  'i',
);
const DONE_CONTENT =
  /(?:that )?(?:[\w'-]+ ){1,10}(?:is|are|was|has been|have been) (?:now |already )?/.source +
  /(?:live|fixed|done|finished|completed?)(?: and (?:working|live|fixed|done|finished|complete))?/.source;
function isDoneNotice(text) {
  // Recognize only a plain completed-work announcement; strip the polite request wrapper, not its conditions.
  const request = text
    .trim()
    .replace(/\b(it|that)'s\b/gi, '$1 is')
    .replace(/[.!?]+$/, '')
    .replace(/^(?:(?:can|may|should|shall|could|would) (?:i|we)|would you like me to|do you want me to)\s+/i, '');
  if (/[.!?;\n]/.test(request)) return false;
  // A conditional, reason or multi-sentence request may still need a decision; never excuse it as a done notice.
  const content = text =>
    !/\b(?:to|when|once|after|before|if|since|because|now that)\b/i.test(text) &&
    new RegExp('^' + DONE_CONTENT + '$', 'i').test(text.replace(/^(?:that )?["']|["']$/g, ''));
  const post = request.match(/^post (?:the )?(.+?) note(?: to (.+))?$|^post (?:the )?note (.+)$/i);
  if (post)
    return (
      content(post[1] || post[3]) &&
      (!post[2] ||
        post[2].split(/,\s*(?:and )?| and | & /i).every(
          // Accept an explicit audience or a person's name, not an arbitrary trailing instruction.
          person =>
            /^(?:(?:the )?(?:team|requester|person who (?:asked(?: for it)?|requested it))|you|him|her|them)$/i.test(
              person.trim(),
            ) || /^[A-Z][\w'-]*(?: [A-Z][\w'-]*)*$/.test(person.trim()),
        ))
    );
  const notice = request.match(/^(?:tell|notify) (.+)$|^let (.+?) know (.+)$|^announce (.+)$/i);
  return !!notice && content(notice[1] || notice[3] || notice[4]);
}
module.exports = function makeConduct(ctx) {
  const { cfg, store, slugOf, isStandingCard, isWatchOn, plainWords, CRM, staleCards } = ctx;
  const { judgeActive, judgeSpread, spreadPending } = ctx;
  function conductOf(board, minutes) {
    const b = store.boards[board],
      nowMs = Date.now(),
      since = new Date(nowMs - minutes * 60000).toISOString();
    const opName = n => n && !isOwnerName(ctx.cfg, n) && !isWatchOn(n, board);
    const lines = Object.values(store.comments).filter(
      c =>
        c.board === board &&
        c.via === 'api' &&
        c.author !== 'coordinator' &&
        opName(c.by) &&
        (c.t || '') >= since &&
        c.kind !== 'notice-sent',
    );
    const cards = Object.values(store.cards).filter(c => c.board === board);
    const ex = (arr, n = 5) =>
      arr.slice(0, n).map(c => ({ id: c.id, t: c.t, text: String(c.text || '').slice(0, 140) }));
    const untagged = lines.filter(c => c.untagged),
      toolBoard = ((cfg.boards || {})[board] || {}).protocol === 'tools';
    // tool mode: chat words no tool carried, filed as notes that settle nothing (OPERATOR-BRIEF-TOOLS rule 8)
    const saidInChat = lines.filter(c => c.saidInChat);
    // chat words under "For you:", meant for him: not drift, counted apart so the watch can read them
    const forOwner = lines.filter(c => c.forOwner);
    // chat words in a turn he started by typing there: answers to him, not drift, counted apart
    const chatReplies = lines.filter(c => c.chatReply);
    // on a tool board the tools keep news off General (a General board_post is refused): what lands there is a REPLY, a
    // RELAYED or UNDELIVERED record or a chat note, never a line filed on general, so a tools operator is not held to
    // the line rule.
    // Not a line filed on general either: an answer the route delivered to General because Owner wrote there (replyTo),
    // a copy delivered there for the same reason, and a REPLY, which answers Owner where he wrote
    const general = toolBoard
      ? []
      : lines.filter(
          c =>
            !c.cardId &&
            !c.replyTo &&
            !c.copy &&
            !c.untagged &&
            c.kind !== 'notice' &&
            !['SHIFT', 'OPS', 'REPLY'].includes(c.label || ''),
        );
    // a timed line the collector could not label (a forgotten label): posted untagged and marked, so it is counted and
    // never lost
    const unlabelled = lines.filter(c => c.malformed);
    const misfiled = [];
    for (const c of cards)
      for (const e of c.log || [])
        if (e.misfiled && (e.t || '') >= since)
          misfiled.push({ id: c.id, t: e.t, text: String(e.text || '').slice(0, 140) });
    const slugTitled = cards
      .filter(
        c =>
          c.status !== 'done' &&
          c.openedByLine &&
          (c.provisionalTitle ||
            plainWords(c.title || '') ===
              plainWords(c.id.startsWith(board + '-') ? c.id.slice(board.length + 1) : c.id)),
      )
      .map(c => ({ id: c.id, t: c.updatedAt, text: c.title }));
    // five minutes' grace: a STATUS waiting and its ACTION in the same message land seconds apart
    const fiveMin = new Date(nowMs - 5 * 60000).toISOString();
    const waitingNoAsk = cards
      .filter(
        c => c.status === 'waiting' && !(c.decisions || []).some(d => !d.resolvedAt) && (c.updatedAt || '') < fiveMin,
      )
      .map(c => ({ id: c.id, t: c.updatedAt, text: c.title }));
    // busy is counted in work news only (STATUS, CONTEXT, FYI): asks, prompts and replies are a conversation about the
    // work, and a long one on one change does not make its card hold several jobs
    const workNews = e => WORK_KINDS.has(e.kind) && (e.t || '') >= since;
    const perCard = {};
    let total = 0;
    for (const c of cards.filter(card => !isStandingCard(card)))
      for (const e of c.log || [])
        if (workNews(e)) {
          perCard[c.id] = (perCard[c.id] || 0) + 1;
          total++;
        }
    // the firstmate-state card the brief requires is not a catch-all
    const busy = Object.entries(perCard).filter(
      ([id, n]) => total >= 12 && n * 3 > total && !/firstmate-state$/.test(id),
    );
    // a busy card is flagged when Jev reads more than one piece of work in its posts; while Jev has not read it yet
    // nothing is said (it answers within seconds, before the next report); with no Jev at all, or a failed reading, it
    // is flagged on volume alone, marked so
    const catchAll = [];
    for (const [id, n] of busy) {
      const c = store.cards[id];
      if (!c) continue;
      judgeSpread(c, (c.log || []).filter(workNews));
      const sp = cfg.jevEnabled === false ? null : c.spread,
        judgedNow = sp && !sp.error && (sp.upTo || '') >= since;
      if (judgedNow) {
        if (sp.many !== null && sp.many >= 0.6) catchAll.push({ id, n, text: c.title, many: sp.many });
      } else if (!judgeActive() || (sp && sp.error && !spreadPending.has(id)))
        catchAll.push({ id, n, text: c.title, judged: false });
    }
    function asksAfter(isFinished) {
      const findings = [];
      for (const card of cards) {
        if (/firstmate-state$/.test(card.id) || isStandingCard(card)) continue;
        let finished = null;
        for (const entry of card.log || []) {
          if (isFinished(entry)) finished = entry;
          else if (finished && ['ACTION', 'PROMPT'].includes(entry.kind) && (entry.t || '') >= since) {
            if (isDoneNotice(String(entry.text || ''))) continue;
            const said = String(finished.text || '').slice(0, 60);
            findings.push({
              id: card.id,
              t: entry.t,
              text: `${card.title}: ${String(entry.text || '').slice(0, 90)} (after «${said}»)`,
            });
            break;
          }
        }
      }
      return findings;
    }
    const afterDone = asksAfter(entry => entry.event === 'task_finished');
    const uncertainAfterDone = asksAfter(
      entry => WORK_KINDS.has(entry.kind) && LEGACY_FINISHED.test(String(entry.text || '')),
    ).filter(hint => !afterDone.some(finding => finding.id === hint.id));
    const tenMin = new Date(nowMs - 10 * 60000).toISOString(),
      recent = lines.filter(c => (c.t || '') >= tenMin).length,
      perTen = lines.length / Math.max(1, minutes / 10);
    const flood = recent >= 10 && recent > 3 * perTen;
    // the newest of the last message and the last line of any kind: an hour of STATUS lines makes no message, and must
    // not set off the silence alarm
    const lastLine =
      [
        lines.length
          ? lines
              .map(c => c.t)
              .sort()
              .pop()
          : null,
        (b.shift && b.shift.lastSeen) || null,
      ]
        .filter(Boolean)
        .sort()
        .pop() || null;
    const shiftPresence = presence(b, cfg.boards?.[board]?.protocol, nowMs).p;
    const shiftOn = active(b, cfg.boards?.[board]?.protocol, nowMs),
      silentMin = lastLine ? Math.round((nowMs - Date.parse(lastLine)) / 60000) : null;
    // four hours on shift with no line from the operator, unless the config says otherwise
    const silence = shiftOn && silentMin !== null && silentMin >= (cfg.silenceMinutes || 240);
    const ins = b.instruments || null,
      age = t => (t ? Math.round((nowMs - Date.parse(t)) / 60000) : null);
    // off shift the gate is meant to be down: no silence and no fail-open to report
    const gate =
      ins && ins.gate
        ? {
            mode: ins.gate.mode,
            heartbeatAgeMin: age(ins.gate.t),
            failOpenSince: ins.gate.failOpenSince,
            lastFail: ins.gate.lastFail || null,
            judged: ins.gate.judged,
            failed: ins.gate.failed,
            silent: shiftOn && ins.gate.mode !== 'off' && age(ins.gate.t) !== null && age(ins.gate.t) >= 20,
            failOpen: shiftOn && !!ins.gate.failOpenSince,
          }
        : null;
    const outbox = ins
      ? { telemetryAgeMin: age(ins.t), silent: shiftOn && age(ins.t) !== null && age(ins.t) >= 5 }
      : null;
    const compacted = ins && ins.compactedAt && ins.compactedAt >= since ? ins.compactedAt : null;
    const judged = lines.filter(c => c.judge && !c.judge.error),
      jerr = lines.filter(c => c.judge && c.judge.error).length;
    // lines Jev misreads as off their card: the ones that open a card, answer him, wrap up, or carry a prompt or
    // Owner's one-word go
    const opener = c =>
      ['TASK_CREATED', 'ACTION', 'REPLY', 'TASK_FINISHED', 'RELAYED', 'PROMPT'].includes(c.label || '') ||
      /^\s*\**(yes|no|done|correct|right|agreed)\b/i.test(c.text || '');
    const planning = judged.filter(c => c.judge.planning !== null && c.judge.planning >= 0.6),
      falseAsks = judged.filter(c => c.judge.asking !== null && c.judge.asking < 0.4),
      offTask = judged.filter(c => c.judge.on_task !== null && c.judge.on_task < 0.4 && !opener(c) && !c.copy);
    const boardNotes = (b.notes || []).filter(n => (n.t || '') >= since),
      notesByRule = {};
    for (const n of boardNotes) notesByRule[n.rule] = (notesByRule[n.rule] || 0) + 1;
    // a duplicate card counts in the hour Jev judged it, when it was opened: not again whenever it is posted to
    // and a card split off a catch-all is the split the catch-all rule asks for, not its duplicate: the card it matches
    // is a catch-all now, or a watch notice named it a catch-all in the day before this card was opened
    const catchNotices = Object.values(store.comments).filter(
      m =>
        m.board === board &&
        m.kind === 'notice' &&
        m.author !== 'coordinator' &&
        /catch-?all/i.test(String(m.text || '')),
    );
    const splitOff = c => {
      const parent = String(c.judge.sameAs),
        at = Date.parse(c.judge.t || c.createdAt || '');
      return (
        catchAll.some(x => x.id === parent) ||
        catchNotices.some(m => {
          const dt = at - Date.parse(m.t);
          return dt >= 0 && dt <= 86400000 && (String(m.text).includes(parent) || (m.refs || []).includes(parent));
        })
      );
    };
    const duplicates = cards
      .filter(
        c =>
          c.judge &&
          c.judge.sameAs &&
          (c.judge.confidence === null || c.judge.confidence >= 0.6) &&
          c.status !== 'done' &&
          (c.judge.t || '') >= since &&
          !/^watch-/.test(slugOf(board, c.id)) &&
          !/^watch-/.test(slugOf(board, String(c.judge.sameAs))) &&
          !splitOff(c),
      )
      .map(c => ({
        id: c.id,
        t: c.judge.t,
        text: `${c.title} ~ ${(store.cards[c.judge.sameAs] || {}).title || c.judge.sameAs}`,
      }));
    const notices = Object.values(store.comments).filter(
      c => c.board === board && c.kind === 'notice' && c.author !== 'coordinator',
    );
    const openNotices = notices
      .filter(n => !n.handled && !n.disputed)
      .map(n => ({ id: n.id, t: n.t, by: n.by, ageMin: age(n.t), text: String(n.text || '').slice(0, 140) }));
    return {
      board,
      minutes,
      lines: lines.length,
      shift: shiftOn ? 'on' : shiftPresence,
      operator: (b.shift && b.shift.operator) || null,
      lastLine,
      hints: {
        afterDone: {
          certainty: 'uncertain',
          count: uncertainAfterDone.length,
          examples: uncertainAfterDone.slice(0, 5),
        },
      },
      signals: {
        untagged: untagged.length,
        general: general.length,
        saidInChat: saidInChat.length,
        forOwner: forOwner.length,
        chatReplies: chatReplies.length,
        unlabelled: unlabelled.length,
        misfiled: misfiled.length,
        slugTitled: slugTitled.length,
        waitingNoAsk: waitingNoAsk.length,
        catchAll: catchAll.length,
        afterDone: afterDone.length,
        flood: flood ? recent : 0,
        silenceMin: silence ? silentMin : 0,
        compacted: compacted ? 1 : 0,
        gateSilent: gate && gate.silent ? 1 : 0,
        gateFailOpen: gate && gate.failOpen ? 1 : 0,
        outboxSilent: outbox && outbox.silent ? 1 : 0,
        planning: planning.length,
        falseAsks: falseAsks.length,
        offTask: offTask.length,
        duplicates: duplicates.length,
        openNotices: openNotices.length,
      },
      examples: {
        untagged: ex(untagged),
        general: ex(general),
        saidInChat: ex(saidInChat),
        forOwner: ex(forOwner),
        chatReplies: ex(chatReplies),
        unlabelled: ex(unlabelled),
        misfiled: misfiled.slice(0, 5),
        slugTitled: slugTitled.slice(0, 8),
        waitingNoAsk: waitingNoAsk.slice(0, 5),
        catchAll,
        afterDone: afterDone.slice(0, 5),
        planning: ex(planning),
        falseAsks: ex(falseAsks),
        offTask: ex(offTask),
        duplicates: duplicates.slice(0, 5),
      },
      crm:
        CRM && CRM.board === board
          ? (() => {
              const cards = Object.values(store.cards).filter(card => card.board === board && card.crm);
              return {
                open: cards.filter(card => questionState(card, store) !== 'done').length,
                failed: cards.filter(card => questionState(card, store) === 'failed').length,
                answered24h: cards.filter(
                  card =>
                    questionState(card, store) === 'done' &&
                    Date.parse(card.crm.deliveredAt || card.closedAt || '') >= nowMs - 86400000,
                ).length,
                pending: store.crm.outbox.length,
                lastPollAt: store.crm.lastPollAt || null,
                fault: store.crm.fault || null,
              };
            })()
          : null,
      // counts and ages only: the watch keeps an eye on the stewards
      steward: ctx.ST.health(board),
      stale: (() => {
        const st = staleCards(board, nowMs);
        return {
          count: st.length,
          lastReminder: b.staleNoteAt || null,
          examples: st
            .slice(0, 8)
            .map(x => ({ id: x.c.id, text: x.c.title, status: x.c.status, ageH: Math.round(x.ageH) })),
        };
      })(),
      boardNotes: {
        count: boardNotes.length,
        byRule: notesByRule,
        examples: boardNotes
          .slice(-6)
          .map(n => ({ id: n.id, t: n.t, rule: n.rule, text: String(n.text || '').slice(0, 160), line: n.line })),
      },
      instruments: { gate, outbox, compactedAt: compacted, telemetryAt: ins ? ins.t : null },
      jev: judgeActive()
        ? { judged: judged.length, errors: jerr }
        : {
            judged: 0,
            errors: 0,
            note: cfg.jevEnabled === false ? 'disabled by configuration' : 'no key on the board machine',
          },
      notices: { open: openNotices, total: notices.length },
    };
  }

  return { conductOf };
};
