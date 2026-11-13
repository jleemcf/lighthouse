'use strict';
const { active } = require('./shift-presence');
// Stale cards: a gentle reminder, so work does not sit in flight until Owner asks about it.
// A card the operator has not written a line on for 8 hours (24 in Held) is stale. While the operator is on shift,
// the board sends it one note listing its stale cards, oldest first, at most every 8 hours; any line on a card resets
// that card's clock, a plain "no change, still held because ..." included. Skipped: Done, a card with an open ask for
// Owner (it waits on him), the watch's own cards, configured standing cards, the first quarter hour of a shift
// and the quarter hour after a compaction (the operator is re-reading then).
module.exports = function makeStale(ctx) {
  const { cfg, store, now, save, slugOf, isStandingCard, boardNote } = ctx;
  const STALE_H = Object.assign({ default: 8, held: 24, repeat: 8, graceMin: 15 }, cfg.staleHours || {});
  function staleCards(board, nowMs) {
    return Object.values(store.cards)
      .filter(
        c =>
          c.board === board &&
          c.status !== 'done' &&
          !/^watch-/.test(slugOf(board, c.id)) &&
          !isStandingCard(c) &&
          !(c.decisions || []).some(d => !d.resolvedAt),
      )
      .map(c => {
        const last = c.updatedAt || c.createdAt || '';
        const ageH = (nowMs - Date.parse(last)) / 3600000;
        return { c, ageH, limit: c.status === 'held' ? STALE_H.held : STALE_H.default };
      })
      .filter(x => isFinite(x.ageH) && x.ageH >= x.limit)
      .sort((a, b) => b.ageH - a.ageH);
  }
  const ageWords = h =>
    h >= 48 ? Math.round(h / 24) + ' days' : h >= 1 ? Math.round(h) + ' h' : Math.max(1, Math.round(h * 60)) + ' min';
  function staleSweep() {
    ctx.registry?.refresh();
    const nowMs = Date.now(),
      t = now();
    for (const [board, b] of Object.entries(store.boards)) {
      if (cfg.boards?.[board]?.lifecycle === 'archived') continue;
      const sh = b.shift || {};
      if (!active(b, cfg.boards?.[board]?.protocol, nowMs) || !sh.operator) continue;
      const grace = STALE_H.graceMin * 60000,
        since = Date.parse(sh.since || ''),
        comp = Date.parse((b.instruments || {}).compactedAt || '');
      if (isFinite(since) && nowMs - since < grace) continue;
      if (isFinite(comp) && nowMs - comp < grace) continue;
      if (b.staleNoteAt && nowMs - Date.parse(b.staleNoteAt) < STALE_H.repeat * 3600000) continue;
      const st = staleCards(board, nowMs);
      if (!st.length) continue;
      const label = s => ({ queued: 'Queued', inflight: 'In flight', waiting: 'Waiting', held: 'Held' })[s] || s;
      const list =
        st
          .slice(0, 12)
          .map(x => `«${slugOf(board, x.c.id)}» ${label(x.c.status)}, ${ageWords(x.ageH)}`)
          .join('; ') + (st.length > 12 ? `; and ${st.length - 12} more` : '');
      if (((cfg.boards || {})[board] || {}).protocol === 'tools')
        boardNote(
          board,
          sh.operator,
          'stale',
          `${st.length} card${st.length > 1 ? 's have' : ' has'} had nothing from you in a while: ${list}. You ` +
            `manage these tasks: apply the right treatment to each now, one at a time. board_close if it is over; ` +
            `board_post kind status with the right state if its stage changed; board_post kind context if the ` +
            `picture changed; or board_post kind status saying "no change, still <stage> because <reason>". Do not ` +
            `ask Owner to confirm housekeeping: closing a finished task is yours to do. No reply to this note.`,
          null,
          t,
        );
      else
        boardNote(
          board,
          sh.operator,
          'stale',
          `${st.length} card${st.length > 1 ? 's have' : ' has'} had no line from you in a while: ${list}. You ` +
            `manage these tasks: apply the right treatment to each now, one at a time. TASK_FINISHED if it is over; ` +
            `a STATUS with the right state= if its stage changed; a CONTEXT if the picture changed; or a STATUS ` +
            `saying "no change, still <stage> because <reason>". Do not ask Owner to confirm housekeeping: closing a ` +
            `finished task is yours to do. No reply to this note.`,
          null,
          t,
        );
      b.staleNoteAt = t;
      save();
    }
  }
  setInterval(
    () => {
      try {
        staleSweep();
      } catch (e) {
        console.log('stale sweep: ' + e.message);
      }
    },
    cfg.staleSweepMs || 10 * 60 * 1000,
  ).unref();

  return { staleCards };
};
