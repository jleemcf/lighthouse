'use strict';
// Recover the staff-question state of legacy cards: asked, working, sending or done. CRM delivery owns later moves.
// An outbox entry takes precedence over a closed lane: pending delivery reopens it and remembers any finish intent.
// A handled staff message alone is not delivery proof; a needs_owner receipt still leaves work for the operator.
const lifecycle = require('./card-transitions');

function questionState(card, store) {
  if (!card || !card.crm) return null;
  if (card.crm.state) return card.crm.state;
  const pending = (store.crm.outbox || []).filter(item => item.cid === card.id && item.kind === 'reply');
  if (pending.length) {
    // Preserve whether an old queued answer intended to close, before reopening its prematurely closed card.
    for (const item of pending) if (item.closeOnDelivery === undefined) item.closeOnDelivery = card.status === 'done';
    card.crm.deliveryId = pending.at(-1).id;
    card.crm.state = 'sending';
    lifecycle.reopen(card);
  } else {
    const staff = Object.values(store.comments || {}).find(
      message => message.cardId === card.id && message.kind === 'staff',
    );
    const receipt = (card.log || []).findLast(entry =>
      /^(answer|declined|needs_owner) sent to the CRM$/.test(entry.text),
    );
    // Older completed cards stay completed unless an actual pending reply contradicts that historical state.
    card.crm.state =
      card.status === 'done' || (staff?.handled && receipt?.text !== 'needs_owner sent to the CRM')
        ? 'done'
        : card.crm.working || staff?.handled
          ? 'working'
          : 'asked';
  }
  return card.crm.state;
}

module.exports = { questionState };
