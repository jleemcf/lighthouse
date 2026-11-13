'use strict';
// The transcript: everything the operator says in its session and everything Owner says to it, by whatever route,
// kept per board so Owner can read the conversation naked, as if he sat at the operator's own chat.
module.exports = function makeTranscript(ctx) {
  const { cfg, store, TRANSCRIPT_KEEP, slugOf } = ctx;
  // Claude Code's own text in a user entry (an interrupt mark, a re-sent skill's text) is never Owner's words, whatever
  // the collector sent: it is kept off his transcript, and is never authority in his chat.
  // The pattern is built from parts; a part cut inside a group is not a pattern on its own, so it is a String.raw.
  const HARNESS_TEXT = new RegExp(
    /\[Image: original \d+x\d+|\[Request interrupted by user|\(Re-invocation of \/|/.source +
      String.raw`<(?:task-notification|system-reminder|command-name|command-message|local-command|` +
      String.raw`cross-session-message|bash-(?:input|stdout|stderr)|user-memory-input|` +
      String.raw`artifact-content-authored-by-others)|` +
      /\[Cross-session|Base directory for this skill|\[Your previous response|/.source +
      /This session is being continued from a previous conversation/.source,
  );
  // the entry is that text, not his words quoting it
  const HARNESS_LEAD = new RegExp('^\\s*(?:NOTICE from |' + HARNESS_TEXT.source + ')');
  function addTranscript(b, entry) {
    if (!b) return;
    b.transcript = (b.transcript || []).concat([entry]);
    if (b.transcript.length > TRANSCRIPT_KEEP) b.transcript = b.transcript.slice(-TRANSCRIPT_KEEP);
  }
  // The transcript as Owner reads it: the full exchange in order, each part on its card. The operator's "(quiet)" turn
  // ends are left out, his words name their card, and on a tool board, where the operator speaks through its tools,
  // what the tools put on the board (replies, asks, prompts, relays, posts) is set in order among them, each on its
  // card. The chat notes are left out there: they are the operator's chat words, which the transcript already holds.
  const QUIET = /^\(quiet\)\.?$/i;
  const quietEntry = e => e.role === 'operator' && QUIET.test(String(e.text || '').trim());
  function transcriptOf(board) {
    const b = store.boards[board],
      tx = b.transcript || [];
    const on = id => {
      const c = store.cards[id];
      return c ? { card: id, cardTitle: c.title || slugOf(board, id) } : {};
    };
    const out = tx
      .filter(e => !quietEntry(e))
      .map(e => {
        const m = /^card (.+)$/.exec(e.via || '');
        return m ? Object.assign({}, e, on(board + '-' + m[1])) : e;
      });
    if (((cfg.boards || {})[board] || {}).protocol !== 'tools') return out;
    const from = tx.length ? tx[0].t : new Date(Date.now() - 2 * 86400000).toISOString();
    const ops = new Set(b.shift && b.shift.operator ? [b.shift.operator] : []),
      twins = new Set();
    for (const c of Object.values(store.comments)) {
      if (c.board !== board || c.author !== 'operator' || c.saidInChat || c.forOwner || c.chatReply || !(c.t >= from))
        continue;
      ops.add(c.by);
      twins.add(c.cardId + '|' + c.t + '|' + c.label);
      // its answer to his Global message
      const toGlobal = !c.cardId && c.replyTo && store.comments[c.replyTo] && store.comments[c.replyTo].global;
      out.push(
        Object.assign(
          { t: c.t, role: 'operator', by: c.by, text: c.text, kind: c.label, onBoard: true },
          c.cardId ? on(c.cardId) : toGlobal ? { general: true, global: true } : { general: true },
        ),
      );
    }
    for (const c of Object.values(store.cards))
      if (c.board === board)
        for (const e of c.log || []) {
          // a post goes to its card's log, not the conversation
          if (
            !(e.t >= from) ||
            !['STATUS', 'CONTEXT', 'FYI'].includes(e.kind) ||
            !ops.has(e.who) ||
            twins.has(c.id + '|' + e.t + '|' + e.kind)
          )
            continue;
          out.push(
            Object.assign({ t: e.t, role: 'operator', by: e.who, text: e.text, kind: e.kind, onBoard: true }, on(c.id)),
          );
        }
    return out.sort((x, y) => String(x.t).localeCompare(String(y.t)));
  }

  return { HARNESS_TEXT, HARNESS_LEAD, addTranscript, quietEntry, transcriptOf };
};
