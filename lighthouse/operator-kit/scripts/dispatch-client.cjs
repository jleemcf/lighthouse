'use strict';
const crypto = require('node:crypto');
const storage = require('./dispatch-storage.cjs');

function client({ home, board, session, request, updateRelay, deliverTicket, locked = async fn => fn() }) {
  const endpoint = '/api/boards/' + encodeURIComponent(board) + '/dispatch-ledger';
  let active = false;
  let recoveryBinding;
  async function status() {
    if (!session) return { enabled: false };
    const result = await request('GET', endpoint);
    if (result.status !== 200) {
      if (active) throw new Error('dispatch ledger unavailable; keep pending work and do not dispatch');
      return { enabled: false, unknown: result.status !== 404 };
    }
    active = result.body?.enabled === true;
    recoveryBinding = result.body?.recoveryEnabled ? result.body.targetBinding || {} : null;
    return result.body || { enabled: false };
  }
  async function send(body) {
    const response = await request('POST', endpoint, body);
    if (response.status !== 200 || !response.body?.ok)
      throw new Error(response.body?.error || 'ledger answer lost; retain evidence and retry only the same operation');
    return response.body;
  }
  async function inventory(view = {}, onlyChanged = false) {
    const { snapshot, digest, unchanged } = await locked(() => {
      storage.pruneCalls(home, view.calls || []);
      const snapshot = storage.inventory(home, board);
      const digest = storage.hash({ sessionId: session.sessionId, epoch: session.epoch, snapshot });
      return { snapshot, digest, unchanged: storage.state(home, board).inventoryDigest === digest };
    });
    if (onlyChanged && unchanged) return { unchanged: true };
    let result;
    const calls = [];
    for (const page of require('./activation-client.cjs').pages(snapshot)) {
      result = await send({ action: 'inventory', operationId: crypto.randomUUID(), ...page });
      calls.push(...(result.calls || []));
    }
    result = { ...result, calls };
    await locked(() => {
      storage.pruneCalls(home, result.calls || []);
      const saved = storage.state(home, board);
      saved.inventoryDigest = digest;
      storage.write(require('node:path').join(home, 'dispatch-journal.json'), JSON.stringify(saved));
    });
    session.journalId = snapshot.journalId;
    await require('./session-identity.cjs').attachment(session, request, board, '-ledger');
    return result;
  }
  async function consume(ticket, id) {
    if (ticket.ledgerVersion !== 1) return true;
    if (!session) throw new Error('explicit session required for board dispatch permission');
    if (recoveryBinding) require('./target-binding.cjs').verify(home, recoveryBinding);
    await updateRelay(id, {
      state: 'permission-requested',
      permissionId: ticket.permissionId,
      attemptId: ticket.attemptId,
      consumeOperationId: 'consume-' + ticket.attemptId,
    });
    let result;
    try {
      result = await send({
        action: 'consume',
        operationId: 'consume-' + ticket.attemptId,
        intentId: ticket.intentId,
        attemptId: ticket.attemptId,
        permissionId: ticket.permissionId,
      });
    } catch (error) {
      await updateRelay(id, { state: 'outcome-unknown', receipt_error: error.message });
      throw error;
    }
    if (
      result.dispatch !== true ||
      result.duplicate ||
      result.attemptId !== ticket.attemptId ||
      result.permissionId !== ticket.permissionId
    ) {
      await updateRelay(id, { state: 'outcome-unknown' });
      throw new Error('permission possibly consumed; do not relay again');
    }
    await updateRelay(id, { state: 'permission-consumed', boardAcknowledged: true });
    return true;
  }
  async function drain(queued) {
    const view = await status();
    if (!view.enabled && !view.available && !view.unknown) return false;
    // With an explicit session, unknown capability is conservative: old-epoch commands never auto-replay.
    if (!view.enabled) return view.unknown === true;
    if (queued.length) await inventory(view, true);
    return true;
  }
  async function tool(args) {
    if (!session) return { isError: true, text: 'explicit operator session required' };
    if (args.action === 'status') return { text: JSON.stringify(await status(), null, 2) };
    if (args.action === 'inventory') return { text: JSON.stringify(await inventory(), null, 2) };
    const result = await send(args);
    if (args.action === 'adopt-intent' && result.ticket) return deliverTicket(result.ticket);
    if (args.action === 'review-call' && args.disposition === 'adopted' && result.call?.disposition === 'adopted') {
      const call = result.call;
      const response = await request('POST', '/api/boards/' + encodeURIComponent(board) + '/calls', {
        calls: [
          {
            id: call.id,
            tool: call.tool,
            args: call.args,
            client_at: call.client_at,
            originSessionId: call.originSessionId,
            originEpoch: call.originEpoch,
            queued: true,
            sent_at: new Date().toISOString(),
          },
        ],
      });
      return {
        isError: response.status !== 200 || response.body?.results?.[0]?.ok !== true,
        text: JSON.stringify(response.body || { error: 'adopted call outcome unknown; review ledger' }),
      };
    }
    return { text: JSON.stringify(result, null, 2) };
  }
  return { status, inventory, consume, drain, tool, send, enabled: () => active };
}
const tools = [
  {
    name: 'board_dispatch',
    description:
      'Inspect the shared dispatch and queue ledger; publish a conservative local inventory; explicitly review ' +
      'and adopt or supersede an old queued call by original id and hash. Never resend a consumed or unknown intent. ' +
      'Owner reconciliation requires independent evidence and quiescence. Retain each operationId after a lost answer.',
    inputSchema: {
      type: 'object',
      required: ['action'],
      properties: {
        action: { enum: ['status', 'inventory', 'adopt-intent', 'review-call'] },
        operationId: { type: 'string' },
        intentId: { type: 'string' },
        attemptId: { type: 'string' },
        callId: { type: 'string' },
        hash: { type: 'string' },
        disposition: { enum: ['adopted', 'superseded', 'rejected'] },
        reason: { type: 'string' },
        seen: { type: 'array', items: { type: 'string' } },
      },
    },
  },
];
module.exports = { client, tools };
