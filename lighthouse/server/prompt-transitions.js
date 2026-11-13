'use strict';
// Suggested prompts: offered -> approved -> relayed; declined and superseded are final, never another approval.
// Routes authorize Send, the captain's fresh words or standing authority; only a valid delivery receipt marks relayed.
// Card/ask settlement invalidates undelivered offers. Hydration reads old records without inventing a new permission.
const cards = require('./card-transitions');
const FINAL = new Set(['declined', 'superseded']);

const offer = (to, text) => ({ to, text, state: 'offered', decision: null });

function stateOf(prompt) {
  // Older stores recorded decisions and delivery timestamps before they carried an explicit prompt state.
  if (prompt.state) return prompt.state;
  if (prompt.decision === 'other') return 'declined';
  if (prompt.decision === 'replaced') return 'superseded';
  if (prompt.relayedAt || ['delegated', 'on-word'].includes(prompt.decision)) return 'relayed';
  return prompt.decision ? 'approved' : 'offered';
}

function hydrate(message) {
  const prompt = message.prompt;
  prompt.state = stateOf(prompt);
  if (!prompt.approval && ['approved', 'relayed'].includes(prompt.state))
    prompt.approval = {
      via: prompt.decision === 'on-word' ? 'on-word' : prompt.decision === 'delegated' ? 'authority' : 'send',
      at: prompt.decidedAt || prompt.relayedAt,
      by: prompt.decidedBy,
      onWord: prompt.onWord,
    };
  return prompt;
}

function supersede(message, at, by) {
  if (!message?.prompt || !['offered', 'approved'].includes(stateOf(message.prompt))) return;
  Object.assign(message.prompt, { state: 'superseded', decision: 'replaced', decidedAt: at, decidedBy: by });
}

function linked(card, message) {
  return cards.openAsks(card).filter(ask => ask.commentId === message.id || ask.promptId === message.id);
}

function unavailable(store, message) {
  // An explicit Send settles its own ask but keeps permission to deliver; other approval bases still need that ask.
  const state = stateOf(message.prompt);
  if (FINAL.has(state)) return 'This prompt was ' + state + '. Suggest a new prompt instead.';
  const card = message.cardId && store.cards[message.cardId];
  if (message.cardId && (!card || card.status === 'done')) return 'This prompt is superseded: its card is closed.';
  const needsAsk = state === 'offered' || (state === 'approved' && message.prompt.approval?.via !== 'send');
  if (needsAsk && card && !linked(card, message).length)
    return 'This prompt is superseded: its ask was settled or withdrawn.';
  return null;
}

function settle(store, card, asks, resolution, options = {}) {
  // Settling an ask retires its attached suggestions, except the prompt whose Send caused the settlement.
  const selected = asks.filter(ask => !ask.resolvedAt);
  for (const ask of selected)
    for (const id of [ask.commentId, ask.promptId])
      if (id && id !== options.keepPrompt) supersede(store.comments[id], resolution.resolvedAt, resolution.resolvedBy);
  return cards.settle(card, selected, resolution, options);
}

function recordApproval(prompt, approval) {
  Object.assign(prompt, {
    state: 'approved',
    approval,
    decision: approval.via === 'send' ? 'send' : approval.via === 'on-word' ? 'on-word' : 'delegated',
    decidedAt: approval.at,
    decidedBy: approval.by,
  });
  if (approval.onWord) prompt.onWord = approval.onWord;
  else delete prompt.onWord;
}

function refreshApproval(store, message, approval) {
  // Fresh words or authority may replace an undelivered non-Send basis, never override the captain's explicit Send.
  const reason = unavailable(store, message);
  if (reason) return { ok: false, reason };
  if (
    stateOf(message.prompt) !== 'approved' ||
    !message.prompt.approval ||
    message.prompt.approval.via === 'send' ||
    approval.via === 'send'
  )
    return { ok: false, reason: 'Only an undelivered non-Send approval can change its relay basis.' };
  recordApproval(hydrate(message), approval);
  return { ok: true };
}

