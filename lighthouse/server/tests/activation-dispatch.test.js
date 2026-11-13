'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { fixture, write } = require('../../verification/activation-fixture.cjs');
const { flow } = require('../../verification/activation-flow.cjs');
const { callHash } = require('../dispatch-ledger');

async function ready(context) {
  const host = await fixture(context);
  const protocol = flow(host);
  const first = await protocol.register('session-original');
  const second = await protocol.register('session-successor');
  await protocol.acquire(first);
  const journal = await protocol.attach(first, 1);
  await protocol.activate();
  await host.stop();
  const stored = host.disk();
  stored.cards['harbor-work'] = { ...stored.cards['card-harbor'], id: 'harbor-work' };
  delete stored.cards['card-harbor'];
  stored.comments['message-harbor'] = {
    id: 'message-harbor',
    board: 'harbor',
    by: 'captain',
    text: 'Fixture owner instruction for firstmate',
    t: new Date().toISOString(),
  };
  write(path.join(host.home, 'store.json'), stored);
  await host.start();
  const call = tool => ({ operationId: host.id(), calls: [{ id: host.id(), tool, args: {} }] });
  await host.ok('harbor', 'calls', call('board_status'), first.credential, 1);
  const comments = await fetch(host.endpoint + '/api/comments?board=harbor', {
    headers: { Authorization: 'Bearer ' + first.credential, 'X-Lighthouse-Epoch': '1' },
  }).then(response => response.json());
  const source = comments.comments.find(item => item.id === 'message-harbor').sid;
  const issue = call('board_relay');
  issue.calls[0].args = { source, to: 'firstmate', dispatchProtocol: 'dispatch-ledger-v1' };
  return { host, protocol, first, second, journal, issue, call };
}

for (const stage of ['written', 'flushed', 'renamed', 'committed', 'ack']) {
  test('OneIntent + ConsumeNeverReplaysPositiveGrant through real process failure: ' + stage, async context => {
    const { host, first, issue } = await ready(context);
    await host.inject(stage, 'harbor', 'calls', issue, first.credential, 1);
    const saved = host.disk().dispatchLedger.boards.harbor;
    assert.equal(Object.keys(saved.intents).length, 1, 'lost issue ACK never creates a second intent');
    const attempt = Object.values(saved.attempts)[0];
    const command = {
      action: 'consume',
      operationId: host.id(),
      intentId: attempt.intentId,
      attemptId: attempt.id,
      permissionId: attempt.permissionId,
    };
    const answer = await host.inject(stage, 'harbor', 'dispatch-ledger', command, first.credential, 1);
    assert.equal(
      answer.dispatch,
      ['written', 'flushed'].includes(stage),
      'only a consume that never reached rename may grant on retry; a lost grant stays uncertain',
    );
    const another = await host.ok(
      'harbor',
      'dispatch-ledger',
      { ...command, operationId: host.id() },
      first.credential,
      1,
    );
    assert.equal(another.dispatch, false, 'even a fresh operation cannot send again');
    const current = host.disk().dispatchLedger.boards.harbor;
    assert.equal(Object.values(current.attempts)[0].state, 'consumed');
    assert.equal(Object.values(current.intents)[0].history.filter(item => item.action === 'consume').length, 1);
    await host.inject(stage, 'harbor', 'dispatch-ledger', {
      action: 'reconcile',
      operationId: host.id(),
      intentId: attempt.intentId,
      attemptId: attempt.id,
      quiesced: true,
      independent: true,
      outcome: 'not-delivered',
      evidence: 'Fixture route log contains no external invocation',
      reason: 'Owner resolves this exact interrupted grant; timeout alone was not used',
    });
    assert.equal(host.disk().dispatchLedger.boards.harbor.attempts[attempt.id].state, 'quiesced');
  });

  test('ReceiptOnce + ExplicitQueueAdoption + PermanentCommitDedup under failure: ' + stage, async context => {
    const { host, protocol, first, second, journal, issue, call } = await ready(context);
    const ticket = (await host.ok('harbor', 'calls', issue, first.credential, 1)).ticket;
    await host.ok(
      'harbor',
      'dispatch-ledger',
      {
        action: 'consume',
        operationId: host.id(),
        intentId: ticket.intentId,
        attemptId: ticket.attemptId,
        permissionId: ticket.permissionId,
      },
      first.credential,
      1,
    );
    const receipt = call('_relay_result');
    receipt.calls[0].args = {
      ticket: ticket.id,
      delivered: true,
      evidenceCapability: ticket.evidenceCapability,
      originSessionId: first.sessionId,
      originEpoch: 1,
    };
    await host.inject(stage, 'harbor', 'calls', receipt, first.credential, 1);
    assert.equal(
      host.disk().dispatchLedger.boards.harbor.attempts[ticket.attemptId].receipts.length,
      1,
      'a lost receipt ACK never duplicates evidence',
    );
    const queued = {
      id: host.id(),
      tool: 'board_post',
      args: { card: 'work', kind: 'status', text: 'One adopted fixture obligation' },
      originSessionId: first.sessionId,
      originEpoch: 1,
    };
    const journalId = require('../../operator-kit/scripts/dispatch-storage.cjs').inventory(
      journal.home,
      'harbor',
    ).journalId;
    await host.inject(
      stage,
      'harbor',
      'dispatch-ledger',
      {
        action: 'inventory',
        operationId: host.id(),
        journalId,
        complete: true,
        calls: [{ ...queued, hash: callHash(queued) }],
        relays: [],
      },
      first.credential,
      1,
    );
    await protocol.planned(first, second, 1, true);
    assert.equal(
      (await host.request('harbor', 'calls', { calls: [queued] }, second.credential, 2)).status,
      409,
      'successor cannot replay a predecessor queue without reviewing it',
    );
    await host.inject(
      stage,
      'harbor',
      'dispatch-ledger',
      {
        action: 'review-call',
        operationId: host.id(),
        callId: queued.id,
        hash: callHash(queued),
        disposition: 'adopted',
        reason: 'Reviewed against current owner instructions',
      },
      second.credential,
      2,
    );
    await host.ok('harbor', 'calls', call('board_status'), second.credential, 2);
    const committed = await host.inject(
      stage,
      'harbor',
      'calls',
      {
        operationId: host.id(),
        calls: [{ ...queued, queued: true }],
      },
      second.credential,
      2,
    );
    assert.equal(committed.results[0].ok, true, JSON.stringify(committed.results));
    assert.equal(
      host.disk().cards['harbor-work'].log.filter(item => item.text === queued.args.text).length,
      1,
      'one board effect across crash, lost ACK, handoff and repeated commit',
    );
    assert.equal(host.disk().dispatchLedger.boards.harbor.calls[queued.id].disposition, 'acknowledged');
    assert.equal(fs.existsSync(journal.home), true, 'predecessor journal evidence retained');
  });
}
