'use strict';
const lifecycle = require('./card-transitions');
const prompts = require('./prompt-transitions');
// The board talks back: a refusal or a correction of an operator's line becomes a board note, kept on the board
// (Owner sees it in the Ops box, the watch counts it in the conduct report) and printed into the operator's chat by
// its board watch as "BOARD | ...", so the operator puts it right in its next turn instead of hours later on a notice
// from the watch. Also here: the copies of an answer delivered where Owner wrote.
module.exports = function makeNotes(ctx) {
  const { store, now, newId, change, slugOf } = ctx;
  // made in replies.js, which is made after this module
  const deliverReply = (...a) => ctx.deliverReply(...a);
  const NOTES_KEEP = 200;
  // set by the events route while it applies one batch of lines: notes, the notes of the batch, grouped before
  // they are written; copies, { 'board|conversation': { n, slugs, by, t } }
  const batch = { notes: null, copies: null };
  // board|rule|slug -> ms: the same thing about the same card is said once per ten minutes
  const saidAbout = {};
  function boardNote(board, by, rule, text, line, t, slug) {
    const b = store.boards[board];
    if (!b) return null;
    if (slug) {
      const k = board + '|' + rule + '|' + slug,
        ms = Date.now();
      if (saidAbout[k] && ms - saidAbout[k] < 10 * 60000) return null;
      saidAbout[k] = ms;
    }
    const id = newId(),
      n = {
        id,
        t: t || now(),
        rule,
        text: String(text).slice(0, 1200),
        line: line ? String(line).slice(0, 200) : null,
        to: by,
      };
    b.notes = (b.notes || []).concat([n]);
    if (b.notes.length > NOTES_KEEP) b.notes = b.notes.slice(-NOTES_KEEP);
    change('note', id, 'board', board);
    return id;
  }
  function note(board, by, rule, text, line, t, slug, cid) {
    if (batch.notes) batch.notes.push({ board, by, rule, text, line, t, slug, cid });
    else boardNote(board, by, rule, text, line, t, slug);
  }
  const lastNoteAt = {};
  function noteOnce(board, by, rule, text, line, t, minutes) {
    // a note that must not flood (untagged prose after a compaction comes in bursts)
    const k = board + '|' + rule,
      ms = Date.now();
    if (lastNoteAt[k] && ms - lastNoteAt[k] < minutes * 60000) return;
    lastNoteAt[k] = ms;
    note(board, by, rule, text, line, t);
  }
  // One answer of many lines is copied to where Owner wrote at most five times; the rest become one line naming their
  // tasks.
  function copyAllowed(board, cardId, fromCid) {
    if (!batch.copies) return true;
    const k = board + '|' + (cardId || 'general'),
      e = batch.copies[k] || (batch.copies[k] = { n: 0, slugs: [] });
    e.n++;
    if (e.n <= 5) return true;
    e.slugs.push(slugOf(board, fromCid));
    return false;
  }
  // A copy goes where Owner wrote only while a message of his waits there unanswered, or when an earlier line of the
  // same batch already answered it there: a stale "re" from a later turn copies nothing, so lines on other cards do not
  // keep showing under his card until he writes again.
  function copyWanted(board, cardId) {
    if (batch.copies && batch.copies[board + '|' + (cardId || 'general')]) return true;
    return Object.values(store.comments).some(
      x =>
        x.board === board &&
        (x.cardId || null) === (cardId || null) &&
        !x.handled &&
        (x.via !== 'api' || x.author === 'coordinator'),
    );
  }
  function flushCopies(buf, by, t) {
    if (!buf) return;
    for (const [k, e] of Object.entries(buf))
      if (e.slugs.length) {
        const [board, conv] = k.split('|');
        deliverReply(
          board,
          conv === 'general' ? null : conv,
          {
            label: 'FYI',
            text: `...and ${
              e.slugs.length
            } more lines of this answer, each on its own task: ${[...new Set(e.slugs)].join(', ')}.`,
          },
          by,
          t,
        );
      }
  }
  function flushNotes(buf) {
    // one batch: the same rule on several lines is one note naming them all, and a batch never says more than six
    // things
    if (!buf || !buf.length) return;
    // a Waiting note waits for the end of the batch: a REPLY state=waiting followed by the PROMPT or ACTION it
    // announces is one message, and the real ask replaces the one the board opened from the words
    buf = buf.filter(n => {
      if ((n.rule !== 'waiting' && n.rule !== 'mislabel') || !n.cid) return true;
      const card = store.cards[n.cid];
      if (!card) return true;
      const real = (card.decisions || []).some(d => !d.resolvedAt && d.kind !== 'waiting');
      if (n.rule === 'mislabel') {
        if (real) return false;
        // no real ask came with it: his move is over, the card is In flight, and the note is said
        if (card.status === 'waiting') {
          lifecycle.move(card, 'inflight');
          change('card', n.cid, 'board', n.board);
        }
        return true;
      }
      if (!real) return !n.silent;
      let changed = false;
      for (const d of card.decisions || [])
        if (!d.resolvedAt && d.kind === 'waiting') {
          prompts.settle(store, card, [d], { resolvedAt: n.t || now(), resolvedBy: 'board' });
          changed = true;
        }
      if (changed) change('card', n.cid, 'board', n.board);
      return false;
    });
    const groups = new Map();
    for (const n of buf) {
      const k = n.rule;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(n);
    }
    let said = 0,
      more = 0;
    for (const [rule, ns] of groups) {
      if (said >= 6) {
        more += ns.length;
        continue;
      }
      if (ns.length > 1 && (rule === 'exists' || rule === 'opened')) {
        const slugs = [...new Set(ns.map(n => n.slug).filter(Boolean))];
        const text =
          rule === 'exists'
            ? `${ns.length} TASK_CREATED lines named tasks that already exist (${slugs.join(', ')}). TASK_CREATED ` +
              `opens new tasks only; each of these was filed as a note on its existing card. Use STATUS, FYI, ACTION ` +
              `or REPLY on them.`
            : `${ns.length} lines named tasks nobody had opened (${slugs.join(', ')}), so each opened a card titled ` +
              `from its slug. If they are existing tasks, name their slugs; otherwise open tasks with TASK_CREATED ` +
              `first, or give each a title with title=Plain_words on a STATUS.`;
        boardNote(ns[0].board, ns[0].by, rule, text, null, ns[0].t);
        said++;
      } else
        for (const n of ns) {
          if (said >= 6) {
            more++;
            continue;
          }
          if (boardNote(n.board, n.by, n.rule, n.text, n.line, n.t, n.slug)) said++;
        }
    }
    if (more)
      boardNote(
        buf[0].board,
        buf[0].by,
        'more',
        `${more} more corrections were left unsaid in this batch; the conduct report on the board has them all.`,
        null,
        buf[0].t,
      );
  }

  return { batch, boardNote, note, noteOnce, copyAllowed, copyWanted, flushCopies, flushNotes };
};
