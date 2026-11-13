'use strict';
// Durable card wakes: store hooks supply committed revisions; receivers acknowledge only the revision actually sent.
// Records are pending, retrying, acknowledged or unconfigured. Timers move delivery, never the card's revision.
// Refuse invented revisions and unsafe URLs; retain failed or newer work across retries and process restarts.
const http = require('node:http');
const https = require('node:https');

module.exports = function makeDoorbells(ctx, { intervalMs = 60000, timeoutMs = 3000, maxRetryMs = 300000 } = {}) {
  const targets = new Map();
  const active = new Map();
  const records = (ctx.store.doorbells ||= {});
  let closed = false;
  for (const target of ctx.cfg.cardDoorbells || []) {
    try {
      const url = new URL(target.url);
      const local = ['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname);
      // Remote wake credentials require TLS; plain HTTP is reserved for loopback receivers and test fixtures.
      if (!target.slug || (url.protocol !== 'https:' && !(url.protocol === 'http:' && local))) throw Error();
      targets.set(target.slug, url);
    } catch {
      console.log('card doorbell: invalid configuration');
    }
  }
  const targetOf = record => targets.get(ctx.slugOf(record.board, record.card));
  const outstanding = record => record.revision > record.acknowledged;
  function publish(record) {
    ctx.change('doorbell', record.card, 'board', record.board);
    ctx.saveNow();
  }
  function schedule(record) {
    // One timer/request per card coalesces updates without losing the newest committed revision.
    if (closed || active.has(record.card) || !outstanding(record) || !targetOf(record)) return;
    const state = {};
    active.set(record.card, state);
    state.timer = setTimeout(() => deliver(record, state), Math.max(0, record.nextAttemptAt - Date.now()));
    state.timer.unref();
  }
  function deliver(record, state) {
    if (closed) return;
    // An update arriving during this request must not be acknowledged by the older response.
    const revision = record.revision;
    let finished = false;
    const finish = accepted => {
      if (finished || closed) return;
      finished = true;
      clearTimeout(state.deadline);
      if (accepted) {
        record.acknowledged = Math.max(record.acknowledged, revision);
        record.failures = 0;
        record.lastFailureAt = null;
        record.nextAttemptAt = record.lastAttemptAt + intervalMs;
      } else {
        if (!record.failures) console.log('card doorbell: delivery failed');
        record.failures++;
        record.lastFailureAt = Date.now();
        const backoff = Math.min(maxRetryMs, intervalMs * 2 ** Math.min(record.failures - 1, 20));
        record.nextAttemptAt = record.lastFailureAt + backoff;
      }
      active.delete(record.card);
      try {
        publish(record);
      } catch {
        console.log('card doorbell: persistence failed');
      }
      schedule(record);
    };
    record.lastAttemptAt = Date.now();
    try {
      // Persist the obligation before crossing HTTP so a crash cannot leave an invisible lost wake.
      publish(record);
      const url = targetOf(record);
      const body = JSON.stringify({ board: record.board, card: record.card, revision });
      const transport = url.protocol === 'https:' ? https : http;
      state.request = transport.request(
        url,
        {
          method: 'POST',
          agent: false,
          headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
        },
        response => {
          const accepted = response.statusCode >= 200 && response.statusCode < 300;
          response.on('error', () => finish(false));
          response.on('end', () => finish(accepted));
          response.resume();
        },
      );
      state.request.on('error', () => finish(false));
      // Bound the whole response, not just connection time; a receiver may accept headers and then stall.
      state.deadline = setTimeout(() => {
        finish(false);
        state.request.destroy();
      }, timeoutMs);
      state.deadline.unref();
      state.request.end(body);
    } catch {
      finish(false);
    }
  }
  function ringCard(card, revision) {
    if (closed || !card || !targets.has(ctx.slugOf(card.board, card.id))) return;
    // Only the store's current committed revision can create a wake; retries never fabricate updates.
    if (!Number.isSafeInteger(revision) || revision < 1 || ctx.store.cardRevisions[card.id] !== revision) return;
    let record = Object.hasOwn(records, card.id) ? records[card.id] : null;
    if (!record) {
      record = records[card.id] = {
        board: card.board,
        card: card.id,
        revision,
        acknowledged: 0,
        failures: 0,
        nextAttemptAt: 0,
        lastAttemptAt: null,
        lastFailureAt: null,
      };
    } else {
      record.revision = Math.max(record.revision, revision);
    }
    schedule(record);
  }
  function doorbellStatus(boards) {
    return Object.fromEntries(
      Object.entries(records)
        .filter(([, record]) => Object.hasOwn(boards, record.board))
        .map(([id, record]) => [
          id,
          {
            board: record.board,
            card: record.card,
            revision: record.revision,
            acknowledged: record.acknowledged,
            failures: record.failures,
            nextAttemptAt: outstanding(record) ? record.nextAttemptAt : null,
            lastFailureAt: record.lastFailureAt,
            status: !outstanding(record)
              ? 'acknowledged'
              : !targetOf(record)
                ? 'unconfigured'
                : record.failures
                  ? 'retrying'
                  : 'pending',
          },
        ]),
    );
  }
  function closeDoorbells() {
    closed = true;
    for (const state of active.values()) {
      clearTimeout(state.timer);
      clearTimeout(state.deadline);
      state.request?.destroy();
    }
    active.clear();
  }
  // Restart resumes outstanding work from the store, including work whose previous response was lost.
  for (const record of Object.values(records)) schedule(record);
  return { ringCard, doorbellStatus, closeDoorbells };
};
