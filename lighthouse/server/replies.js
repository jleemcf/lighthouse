'use strict';
const prompts = require('./prompt-transitions');
// The conversation messages a line makes: the answer to Owner's waiting messages, a copy where he wrote, an
// ACTION, RELAYED or PROMPT in its card's conversation, and a line on General.
module.exports = function makeReplies(ctx) {
  const { store, newId, change, slugOf, noteOperatorMessage, promptTo, lineOf, withBody, attsOf, promptText } = ctx;
  const { note, judgeComment } = ctx;
  // The board is another route for Owner's words: while a human message in a conversation (a card's, or the board's
  // general one, cardId null) is unanswered, the operator's next line becomes the answer there and the message is
  // handled. The operator never posts a comment itself and never treats the board as a separate channel.
  function answerAsks(board, cardId, card, row, by, t) {
    // a staff question (the CRM lane) is answered by a REPLY only; a STATUS on its card is work, not the answer
    const asks = Object.values(store.comments).filter(
      x =>
        x.board === board &&
        (x.cardId || null) === cardId &&
        !x.handled &&
        (x.via !== 'api' || x.author === 'coordinator') &&
        (x.kind !== 'staff' || String(row.label || '').toUpperCase() === 'REPLY'),
    );
    if (!asks.length || !row.text) return null;
    asks.sort((a1, a2) => (a1.t || '').localeCompare(a2.t || ''));
    const rid = newId();
    store.comments[rid] = {
      id: rid,
      board,
      cardId,
      cardTitle: card ? card.title : null,
      t,
      text: withBody(row),
      by,
      via: 'api',
      handled: true,
      replyTo: asks[asks.length - 1].id,
      attachments: attsOf(row.attachments),
      label: String(row.label || '').toUpperCase() || undefined,
    };
    for (const a of asks) {
      a.handled = true;
      a.handledAt = t;
      a.handledBy = by;
    }
    change('comment', rid, by, board);
    setImmediate(() => judgeComment(rid));
    return rid;
  }
  // A line written in answer to a message Owner left elsewhere (re= from the collector: the conversations that woke
  // the operator) lands as the reply in that conversation, whatever task the line names. The operator decides which
  // task his words concern and partitions its answer; the answer still comes back to him.
  function deliverReply(board, cardId, row, by, t) {
    const card = cardId ? store.cards[cardId] : null;
    if (cardId && !card) return;
    if (String(row.label || '').toUpperCase() === 'PROMPT') {
      // the prompt and its choices live once, where the line named; here only a pointer, since a copy would show the
      // quote without its buttons
      const to = promptTo(board, row) ? 'the ' + promptTo(board, row) : 'you to send',
        where =
          row.task && row.task !== 'general'
            ? 'on task ' + slugOf(board, row.task.startsWith(board + '-') ? row.task : board + '-' + row.task)
            : 'in General';
      row = Object.assign({}, row, {
        text: 'Suggested a prompt for ' + to + ', ' + where + '; the choices are there.',
        body: '',
      });
    }
    const asks = Object.values(store.comments).filter(
      x =>
        x.board === board &&
        (x.cardId || null) === (cardId || null) &&
        !x.handled &&
        (x.via !== 'api' || x.author === 'coordinator'),
    );
    asks.sort((a1, a2) => (a1.t || '').localeCompare(a2.t || ''));
    const rid = newId();
    // copy: delivered here because Owner wrote here; the line itself lives on its task
    store.comments[rid] = {
      id: rid,
      board,
      cardId: cardId || null,
      cardTitle: card ? card.title : null,
      t,
      text: withBody(row),
      by,
      via: 'api',
      handled: true,
      replyTo: asks.length ? asks[asks.length - 1].id : null,
      attachments: attsOf(row.attachments),
      label: String(row.label || '').toUpperCase(),
      about: row.task && row.task !== 'general' ? String(row.task) : null,
      copy: true,
    };
    // a reply delivered from another task has no line in this card's log
    if (card) noteOperatorMessage(card, t);
    for (const a of asks) {
      a.handled = true;
      a.handledAt = t;
      a.handledBy = by;
    }
    change('comment', rid, by, board);
    setImmediate(() => judgeComment(rid));
  }
  // An ACTION is addressed to Owner, so it sits in the card's conversation with its detail (options, a suggested
  // prompt), where he types his answer; the log keeps its line as history. It answers his unanswered messages there, as
  // any line does.
  function actionComment(board, cardId, card, row, by, t, label = 'ACTION') {
    // ACTION, and RELAYED, which belongs in the main conversation too
    const asks = Object.values(store.comments).filter(
      x =>
        x.board === board &&
        (x.cardId || null) === (cardId || null) &&
        !x.handled &&
        (x.via !== 'api' || x.author === 'coordinator'),
    );
    asks.sort((a1, a2) => (a1.t || '').localeCompare(a2.t || ''));
    const rid = newId();
    store.comments[rid] = {
      id: rid,
      board,
      cardId: cardId || null,
      cardTitle: card ? card.title : null,
      t,
      text: withBody(row),
      by,
      via: 'api',
      handled: true,
      replyTo: asks.length ? asks[asks.length - 1].id : null,
      attachments: attsOf(row.attachments),
      label,
      about: cardId ? slugOf(board, cardId) : undefined,
    };
    for (const a of asks) {
      a.handled = true;
      a.handledAt = t;
      a.handledBy = by;
    }
    change('comment', rid, by, board);
    setImmediate(() => judgeComment(rid));
    return rid;
  }
  function promptComment(board, cardId, card, row, by, t) {
    const asks = Object.values(store.comments).filter(
      x =>
        x.board === board &&
        (x.cardId || null) === (cardId || null) &&
        !x.handled &&
        (x.via !== 'api' || x.author === 'coordinator'),
    );
    asks.sort((a1, a2) => (a1.t || '').localeCompare(a2.t || ''));
    const rid = newId(),
      to = promptTo(board, row);
    if (row.to && !to)
      note(
        board,
        by,
        'prompt-destination',
        'Prompts can be relayed only to firstmate. This one was filed for the captain to send manually; ' +
          'suggest prompts with to=firstmate.',
        lineOf(row),
        t,
      );
    store.comments[rid] = {
      id: rid,
      board,
      cardId: cardId || null,
      cardTitle: card ? card.title : null,
      t,
      text: withBody(row),
      by,
      via: 'api',
      handled: true,
      replyTo: asks.length ? asks[asks.length - 1].id : null,
      attachments: attsOf(row.attachments),
      label: 'PROMPT',
      about: cardId ? slugOf(board, cardId) : undefined,
      prompt: prompts.offer(to, promptText(row)),
    };
    for (const a of asks) {
      a.handled = true;
      a.handledAt = t;
      a.handledBy = by;
    }
    change('comment', rid, by, board);
    setImmediate(() => judgeComment(rid));
    return rid;
  }
  // Every general line (any label but SHIFT) is the operator's side of the board's general conversation: it becomes a
  // comment there, tagged with its label, answering his unanswered general messages if any.
  function generalLine(board, row, by, t) {
    if (!row.text) return;
    // a line the collector could not read answers nothing: his messages stay owed until a line that parses (an ACTION
    // whose rec= holds a space falls to General, and must not mark them all handled)
    const asks = row.malformed
      ? []
      : Object.values(store.comments).filter(
          x => x.board === board && !x.cardId && !x.handled && (x.via !== 'api' || x.author === 'coordinator'),
        );
    asks.sort((a1, a2) => (a1.t || '').localeCompare(a2.t || ''));
    const rid = newId();
    store.comments[rid] = {
      id: rid,
      board,
      cardId: null,
      cardTitle: null,
      t,
      text: withBody(row),
      by,
      via: 'api',
      handled: true,
      replyTo: asks.length ? asks[asks.length - 1].id : null,
      attachments: attsOf(row.attachments),
      label: String(row.label || '').toUpperCase(),
      untagged: !!row.untagged,
      malformed: !!row.malformed,
    };
    for (const a of asks) {
      a.handled = true;
      a.handledAt = t;
      a.handledBy = by;
    }
    change('comment', rid, by, board);
    setImmediate(() => judgeComment(rid));
  }

  return { answerAsks, deliverReply, actionComment, promptComment, generalLine };
};
