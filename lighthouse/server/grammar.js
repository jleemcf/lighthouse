'use strict';
const { ownerId, isOwnerName } = require('./configuration');
const { STATES } = require('./card-transitions');
// The line grammar operators write in: the labels and lanes, the words that mark a shift, an ask, a settled ask or
// an answered notice, and the small helpers that read a line.
module.exports = function makeGrammar(ctx) {
  const { store, slugOf } = ctx;
  // Outbox rows from an operator's transcript (the collector) or any script: the label grammar, executed here.
  // The board reads nothing from firstmate's records: the operator opens, moves and closes tasks.
  const LABELS = new Set([
    'ACTION',
    'FYI',
    'REPLY',
    'RELAYED',
    'STATUS',
    'CONTEXT',
    'TASK_CREATED',
    'TASK_FINISHED',
    'SHIFT',
    'OPS',
    'PROMPT',
    'NOTICE',
  ]);
  // Only firstmate accepts operator relays; the advice steward is a separate board-owned job runner.
  const promptTo = (board, row) => {
    const to = String(row.to || '').toLowerCase();
    return to === 'firstmate' ? to : null;
  };
  const LABEL_LIST = [...LABELS].join(', ');
  const lineOf = row =>
    `${row.label || ''}${
      row.task && row.task !== 'general' ? ' · ' + row.task : ''
    }: ${String(row.text || '').slice(0, 120)}`;
  function nearestSlugs(board, slug, n = 3) {
    // open cards whose slug or title shares the most words with an unknown slug
    const words = x =>
      new Set(
        String(x)
          .toLowerCase()
          .split(/[^a-z0-9]+/)
          .filter(w => w.length > 2),
      );
    const w = words(slug);
    if (!w.size) return [];
    return Object.values(store.cards)
      .filter(c => c.board === board && c.status !== 'done')
      .map(c => {
        const cw = words(slugOf(board, c.id) + ' ' + (c.title || ''));
        let k = 0;
        for (const x of w) if (cw.has(x)) k++;
        return [k, slugOf(board, c.id)];
      })
      .filter(x => x[0] > 0)
      .sort((a, b) => b[0] - a[0])
      .slice(0, n)
      .map(x => x[1]);
  }
  // the first clause of a line, for a card opened by a stray line: readable for Owner while the operator owes a title
  const firstClause = text => {
    const t = String(text || '')
      .replace(/\*\*/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!t) return '';
    let c = t.split(/(?<=[a-z0-9)])[.:;!?](?:\s|$)| — | - /i)[0].trim();
    if (c.length > 72) c = c.slice(0, 72).replace(/\s+\S*$/, '') + '…';
    return c ? c.charAt(0).toUpperCase() + c.slice(1) : '';
  };
  const TITLE_OK = /^[A-Za-z0-9._-]+$/;
  // a SHIFT line speaks of the shift (or the watch, the post, the day) starting or ending, anywhere in its first
  // sentence: "Good morning, the shift has started" and "Paused, and I'm ending the shift now" are shift lines; "yes,
  // merged it as you asked" is not.
  // The long patterns here are built from parts; a part cut inside a group is not a pattern on its own, so the parts
  // are String.raw strings, which keep every backslash as written.
  const SHIFT_VERB =
    String.raw`(?:start\w*|begin\w*|begun|resum\w*|back on|end\w*|over|off|` +
    String.raw`clos\w*|stop\w*|paus\w*|wrap\w*|done)`;
  const SHIFT_NOUN = String.raw`(?:shift|watch|post|the day|for the day)`;
  const SHIFT_WORD = new RegExp(
    String.raw`^\s*(?:shift\s+)?${SHIFT_VERB}\b|` +
      String.raw`\b${SHIFT_NOUN}\b[^.!?]{0,60}\b${SHIFT_VERB}\b|` +
      String.raw`\b${SHIFT_VERB}\b[^.!?]{0,60}\b${SHIFT_NOUN}\b`,
    'i',
  );
  const SHIFT_OFF = /\b(end\w*|over|off|clos\w*|stop\w*|paus\w*|wrap\w*|done)\b/i;
  const ASK_SHAPE = new RegExp(
    String.raw`\b(your call|you choose|choose one|pick one|which (?:one |do you|would you)|do you want|` +
      String.raw`would you like|should i|shall i|may i|a or b|option [ab]\b|options?:|` +
      String.raw`your (?:go|word|decision|approval))\b|\?`,
    'i',
  );
  // a REPLY that says Owner did the thing off the board, or that nothing is needed any more, settles the ask, so an
  // operator closes an ask he no longer needs to answer; the board cannot see a sign-in, a Send on another board, or a
  // word in firstmate's window
  const SETTLE_WORDS = new RegExp(
    String.raw`\b(withdraw\w*|settled|no longer need\w*|nothing (?:further |more |else )?(?:is )?needed|` +
      String.raw`no action (?:is )?needed|not needed(?: any ?more)?|needs nothing|nothing needs doing|` +
      String.raw`nothing for you|you(?:'ve| have) (?:done|signed|sent|handled|answered|dealt with) (?:it|this|that)|` +
      String.raw`(?:it|this|that) is done|done on your side|that settles it|no decision needed)\b`,
    'i',
  );
  // a RELAYED that says the operator sent the prompt itself under Owner's standing authority
  const ownerDisplay = (ctx.cfg?.ownerName || 'the captain').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const DELEGATED = new RegExp(
    String.raw`\b(standing authority|delegated authority|under (?:your|his|${ownerDisplay}'?s?) authority|` +
      String.raw`on my own authority|under delegation|as you (?:allowed|authori[sz]ed|permitted)|` +
      String.raw`with your standing (?:word|permission)|myself,? (?:as|under)|sent it myself)\b`,
    'i',
  );
  // the plain ones, for a STATUS or FYI: "settled" alone is said of other work too
  const NEEDS_NOTHING = new RegExp(
    String.raw`\b(withdraw\w*|no longer need\w*|nothing (?:further |more |else )?(?:is )?needed|` +
      String.raw`no action (?:is )?needed|not needed(?: any ?more)?|needs nothing|nothing needs doing|` +
      String.raw`nothing for you|no decision needed)\b`,
    'i',
  );
  // a statement that nothing is needed is not an ask
  const NOT_ASK = new RegExp(
    String.raw`\b(nothing (needs|needed|for you|to do|to decide|required)|no action|no decision|not needed|` +
      String.raw`nothing needs doing|until you want|whenever you want|when you want|no need|needs nothing)\b`,
    'i',
  );
  const etClock = iso => {
    try {
      return require('./business-time').clock(ctx.cfg || {}, iso);
    } catch (e) {
      return String(iso);
    }
  };
  function ownerAnsweredAt(cid) {
    // the last time Owner spoke on this card: a message of his there, or his Send on a prompt
    let last = '';
    for (const m of Object.values(store.comments)) {
      if (m.cardId !== cid) continue;
      if (m.author !== 'coordinator' && isOwnerName(ctx.cfg, m.by) && (m.t || '') > last) last = m.t;
      if (m.prompt && ['send', 'other', 'on-word'].includes(m.prompt.decision) && m.prompt.decidedAt > last)
        last = m.prompt.decidedAt;
    }
    return last;
  }
  // the watch's notice answered in substance: "The watch was right that I asked the same questions again ... From
  // now on I" settles it; "watch restarted" does not
  const NOTICE_ACK = new RegExp(
    String.raw`\b(notice|noted|noting|corrected|correcting|fixed|fixing|acknowledg\w*|understood|re-?labell?\w*|` +
      String.raw`my mistake|my error|you're right|you are right|(?:was|were|is) right|will do|done|sorry|apologi\w*|` +
      String.raw`from now on|going forward|i should have|i'?ll stop)\b|` +
      /\b(?:the watch|watch operator)\b[^.!?]{0,40}\b(?:right|correct|flagged|caught|noticed)\b/.source,
    'i',
  );
  // key=value words on a checkpoint line cannot hold spaces, so an operator writes title=Add_a_marker_file
  const plainWords = v => String(v).replace(/_/g, ' ').trim();
  // the pictures and files an operator's line carries
  const attsOf = ids =>
    Array.isArray(ids)
      ? ids
          .map(id => store.attachments[String(id)])
          .filter(Boolean)
          .map(a => ({ id: a.id, name: a.name, type: a.type, size: a.size }))
      : [];
  // a message keeps the structure beneath its line
  const withBody = row =>
    (String(row.text || '') + (row.body ? '\n\n' + String(row.body).slice(0, 8000) : '')).slice(0, 12000);
  const targetsOf = row => (Array.isArray(row.re) ? row.re : row.re ? [row.re] : []).map(x => String(x));
  // PROMPT: the operator suggests a prompt for Owner to send to firstmate; the line names to=firstmate and the
  // prompt itself is the text beneath the line. The message lands in the
  // conversation the line names with two choices for Owner: Send (the board tells the operator, in Owner's name and at
  // his click, to send it on his behalf, verbatim) or No, something else (he answers himself).
  // The prompt is the quote block beneath the line; anything else beneath it is the operator talking to Owner and
  // never travels, so a Send never carries the operator's asides to firstmate. With no quote block, the whole body is
  // the prompt; with no body, the line's text.
  const promptText = row => {
    const body = row.body ? String(row.body) : '';
    const quoted = body
      .split('\n')
      .filter(l => /^[ \t]*>/.test(l))
      .map(l => l.replace(/^[ \t]*>[ \t]?/, ''))
      .join('\n')
      .trim();
    return (quoted || body.trim() || String(row.text || '')).slice(0, 8000);
  };

  return {
    LABELS,
    STATES,
    promptTo,
    LABEL_LIST,
    lineOf,
    nearestSlugs,
    firstClause,
    TITLE_OK,
    SHIFT_WORD,
    SHIFT_OFF,
    ASK_SHAPE,
    SETTLE_WORDS,
    DELEGATED,
    NEEDS_NOTHING,
    NOT_ASK,
    etClock,
    ownerAnsweredAt,
    NOTICE_ACK,
    plainWords,
    attsOf,
    withBody,
    targetsOf,
    promptText,
  };
};