function approve(store, message, approval, text) {
  const reason = unavailable(store, message);
  if (reason) return { ok: false, reason };
  if (stateOf(message.prompt) !== 'offered')
    return { ok: false, reason: 'This prompt is already approved or relayed.' };
  const prompt = hydrate(message);
  recordApproval(prompt, approval);
  if (text && text !== prompt.text) Object.assign(prompt, { sentText: text, edited: true });
  const card = message.cardId && store.cards[message.cardId];
  if (card && approval.via === 'send')
    // Send answers the card's open question now; delivery is a separate receipt, not an optimistic state change.
    settle(
      store,
      card,
      cards.openAsks(card),
      { resolvedAt: approval.at, resolvedBy: approval.by },
      { keepPrompt: message.id },
    );
  return { ok: true };
}

function decline(store, message, at, by) {
  const reason = unavailable(store, message);
  if (reason) return { ok: false, reason };
  if (stateOf(message.prompt) !== 'offered')
    return { ok: false, reason: 'This prompt is already approved or relayed.' };
  Object.assign(message.prompt, { state: 'declined', decision: 'other', decidedAt: at, decidedBy: by });
  const card = message.cardId && store.cards[message.cardId];
  if (card)
    settle(
      store,
      card,
      linked(card, message).filter(ask => ask.commentId === message.id),
      { resolvedAt: at, resolvedBy: by },
      { keepPrompt: message.id },
    );
  return { ok: true };
}

function relay(store, message, at, again = false) {
  const reason = unavailable(store, message);
  if (reason) return { ok: false, reason };
  const state = stateOf(message.prompt);
  if (state !== 'approved' && !(state === 'relayed' && again))
    return { ok: false, reason: 'Only an approved prompt can be relayed.' };
  Object.assign(message.prompt, { state: 'relayed', relayedAt: at });
  const card = message.cardId && store.cards[message.cardId];
  if (card && state === 'approved')
    // The first receipt settles the prompt's own ask; repeat delivery must not settle unrelated later questions.
    settle(
      store,
      card,
      linked(card, message).filter(ask => ask.commentId === message.id),
      {
        resolvedAt: at,
        resolvedBy: message.prompt.approval?.by,
      },
    );
  return { ok: true };
}

function close(store, card, at) {
  const result = cards.close(card, at);
  if (result.ok)
    for (const message of Object.values(store.comments))
      if (message.cardId === card.id) supersede(message, at, card.updatedBy);
  return result;
}

function lineRelay(store, card, by, at, delegated) {
  // A frozen line client has no ticket id: credit only its newest matching Send, not any pending approved prompt.
  const candidates = Object.values(store.comments).filter(message => message.cardId === card.id && message.prompt);
  const source = Object.values(store.comments)
    .filter(message => message.cardId === card.id && message.via !== 'api' && message.author !== 'coordinator')
    .sort((left, right) => (left.t || '').localeCompare(right.t || ''))
    .at(-1);
  const message = delegated
    ? candidates.filter(entry => ['offered', 'approved'].includes(stateOf(entry.prompt))).pop() || candidates.at(-1)
    : candidates.find(entry => source?.kind === 'prompt-send' && source.promptOf === entry.id);
  if (!delegated && (!message || stateOf(message.prompt) !== 'approved')) return { ok: true };
  if (!message || stateOf(message.prompt) === 'relayed') return { ok: true };
  const reason = unavailable(store, message);
  if (reason) return { ok: false, reason };
  if (stateOf(message.prompt) === 'offered' && delegated) {
    const approved = approve(store, message, { via: 'authority', at, by, reportedByOperator: true });
    if (!approved.ok) return approved;
  }
  return relay(store, message, at);
}

function load(store) {
  for (const message of Object.values(store.comments)) {
    if (!message.prompt) continue;
    hydrate(message);
    if (message.prompt.state === 'offered' && unavailable(store, message)) message.prompt.state = 'superseded';
  }
}

module.exports = {
  offer,
  stateOf,
  hydrate,
  supersede,
  linked,
  unavailable,
  settle,
  approve,
  refreshApproval,
  decline,
  relay,
  close,
  lineRelay,
  load,
};
