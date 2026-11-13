'use strict';
// One tool process's heartbeat and the shell's explicit shift edges. The board, not this helper, owns on/off state.
// A regular session reports once a minute; shadow sessions never send evidence. Heartbeat failure is retryable.
// Only start/end are valid edges, and a shell success requires the board to confirm the requested state.
const crypto = require('node:crypto');
const HEARTBEAT_MS = 60000;
const RETRY_MS = 5000;

function watch({ request, board, shadow, identity, intervalMs = HEARTBEAT_MS }) {
  const session = identity?.sessionId || crypto.randomUUID();
  let attachment;
  let attachedEpoch;
  let retry;
  let stopped = false;
  const adopt = async () => {
    if (!identity) return;
    const changed = await require('./handoff.cjs').refreshEpoch(identity, request, board, epoch =>
      require('./session-identity.cjs').adoptEpoch(identity, epoch),
    );
    if (changed) {
      attachment = null;
      retrySoon();
    }
  };
  const retrySoon = () => {
    if (identity && !stopped && !retry) {
      retry = setTimeout(beat, RETRY_MS);
      retry.unref();
    }
  };
  const beat = () => {
    clearTimeout(retry);
    retry = null;
    if (stopped) return;
    if (!shadow()) {
      if (identity && attachedEpoch !== identity.epoch) {
        attachment = null;
        attachedEpoch = identity.epoch;
      }
      attachment ||= identity
        ? require('./session-identity.cjs').attachment(identity, request, board)
        : Promise.resolve();
      attachment
        .then(() =>
          request('POST', '/api/boards/' + encodeURIComponent(board) + '/heartbeat', {
            session,
            ...(identity ? { processId: identity.processId } : {}),
          }),
        )
        .then(async response => {
          if (response?.status === 0 || response?.status >= 500) retrySoon();
          else if (response?.status === 409) await adopt();
        })
        .catch(async error => {
          attachment = null;
          if (!error.status || error.status >= 500) retrySoon();
          else if (error.status === 409) await adopt().catch(() => {});
        });
    }
  };
  beat();
  const timer = setInterval(beat, intervalMs);
  timer.unref();
  return () => {
    stopped = true;
    clearInterval(timer);
    clearTimeout(retry);
  };
}

async function edge(request, board, action) {
  if (!['start', 'end'].includes(action)) throw new Error('shift action is start or end');
  const response = await request('POST', '/api/boards/' + encodeURIComponent(board) + '/shift', {
    state: action === 'start' ? 'on' : 'off',
  });
  if (response.status !== 200 || response.body?.state !== (action === 'start' ? 'on' : 'off'))
    throw new Error('The board did not confirm the shift ' + action + '. Retry shift.sh after it is reachable.');
  return 'Board shift ' + (action === 'start' ? 'on.' : 'off.');
}

module.exports = { watch, edge, HEARTBEAT_MS };
