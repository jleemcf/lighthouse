'use strict';
const lifecycle = require('./card-transitions');
const prompts = require('./prompt-transitions');
const shifts = require('./shift');
const { isOwnerName } = require('./configuration');
const { questionState } = require('./crm-state');
// One operator line applied to the board, the label grammar executed: cards opened, moved, retitled and closed,
// asks opened and settled, the shift, notices and Ops, and the board's notes when a line is wrong.
module.exports = function makeEvents(ctx) {
  const { cfg } = ctx;
  const { store, now, newId, change, notify, pushLog, pushActivity, slugOf, canNotice, CRM, crmSend, judgeCard } = ctx;
  const { batch, boardNote, note, noteOnce, copyAllowed, copyWanted } = ctx;
  const { answerAsks, deliverReply, actionComment, promptComment, generalLine } = ctx;
  const { LABELS, STATES, LABEL_LIST, lineOf, nearestSlugs, firstClause, TITLE_OK, SHIFT_WORD, SHIFT_OFF } = ctx;
  const { ASK_SHAPE, SETTLE_WORDS, DELEGATED, NEEDS_NOTHING, NOT_ASK, etClock, ownerAnsweredAt, NOTICE_ACK } = ctx;
  const { plainWords, attsOf, withBody, targetsOf } = ctx;
  // One line from an operator, applied to the board: the label grammar.
  function applyEvent(board, row, by, principal) {
    const label = String(row.label || '').toUpperCase();
    const b = store.boards[board];
    if (!b) return { ok: false, reason: 'unknown board' };
    const t = row.t || now();
    // a message of only "(quiet)" is for the harness, never the board: dropped here too, so a collector that predates
    // its own filter cannot post one
    if (row.untagged && /^\s*\(quiet\)[\s.]*$/i.test(String(row.text || '')) && !row.body)
      return { ok: true, quiet: true };
    if (!LABELS.has(label)) {
      note(
        board,
        by,
        'label',
        `«${row.label}» is not a label the board knows, so this line was not filed. The labels are ${LABEL_LIST}.`,
        lineOf(row),
        t,
      );
      return { ok: false, reason: 'unknown label ' + row.label };
    }
    if (row.title && !TITLE_OK.test(String(row.title))) {
      // a title with characters the line cannot carry (an apostrophe, brackets, commas): cleaned, and said
      const bad = [
        ...new Set(
          String(row.title)
            .replace(/[A-Za-z0-9._-]/g, '')
            .split(''),
        ),
      ].join(' ');
      row = Object.assign({}, row, {
        title:
          String(row.title)
            .replace(/[^A-Za-z0-9._-]+/g, '_')
            .replace(/_+/g, '_')
            .replace(/^_+|_+$/g, '') || 'untitled',
      });
      note(
        board,
        by,
        'title',
        `The title had characters the line does not allow (${bad}), so it was filed as «${plainWords(
          row.title,
        )}». A title is words joined by underscores: letters, digits, dots and hyphens only.`,
        lineOf(row),
        t,
      );
    }
    if (label === 'SHIFT') {
      if (!SHIFT_WORD.test(row.text || '')) {
        // SHIFT used for an answer: the shift is not touched, the line is filed as FYI, and the operator is told
        note(
          board,
          by,
          'shift',
          `SHIFT is only for a shift's start and end, and this line read as neither, so it was filed as FYI${
            row.task && row.task !== 'general' ? ' on ' + row.task : ' on General'
          }. Answer Owner with REPLY; report with STATUS or FYI.`,
          lineOf(row),
          t,
        );
        return applyEvent(board, Object.assign({}, row, { label: 'FYI' }), by, principal);
      }
      // read from the first sentence: "shift started. Firstmate was closed at the end of..." is a start
      const st = SHIFT_OFF.test(String(row.text || '').split(/[.!?]/)[0]) ? 'off' : 'on';
      shifts.transition(ctx, board, st === 'on' ? 'start' : 'end', by, t);
      return { ok: true };
    }
    const task = String(row.task || 'general');
    if (task !== 'general' && !STATES.has(row.state) && label !== 'OPS' && label !== 'NOTICE') {
      // state= after the colon, at the end of the text, is read there this once and the operator is told
      const tail = /(?:^|\s)state=(queued|inflight|waiting|held|done)\b[.!]?\s*$/i.exec(String(row.text || ''));
      if (tail) {
        row = Object.assign({}, row, {
          state: tail[1].toLowerCase(),
          text: String(row.text)
            .replace(/\s*state=\w+[.!]?\s*$/i, '')
            .trim(),
        });
        note(
          board,
          by,
          'state-place',
          `state=${tail[1].toLowerCase()} was at the end of the text, so the board read it there this once. state= ` +
            `belongs in the header, before the colon: ⏱ time · LABEL · task state=${tail[1].toLowerCase()}: text.`,
          lineOf(row),
          t,
        );
      } else if (/\bstate=(queued|inflight|waiting|held|done)\b/i.test(String(row.text || '')))
        note(
          board,
          by,
          'state-place',
          "The text mentions state=, but the board reads state= only in the header, before the colon, so the card's " +
            'lane did not change. Put it there: ⏱ time · LABEL · task state=<lane>: text.',
          lineOf(row),
          t,
        );
    }
    // the structured detail beneath the line
    const body = row.body ? String(row.body).slice(0, 8000) : '';
    if (label === 'NOTICE') {
      // the watch operator's correction to another operator: the line names the board, the text is the correction; the
      // other operator's route prints it and answers with OPS
      const target = task.split('/')[0];
      if (!store.boards[target]) return { ok: false, reason: 'NOTICE names no known board: ' + target };
      if (!canNotice(principal, board, target)) return { ok: false, reason: by + ' is not the watch on ' + target };
      const text = String(row.text || '').trim();
      if (!text) return { ok: false, reason: 'an empty NOTICE' };
      const rid = newId();
      store.comments[rid] = {
        id: rid,
        board: target,
        cardId: null,
        cardTitle: null,
        t,
        text: withBody(row),
        by,
        via: 'api',
        kind: 'notice',
        handled: false,
        replyTo: null,
        attachments: [],
        label: 'NOTICE',
        fromBoard: board,
      };
      {
        // the operator acknowledged within three minutes before the notice landed: the two crossed, and the notice is
        // answered; only an acknowledgement that settled nothing yet counts
        const tb = store.boards[target],
          nt = Date.parse(t),
          ack = (tb.ops || [])
            .slice()
            .reverse()
            .find(o => {
              const ot = Date.parse(o.t);
              return (
                !o.acked && isFinite(ot) && ot <= nt + 60000 && nt - ot <= 3 * 60000 && NOTICE_ACK.test(o.text || '')
              );
            });
        if (ack) {
          const n = store.comments[rid];
          n.handled = true;
          n.handledAt = ack.t;
          n.handledBy = ack.by;
          ack.acked = true;
        }
      }
      pushActivity(store.boards[target], `notice from ${by}: ${text}`, t);
      change('comment', rid, by, target);
      // the same words on the watch's own board, where Owner reads it
      const mine = newId();
      store.comments[mine] = {
        id: mine,
        board,
        cardId: null,
        cardTitle: null,
        t,
        text: 'To ' + target + ': ' + withBody(row),
        by,
        via: 'api',
        kind: 'notice-sent',
        handled: true,
        replyTo: null,
        attachments: [],
        label: 'NOTICE',
        about: target,
      };
      pushActivity(b, `NOTICE to ${target}: ${text}`, t);
      change('comment', mine, by, board);
      notify(target, {
        kind: 'notice',
        title: 'Watch notice for ' + ((store.boards[target] || {}).name || target),
        body: by + ': ' + text.slice(0, 180),
        url: '/#board=' + target,
        tag: 'notice-' + target,
      });
      shifts.touch(b, t);
      return { ok: true, notice: rid };
    }
    if (label === 'OPS') {
      // the operator's housekeeping about itself ("my watcher stopped, restarting"): a small log of its own, never
      // General, never the board's latest line
      // an OPS line that acknowledges answers the watch's notices, not Owner; "watch restarted" does not
      const ackd =
        NOTICE_ACK.test(row.text || '') &&
        Object.values(store.comments).some(
          n => n.board === board && n.kind === 'notice' && n.author !== 'coordinator' && !n.handled,
        );
      if (ackd)
        for (const n of Object.values(store.comments))
          if (n.board === board && n.kind === 'notice' && n.author !== 'coordinator' && !n.handled) {
            n.handled = true;
            n.handledAt = t;
            n.handledBy = by;
          }
      if (ASK_SHAPE.test(row.text || '') && !NOT_ASK.test(row.text || ''))
        note(
          board,
          by,
          'ops-ask',
          'This OPS line reads like an ask, and Owner does not read Ops for decisions. ' +
            'Put what he must decide in an ACTION on its task, with state=waiting.',
          lineOf(row),
          t,
        );
      // acked: it settled a notice, so it cannot settle a later one
      b.ops = (b.ops || []).concat([
        Object.assign(
          {
            t,
            text: String(row.text || '').slice(0, 2000) + (body ? '\n\n' + body : ''),
            by,
            task: task !== 'general' ? task : null,
          },
          ackd ? { acked: true } : {},
        ),
      ]);
      // the last OPS_KEEP lines are kept
      if (b.ops.length > ctx.OPS_KEEP) b.ops = b.ops.slice(-ctx.OPS_KEEP);
      {
        // a message of Owner's still waiting there
        const unanswered = tg =>
          Object.values(store.comments).some(
            x =>
              x.board === board &&
              (x.cardId || null) === tg &&
              !x.handled &&
              x.via !== 'api' &&
              x.author !== 'coordinator',
          );
        // it answered a message Owner wrote and left unanswered: Ops is the box he does not read, so the answer goes to
        // him as a REPLY this once, and the operator is told; a notice acknowledgement is not that
        const tgs = ackd
          ? []
          : targetsOf(row)
              .map(tg => (tg === 'general' ? null : tg.startsWith(board + '-') ? tg : board + '-' + tg))
              .filter(tg => (tg === null || store.cards[tg]) && unanswered(tg));
        if (tgs.length) {
          for (const tg of tgs)
            if (copyAllowed(board, tg, null))
              deliverReply(board, tg, Object.assign({}, row, { label: 'REPLY' }), by, t);
          note(
            board,
            by,
            'ops-answer',
            'This OPS line answered a message Owner wrote, but Ops is the instruments box, which he does not read. ' +
              'The board delivered it to him as a REPLY this once. ' +
              'Answer him with REPLY, naming the task it concerns, or general.',
            lineOf(row),
            t,
          );
        }
      }
      // still a sign of life
      shifts.touch(b, t);
      change('board', board, by, board);
      return { ok: true };
    }
    if (task === 'general') {
      if (row.malformed)
        note(
          board,
          by,
          'malformed',
          `A timed line could not be read${row.reason ? ' (' + row.reason + ')' : ''}, so it was filed on General ` +
            `as untagged and marked. The line is: ⏱ h:mm AM/PM ${cfg.timeZoneLabel || cfg.timeZone || 'UTC'} ` +
            `· LABEL · task: text, with a label from ` +
            `${LABEL_LIST}.`,
          String(row.text || '').slice(0, 140),
          t,
        );
      else if (row.untagged)
        noteOnce(
          board,
          by,
          'untagged',
          'Your last message carried no timed line, so it was filed on General as untagged, ' +
            'where Owner may not see it. ' +
            `Every message ends with a line: ⏱ h:mm AM/PM ${cfg.timeZoneLabel || cfg.timeZone || 'UTC'} ` +
            '· LABEL · task: text. ' +
            'Plan in your thinking, not in the message.',
          String(row.text || '').slice(0, 140),
          t,
          10,
        );
      pushActivity(b, `${label} ${by}: ${row.text || ''}`, t);
      if (label === 'PROMPT') promptComment(board, null, null, row, by, t);
      else generalLine(board, row, by, t);
      // a general line answers a general part itself; only when no general part was asked does it go to the tasks asked
      {
        const tgs = targetsOf(row);
        if (!tgs.includes('general'))
          for (const tg of tgs) {
            const tc = tg.startsWith(board + '-') ? tg : board + '-' + tg;
            if (copyWanted(board, tc)) deliverReply(board, tc, row, by, t);
          }
      }
      // a general line is presence too
      shifts.touch(b, t);
      change('board', board, by, board);
      return { ok: true };
    }
    const cid = task.startsWith(board + '-') ? task : board + '-' + task;
    // a TASK_CREATED naming a card that already exists is a task inside a task
    const existed = !!store.cards[cid];
    let card = store.cards[cid];
    if (label === 'RELAYED' && card) {
      const result = prompts.lineRelay(store, card, by, t, DELEGATED.test(row.text || ''));
      if (!result.ok) return result;
    }
    // the asks already open before this line
    const askedBefore = new Set(((card && card.decisions) || []).filter(d => !d.resolvedAt).map(d => d.id));
    const staffMsg =
      card?.crm && Object.values(store.comments).find(message => message.cardId === cid && message.kind === 'staff');
    const staffWasUnhandled = staffMsg && !staffMsg.handled;
    if (!card) {
      // A line naming a task nobody opened is not refused, since a refusal reaches only the collector's hidden log and
      // the line would be lost. Nothing the operator says to Owner may be lost, so the line opens the task now, named
      // from its slug, and the activity says so; the operator can retitle it with title= on any later line.
      const opened = label !== 'TASK_CREATED';
      card = lifecycle.open({
        id: cid,
        board,
        title: row.title
          ? plainWords(row.title)
          : opened
            ? firstClause(row.text) || plainWords(task)
            : row.text || plainWords(task),
        status: STATES.has(row.state) ? row.state : 'queued',
        source: `operator:${by}`,
        decisions: [],
        log: [],
        updatedAt: t,
        updatedBy: by,
      }).card;
      store.cards[cid] = card;
      if (opened) {
        card.openedByLine = label;
        if (!row.title && firstClause(row.text)) card.provisionalTitle = true;
        pushActivity(b, `${by}: opened ${plainWords(task)} with a ${label} line (no TASK_CREATED first)`, t);
        const near = nearestSlugs(board, slugOf(board, cid));
        note(
          board,
          by,
          'opened',
          `No task «${slugOf(board, cid)}» existed, so this ${label} opened ` +
            `one${
              card.provisionalTitle ? ', titled for now from the line («' + card.title + '»)' : ' titled from the slug'
            }. ` +
            `If you meant an existing task, name its slug` +
            `${near.length ? ' (nearest: ' + near.join(', ') + ')' : ''}; ` +
            `otherwise open tasks with TASK_CREATED first, ` +
            `or give this one a title with title=Plain_words on a STATUS.`,
          lineOf(row),
          t,
          slugOf(board, cid),
        );
      }
    }
    if (label === 'TASK_CREATED' && existed)
      note(
        board,
        by,
        'exists',
        `«${slugOf(board, cid)}» already exists, and TASK_CREATED opens new tasks only, so this line was filed as ` +
          `a note on the existing card. Use STATUS, FYI, ACTION or REPLY on it.`,
        lineOf(row),
        t,
        slugOf(board, cid),
      );
    if (label === 'TASK_CREATED') {
      for (const k of ['severity', 'complexity', 'nature']) if (row[k]) card[k] = row[k];
      if (row.title) {
        card.title = plainWords(row.title);
        card.provisionalTitle = false;
      }
      if (row.text) card.context = withBody(row);
      if (!existed) setImmediate(() => judgeCard(cid));
    }
    if (label === 'STATUS') {
      if (row.text) card.description = row.text;
      card.detail = body;
      if (row.title) {
        card.title = plainWords(row.title);
        card.provisionalTitle = false;
      }
    }
    // CONTEXT: the full plain-language description of the task, rewritten only when the fundamental understanding
    // changes; STATUS is the current state and changes as often as it does.
    if (label === 'CONTEXT') {
      if (row.text) card.context = withBody(row);
      if (row.title) {
        card.title = plainWords(row.title);
        card.provisionalTitle = false;
      }
    }
    // title= renames on any line about the card, a TASK_FINISHED included
    if (row.title && label !== 'TASK_CREATED' && label !== 'STATUS' && label !== 'CONTEXT') {
      card.title = plainWords(row.title);
      card.provisionalTitle = false;
    }
    if (label === 'ACTION') {
      if (!STATES.has(row.state)) lifecycle.move(card, 'waiting');
      card.decisions = (card.decisions || []).filter(d => !d.resolvedAt);
      const did = row.decision || newId();
      if (!card.decisions.some(d => d.id === did))
        lifecycle.ask(
          card,
          {
            id: did,
            ask: row.text || 'See the ACTION entry.',
            openedAt: t,
            resolvedAt: null,
            by,
            kind: 'action',
            urgent: String(row.urgent || '').toLowerCase() === 'no' ? false : undefined,
            reversible: ['yes', 'no', 'partly'].includes(String(row.reversible || '').toLowerCase())
              ? String(row.reversible).toLowerCase()
              : undefined,
            recommendation: row.rec ? String(row.rec).slice(0, 200) : undefined,
          },
          STATES.has(row.state) && row.state !== 'done' ? row.state : 'waiting',
        );
    }
    if (label === 'REPLY') {
      // a REPLY settles the asks Owner has answered since they opened (his message on the card, his Send), the ones the
      // board made from the operator's own words, the one it names (decision=), or every one when it says withdrawn; an
      // ask he has not answered stays open, since red means he owes an answer, and a REPLY to a different question must
      // not swap his pending decision out
      // ...except a REPLY that says state=waiting: it answered his question and the decision is still his, so his asks
      // stay open and the card stays in Waiting
      const answered = ownerAnsweredAt(cid),
        withdraws = SETTLE_WORDS.test(row.text || ''),
        still = row.state === 'waiting' && !withdraws;
      for (const d of card.decisions || [])
        if (
          !d.resolvedAt &&
          (row.decision
            ? d.id === row.decision
            : withdraws || (!still && (d.kind === 'waiting' || (answered && answered >= (d.openedAt || '')))))
        ) {
          prompts.settle(store, card, [d], { resolvedAt: t, resolvedBy: by });
        }
      // the older needsAction flag clears with the last ask
      if (!lifecycle.openAsks(card).length)
        prompts.settle(store, card, [], { resolvedAt: t, resolvedBy: by }, { clearLegacy: true });
    }
    if (label === 'RELAYED') {
      // Owner's word went out: every ask on the card is settled, so the card's alarm goes off
      // ...unless the operator sent its own prompt under his standing authority: then the prompt's ask closes, and the
      // asks he has not answered stay his
      const delegated = DELEGATED.test(row.text || ''),
        answered = ownerAnsweredAt(cid);
      for (const d of card.decisions || [])
        if (
          !d.resolvedAt &&
          (!delegated || d.kind === 'prompt' || d.kind === 'waiting' || (answered && answered >= (d.openedAt || '')))
        ) {
          prompts.settle(store, card, [d], {
            resolvedAt: t,
            resolvedBy: by,
            ...(delegated ? { delegated: true } : {}),
          });
        }
      if (!lifecycle.openAsks(card).length)
        prompts.settle(store, card, [], { resolvedAt: t, resolvedBy: by }, { clearLegacy: true });
    }
    if (label === 'TASK_FINISHED') {
      row.state = 'done';
      prompts.settle(store, card, lifecycle.openAsks(card), { resolvedAt: t, resolvedBy: by }, { clearLegacy: true });
    }
    // the ask the board itself opened for a bare Waiting closes when the card leaves Waiting
    if (STATES.has(row.state) && row.state !== 'waiting')
      for (const d of card.decisions || [])
        if (!d.resolvedAt && d.kind === 'waiting') {
          prompts.settle(store, card, [d], { resolvedAt: t, resolvedBy: by });
        }
    let completion;
    if (row.state === 'done') {
      if (!(staffMsg && label === 'REPLY' && !isOwnerName(cfg, by))) {
        const closed = prompts.close(store, card, t);
        completion = closed.completion;
        if (!closed.ok && lifecycle.crmCloseReason(card)) {
          const pending = store.crm.outbox.find(item => item.kind === 'reply' && item.id === card.crm.deliveryId);
          if (pending && pending.body.kind !== 'needs_owner') pending.closeOnDelivery = true;
          note(board, by, 'crm-close', closed.reason, lineOf(row), t);
        }
      }
    } else if (STATES.has(row.state)) lifecycle.move(card, row.state);
    // the line settled the card's last ask and named no lane: Owner's move is over, so the card is In flight; state=
    // in the header still wins
    else if (
      card.status === 'waiting' &&
      askedBefore.size &&
      !(card.decisions || []).some(d => !d.resolvedAt) &&
      label !== 'ACTION' &&
      label !== 'PROMPT'
    )
      lifecycle.move(card, 'inflight');
    // an operator manages its task and is trusted to close it: housekeeping is not an ask for Owner
    if (
      label !== 'TASK_FINISHED' &&
      row.state !== 'done' &&
      new RegExp(
        String.raw`\b(can be closed|could be closed|ready to (?:be )?close|should (?:i|we) close|` +
          String.raw`(?:ok|okay) to close|safe to close|can close (?:it|this)|recommend closing|propose closing)\b`,
        'i',
      ).test(row.text || '')
    )
      note(
        board,
        by,
        'close-it',
        `«${slugOf(board, cid)}»: if it is over, close it yourself with TASK_FINISHED. You manage this task, and ` +
          `housekeeping is not an ask for Owner (ruling 57).`,
        lineOf(row),
        t,
        slugOf(board, cid),
      );
    {
      // "nothing needed" on a STATUS or FYI closes nothing: the operator is told the words that do
      const open0 = (card.decisions || []).find(d => !d.resolvedAt);
      if (
        open0 &&
        (label === 'STATUS' || label === 'FYI') &&
        NEEDS_NOTHING.test(row.text || '') &&
        !(STATES.has(row.state) && row.state !== 'waiting')
      )
        note(
          board,
          by,
          'stale-ask',
          `«${slugOf(board, cid)}» still has an open ask for Owner (“${String(open0.ask || '').slice(0, 90)}”). If ` +
            `he has acted elsewhere or nothing is needed any more, say so with a REPLY on this card ("settled", ` +
            `"withdrawn", "no longer needed"); a STATUS or FYI closes nothing.`,
          lineOf(row),
          t,
          slugOf(board, cid),
        );
    }
    {
      // a stated ask survives a STATUS or FYI: the red stays, and the operator is told why; a finished task cannot owe
      // Owner an answer
      const open = (card.decisions || []).find(d => !d.resolvedAt);
      if ((open || card.needsAction) && row.state === 'done')
        note(
          board,
          by,
          'done-open',
          `«${slugOf(board, cid)}» was not marked done because an ask for Owner is still open ` +
            `(“${String((open && open.ask) || card.ask || '').slice(0, 90)}”). ` +
            `Settle or withdraw the ask with a REPLY, then finish the task.`,
          lineOf(row),
          t,
          slugOf(board, cid),
        );
      else if (
        open &&
        STATES.has(row.state) &&
        row.state !== 'waiting' &&
        (label === 'STATUS' || label === 'FYI' || label === 'CONTEXT')
      )
        note(
          board,
          by,
          'red',
          `«${slugOf(board, cid)}» still has an open ask for Owner (“${String(open.ask || '').slice(0, 90)}”), ` +
            `which this ${label} does not clear, so the card stays red. If the line is about other work, nothing is ` +
            `wrong: the ask waits. If you meant it settled, say so with a REPLY (state= on that REPLY moves the ` +
            `card), or finish the task with TASK_FINISHED.`,
          lineOf(row),
          t,
          slugOf(board, cid),
        );
    }
    // Waiting is Owner's move, and his move needs stating: a line that puts a card in Waiting without an open decision
    // opens one from its own words, so the card turns red and shows on Home.
    if (
      row.state === 'waiting' &&
      label !== 'ACTION' &&
      label !== 'PROMPT' &&
      !(card.decisions || []).some(d => !d.resolvedAt)
    ) {
      const answered = ownerAnsweredAt(cid),
        lastAsk =
          (card.decisions || [])
            .map(d => d.openedAt || '')
            .sort()
            .pop() || '';
      if (label !== 'REPLY' && answered && answered >= lastAsk && Date.parse(t) - Date.parse(answered) < 15 * 60000) {
        // Owner has answered since anything was asked, within the last quarter hour: his move is over, and no ask is
        // made from the operator's words, so a go he already gave is not shown to him again. (A plan put to him a day
        // after his last word is a new ask, not a stale label.)
        const text =
          `Owner answered on «${slugOf(board, cid)}» at ${etClock(answered)}, so it is not his move: filed as In ` +
          `flight, not Waiting. Say state=held if it waits on someone else; send an ACTION if he must decide ` +
          `something new.`;
        // decided at the end of the batch: a PROMPT or ACTION in the same message is a new ask
        if (batch.notes)
          batch.notes.push({ board, by, rule: 'mislabel', text, line: lineOf(row), t, slug: slugOf(board, cid), cid });
        else {
          lifecycle.move(card, 'inflight');
          boardNote(board, by, 'mislabel', text, lineOf(row), t, slugOf(board, cid));
        }
      } else {
        // a REPLY saying state=waiting with nothing open asks it from its own words, quietly: it answers him, so he is
        // already there
        lifecycle.ask(
          card,
          Object.assign(
            {
              id: newId(),
              ask: row.text || 'The operator put this in Waiting; it is your move.',
              openedAt: t,
              resolvedAt: null,
              resolvedBy: null,
              kind: 'waiting',
            },
            label === 'REPLY' ? { quiet: true } : {},
          ),
        );
        // said to no one: only so a real ask in the same message replaces this one
        if (label === 'REPLY') {
          if (batch.notes) batch.notes.push({ board, by, rule: 'waiting', t, cid, silent: true });
        } else
          note(
            board,
            by,
            'waiting',
            `«${slugOf(board, cid)}» went to Waiting without an ACTION, so an ask was opened from this line's ` +
              `words. Waiting is Owner's move: if he must decide something else, send an ACTION saying what.`,
            lineOf(row),
            t,
            slugOf(board, cid),
            cid,
          );
      }
    }
    // every line about the card is its history, STATUS included
    pushLog(
      card,
      Object.assign(
        {
          t,
          kind: label === 'TASK_CREATED' || label === 'TASK_FINISHED' ? 'FYI' : label,
          who: by,
          text: row.text || label.toLowerCase(),
        },
        body ? { body } : {},
        attsOf(row.attachments).length ? { attachments: attsOf(row.attachments) } : {},
        label === 'TASK_CREATED' && existed ? { misfiled: true } : {},
        completion && label !== 'PROMPT' ? completion : {},
      ),
    );
    card.updatedAt = t;
    card.updatedBy = by;
    shifts.touch(b, t);
    if (label === 'PROMPT') {
      prompts.settle(
        store,
        card,
        lifecycle.openAsks(card).filter(ask => ask.kind === 'prompt'),
        { resolvedAt: t, resolvedBy: by, replacedBy: true },
      );
      // the suggested prompt waits on Owner like an ACTION: the card turns red until he chooses
      const rid = promptComment(board, cid, card, row, by, t),
        to = store.comments[rid].prompt.to;
      card.decisions = (card.decisions || []).filter(d => !d.resolvedAt);
      lifecycle.ask(
        card,
        {
          id: newId(),
          ask: 'Send the suggested prompt to ' + (to ? 'the ' + to : 'its target') + ', or answer another way.',
          openedAt: t,
          resolvedAt: null,
          resolvedBy: null,
          kind: 'prompt',
          commentId: rid,
        },
        STATES.has(row.state) && row.state !== 'done' ? row.state : 'waiting',
      );
    }
    // both are messages in the conversation: what went out, and what to expect next
    else if (label === 'ACTION' || label === 'RELAYED') actionComment(board, cid, card, row, by, t, label);
    // a REPLY is addressed to Owner: it is a conversation message even when a copied line from the same turn already
    // settled his message
    else if (label === 'REPLY') {
      if (!answerAsks(board, cid, card, row, by, t)) actionComment(board, cid, card, row, by, t, 'REPLY');
    }
    // a picture is for Owner to see: the line carrying one is a conversation message even when it answers nothing
    else if (!answerAsks(board, cid, card, row, by, t) && attsOf(row.attachments).length)
      actionComment(board, cid, card, row, by, t, label);
    {
      const tgs = targetsOf(row),
        own = tgs.some(tg => (tg.startsWith(board + '-') ? tg : board + '-' + tg) === cid);
      if (!own)
        for (const tg of tgs) {
          // a line naming one of the tasks asked answers that task alone; otherwise it goes where he wrote (copies of
          // one answer are capped, so a long answer does not flood General)
          const tc = tg === 'general' ? null : tg.startsWith(board + '-') ? tg : board + '-' + tg;
          if (tc === cid) continue;
          if (copyWanted(board, tc) && copyAllowed(board, tc, cid)) deliverReply(board, tc, row, by, t);
        }
    }
    if (card.crm && !isOwnerName(cfg, by)) {
      // the CRM question lane
      const q = card.crm;
      const state = questionState(card, store);
      if (label === 'REPLY' && staffMsg && ['asked', 'working', 'sending', 'done', 'failed'].includes(state)) {
        // every REPLY on the card goes to the CRM: the first answers the question, a later one is a follow-up (the
        // contract), whenever it lands
        // the kinds the CRM accepts; a correction goes as an answer, a follow-up
        const kind = ['answer', 'declined', 'needs_owner'].includes(String(row.kind || '').toLowerCase())
          ? String(row.kind).toLowerCase()
          : 'answer';
        const atts = attsOf(row.attachments);
        crmSend(
          'reply',
          q.id,
          cid,
          { text: withBody(row), answeredAt: t, by, kind },
          { closeOnDelivery: !STATES.has(row.state) || row.state === 'done' },
        );
        if (atts.length) {
          if (CRM.files) store.crm.outbox[store.crm.outbox.length - 1].attachment = atts[0].id;
          else
            note(
              board,
              by,
              'crm-file',
              `The CRM does not take a file on an answer yet (phase 2), so «${atts[0].name}» stayed on the card ` +
                `and the answer went without it. Put the counts or the facts in the text for now.`,
              lineOf(row),
              t,
            );
        }
      } else if (label === 'ACTION' && staffWasUnhandled && ['asked', 'working'].includes(state)) {
        // a change request: Owner decides, the asker is told
        staffMsg.handled = true;
        staffMsg.handledAt = t;
        staffMsg.handledBy = by;
        crmSend('reply', q.id, cid, {
          text:
            'This needs a decision from Owner before anything changes; the operator has put it to him. ' +
            String(row.text || '').slice(0, 1500),
          answeredAt: t,
          by,
          kind: 'needs_owner',
        });
      } else if (staffMsg && state === 'asked') {
        q.working = t;
        q.state = 'working';
        crmSend('ack', q.id, cid, { state: 'working', note: 'the operator is looking into it' });
      }
    }
    // a new ask on this card: one push per device, the card's own tag so a second ask replaces the first on screen
    if (!isOwnerName(cfg, by)) {
      const fresh = (card.decisions || []).filter(d => !d.resolvedAt && !d.quiet && !askedBefore.has(d.id));
      if (fresh.length && !ctx.ST.holdPing(board, card, fresh))
        notify(board, {
          kind: 'ask',
          title: 'Needs you: ' + (b.name || board),
          body: (card.title + ': ' + fresh[fresh.length - 1].ask).slice(0, 200),
          url: '/#card=' + cid,
          tag: cid,
        });
    }
    change('card', cid, by, board);
    return { ok: true, card: cid };
  }

  return { applyEvent };
};
