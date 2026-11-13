'use strict';
const crypto = require('node:crypto');
const { definition, digest, fail } = require('./registry');
const { hasRole } = require('./access');

function makeLifecycle(registry, ctx = {}) {
  const admin = who => !!who?.hostAdmin;
  function manage(who, board) {
    if (
      !who ||
      (!admin(who) &&
        ((who.board && who.board !== board.id) ||
          !hasRole(board.members[who.name], 'owner') ||
          (who.installationId && who.installationRole !== 'owner')))
    )
      throw fail('board owner or host administrator required', 403);
  }
  function blockers(id) {
    const store = ctx.store || {};
    const board = store.boards?.[id] || {};
    return {
      ownership: !!(board.shift && !['off', 'ended'].includes(board.shift.state)),
      jobs: Object.values(store.stewardRequests || {})
        .filter(job => job.board === id && ['pending', 'running'].includes(job.state))
        .map(job => job.id),
      cards: Object.values(store.cards || {})
        .filter(
          card =>
            card.board === id &&
            (card.status !== 'done' || (card.decisions || []).some(decision => !decision.resolvedAt)),
        )
        .map(card => card.id),
      messages: Object.values(store.comments || {})
        .filter(
          message =>
            message.board === id &&
            ((!message.handled && !message.prompt) ||
              (message.prompt &&
                !['relayed', 'declined', 'superseded'].includes(
                  require('./prompt-transitions').stateOf(message.prompt),
                ))),
        )
        .map(message => message.id),
      tickets: Object.values(store.tickets || {})
        .filter(ticket => ticket.board === id && !ticket.used)
        .map(ticket => ticket.id),
      authorities: Object.values(store.authorities || {})
        .filter(
          record =>
            record.board === id &&
            !record.revokedAt &&
            !record.supersededBy &&
            (!record.expires || Date.parse(record.expires) > Date.now()),
        )
        .map(record => record.sid || record.id),
      deliveries: (store.crm?.outbox || [])
        .filter(item => item.board === id || store.cards?.[item.cid || item.cardId]?.board === id)
        .map(item => item.id || item.cid || item.cardId),
    };
  }
  function preview(who, id) {
    const board = registry.board(id);
    if (!board) throw fail('no such board', 404);
    manage(who, board);
    const pending = blockers(id);
    const result = { id, version: board.version, lifecycle: board.lifecycle, pending };
    return { ...result, confirmation: digest(JSON.stringify(result)) };
  }
  function change(who, action, input) {
    if (action === 'preview') return preview(who, input.id);
    if (action === 'reconcile') {
      if (!admin(who)) throw fail('host administrator required', 403);
      return registry.reconcile();
    }
    return registry.transact(state => {
      if (action === 'create') {
        if (!admin(who)) throw fail('host administrator required', 403);
        const id = crypto.randomUUID();
        const [record, privateSettings] = definition(id, input.board || {}, Object.keys(state.metadata.boards).length);
        state.metadata.boards[id] = record;
        state.credentials.boardSettings[id] = privateSettings;
        return { id, version: record.version };
      }
      const board = Object.hasOwn(state.metadata.boards, input.id) && state.metadata.boards[input.id];
      if (!board) throw fail('no such board', 404);
      manage(who, board);
      if (action === 'rename') {
        if (typeof input.name !== 'string' || !input.name.trim() || input.name.length > 200)
          throw fail('invalid board name');
        board.name = input.name;
        board.displayName = input.name;
      } else if (action === 'reorder') {
        if (input.anchor) {
          const peers = Object.values(state.metadata.boards)
            .filter(candidate => {
              if (candidate.id === board.id) return false;
              try {
                manage(who, candidate);
                return true;
              } catch {
                return false;
              }
            })
            .sort((left, right) => left.order - right.order);
          const index = peers.findIndex(candidate => candidate.id === input.anchor);
          if (index < 0 || !['before', 'after'].includes(input.placement)) throw fail('no managed reorder target', 403);
          const anchor = peers[index].order;
          const neighbor = input.placement === 'before' ? peers[index - 1]?.order : peers[index + 1]?.order;
          board.order =
            neighbor === undefined ? anchor + (input.placement === 'before' ? -1 : 1) : (anchor + neighbor) / 2;
        } else {
          if (!Number.isFinite(input.order)) throw fail('invalid board order');
          board.order = input.order;
        }
      } else if (action === 'archive') {
        const current = preview(who, input.id);
        if (input.confirmation !== current.confirmation) throw fail('archive preview changed; preview again', 409);
        const busy = Object.values(current.pending).some(value => (Array.isArray(value) ? value.length : value));
        if (
          busy &&
          !(
            admin(who) &&
            input.disposition?.action === 'preserve' &&
            typeof input.disposition.reason === 'string' &&
            input.disposition.reason.trim()
          )
        )
          throw fail('active ownership, jobs or unresolved work must be preserved by an administrator', 409);
        ctx.saveNow?.();
        board.lifecycle = 'archived';
        board.archivedAt = new Date().toISOString();
        if (busy)
          board.disposition = { action: 'preserve', reason: input.disposition.reason, pending: current.pending };
      } else throw fail('unknown lifecycle action');
      board.version++;
      return { id: board.id, version: board.version, lifecycle: board.lifecycle };
    });
  }
  return { admin, manage, preview, change, blockers };
}

module.exports = { makeLifecycle };
