'use strict';
// The advice steward's one durable pending answer: queued -> diagram uploaded -> result accepted, or finally refused.
// The runner enqueues and flushes; only the matching board's explicit acceptance removes a successfully sent answer.
// Refuse overlapping jobs and configuration mismatches; transient/authorization failures retain the answer to retry.
const fs = require('node:fs');
const path = require('node:path');

module.exports = function makeStewardOutbox({ directory, server, board, send, now = Date.now }) {
  const file = path.join(directory, 'pending-result.json');
  // These are final content/job refusals, unlike authentication or server failures that may be repaired later.
  const final = status => [400, 404, 409, 413, 415, 422].includes(status);
  function save(pending) {
    fs.writeFileSync(file + '.tmp', JSON.stringify(pending));
    fs.renameSync(file + '.tmp', file);
  }
  function enqueue(body, svg) {
    if (fs.existsSync(file)) throw new Error('a steward answer still awaits acceptance');
    save({ server, board, body, svg, attempts: 0, notBefore: 0 });
  }
  async function flush() {
    if (!fs.existsSync(file)) return { pending: false };
    const pending = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (pending.server !== server || pending.board !== board)
      return { pending: true, status: 409, error: 'the saved answer belongs to another board configuration' };
    if (now() < pending.notBefore) return { pending: true, deferred: true };
    let reply;
    if (pending.svg && !pending.body.diagram) {
      reply = await send('POST', '/api/steward/diagram', Buffer.from(pending.svg, 'utf8'), 'image/svg+xml');
      if (reply.status === 201 && reply.body && reply.body.id) {
        pending.body.diagram = reply.body.id;
        save(pending);
      } else if (final(reply.status)) {
        // A refused diagram still owes the board a failed-job result, rather than silently dropping the job.
        pending.body = {
          request: pending.body.request,
          failed: true,
          detail: 'the diagram was refused (' + reply.status + ')',
        };
        delete pending.svg;
        save(pending);
      }
    }
    if (!pending.svg || pending.body.diagram) {
      reply = await send('POST', '/api/steward/result', pending.body);
      if (reply.status === 200 && reply.body && reply.body.ok === true && reply.body.request === pending.body.request) {
        fs.unlinkSync(file);
        return { pending: false, delivered: true, request: pending.body.request };
      }
      if (
        reply.status === 422 &&
        pending.svg &&
        pending.body.diagram &&
        reply.body &&
        reply.body.error === 'the explainer needs its SVG diagram, uploaded first'
      ) {
        // The board may have lost the earlier upload; keep the SVG and recreate it before retrying the result.
        delete pending.body.diagram;
      } else if (final(reply.status)) {
        fs.unlinkSync(file);
        return { pending: false, refused: true, status: reply.status };
      }
    }
    // Backoff is persisted with the answer so restarting the runner cannot reset a failing delivery to a tight loop.
    pending.attempts++;
    pending.notBefore = now() + Math.min(15 * 60000, 15000 * 2 ** Math.min(pending.attempts - 1, 6));
    save(pending);
    return { pending: true, status: reply.status, error: reply.error || (reply.body && reply.body.error) };
  }
  return { enqueue, flush };
};
