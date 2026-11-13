'use strict';
const fs = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');

function identity(env = process.env) {
  const sessionId = env.LH_OPERATOR_SESSION_ID;
  const file = env.LH_SESSION_CREDENTIAL_FILE;
  const epoch = env.LH_SESSION_EPOCH;
  if (!sessionId && !file && epoch === undefined) return null;
  if (!/^[A-Za-z0-9_-]{8,100}$/.test(sessionId || '') || !file || !/^[1-9][0-9]*$/.test(epoch || ''))
    throw new Error('explicit session ID, private credential file and exact epoch are required');
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || (process.platform !== 'win32' && stat.mode & 0o077))
    throw new Error('session credential file must be private');
  if (!require('./setup-runtime.cjs').privateStorage(path.dirname(file), file))
    throw new Error('session credential storage must be private');
  let value;
  try {
    value = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    throw new Error('invalid private session credential file');
  }
  if (
    value.sessionId !== sessionId ||
    !/^[A-Za-z0-9_-]{43,128}$/.test(value.credential || '') ||
    !Number.isSafeInteger(Number(epoch))
  )
    throw new Error('session credential binding mismatch');
  const savedEpoch = Number.isSafeInteger(value.epoch) && value.epoch >= Number(epoch) ? value.epoch : Number(epoch);
  return {
    sessionId,
    epoch: savedEpoch,
    file,
    processId: crypto.randomUUID(),
    credential: value.credential,
    headers: { Authorization: 'Bearer ' + value.credential, 'X-Lighthouse-Epoch': String(savedEpoch) },
  };
}

function adoptEpoch(session, epoch) {
  if (!Number.isSafeInteger(epoch) || epoch < session.epoch) throw new Error('invalid successor epoch');
  const value = JSON.parse(fs.readFileSync(session.file, 'utf8'));
  if (value.sessionId !== session.sessionId || value.credential !== session.credential)
    throw new Error('session credential changed; reconnect explicitly');
  const temporary = session.file + '.' + crypto.randomUUID() + '.tmp';
  fs.writeFileSync(temporary, JSON.stringify({ ...value, epoch }), { mode: 0o600 });
  fs.renameSync(temporary, session.file);
  session.epoch = epoch;
  session.headers['X-Lighthouse-Epoch'] = String(epoch);
}

async function attachment(session, request, board, suffix = '') {
  if (!session) return;
  const readiness = session.activation ? await require('./activation-client.cjs').prepare(session, request, board) : {};
  return request('POST', '/api/boards/' + encodeURIComponent(board) + '/ownership', {
    action: 'attach',
    sessionId: session.sessionId,
    processId: session.processId,
    protocol: 'session-epochs-v1',
    ...readiness,
    ...(session.journalId ? { capabilities: ['dispatch-ledger-v1'], journalId: session.journalId } : {}),
    operationId: 'attach-' + session.processId + '-' + session.epoch + suffix,
  }).then(response => {
    if (response.status !== 200)
      throw Object.assign(new Error('board did not attach this explicit session'), { status: response.status });
  });
}

function queuedCall(session, id, tool, args) {
  return {
    id,
    tool,
    args: args || {},
    client_at: new Date().toISOString(),
    ...(session ? { originSessionId: session.sessionId, originEpoch: session.epoch } : {}),
  };
}

function relayEntry(session, id, ticket) {
  return {
    id,
    state: 'authorized',
    intent: {
      ticket: ticket.id,
      to: ticket.to,
      hash: ticket.hash,
      ...(ticket.ledgerVersion
        ? {
            id: ticket.intentId,
            attemptId: ticket.attemptId,
            permissionId: ticket.permissionId,
            ledgerVersion: ticket.ledgerVersion,
          }
        : {}),
    },
    evidenceCapability: ticket.evidenceCapability,
    originSessionId: session?.sessionId,
    originEpoch: session?.epoch,
  };
}

module.exports = { identity, attachment, queuedCall, relayEntry, adoptEpoch };
