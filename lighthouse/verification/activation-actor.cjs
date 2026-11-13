'use strict';
require('../tests/sandbox.cjs');
const fs = require('node:fs');
const path = require('node:path');
const { setTimeout: wait } = require('node:timers/promises');
const { write } = require('./upgrade-fixture.cjs');
const settings = JSON.parse(fs.readFileSync(process.argv[2]));
const { home, board, session, endpoint, marker, release, mode } = settings;
async function request(method, route, body) {
  const response = await fetch(endpoint + route, {
    method,
    signal: AbortSignal.timeout(3000),
    headers: {
      Authorization: 'Bearer ' + session.credential,
      'Content-Type': 'application/json',
      ...(session.epoch ? { 'X-Lighthouse-Epoch': String(session.epoch) } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: await response.json() };
}
async function main() {
  if (mode === 'idle') {
    let ticks = 0;
    setInterval(() => write(marker, { pid: process.pid, ticks: ++ticks }), 100);
    return;
  }
  if (mode === 'steward') {
    const first = await request('GET', '/api/steward/next');
    if (first.status !== 200 || !first.body.job) throw new Error('steward did not claim fixture job');
    const job = first.body.job;
    let ticks = 0;
    while (!fs.existsSync(release)) {
      await request('POST', '/api/steward/heartbeat', {});
      const current = await request('GET', '/api/steward/next');
      if (current.body.job?.id !== job.id) throw new Error('steward job changed across handoff');
      write(marker, { pid: process.pid, job, ticks: ++ticks });
      await wait(100);
    }
    const result = await request('POST', '/api/steward/result', {
      request: job.request,
      oneLine: 'Fixture service stayed independent',
      text: 'One completed attempt',
    });
    if (result.status !== 200) throw new Error('steward result refused');
    return;
  }
  const client = require('../operator-kit/scripts/dispatch-client.cjs').client({
    home,
    board,
    session,
    request,
    updateRelay: async () => {},
  });
  await client.consume(settings.ticket, 'fixture-route');
  fs.appendFileSync(
    path.join(home, 'sends.jsonl'),
    JSON.stringify({ ticket: settings.ticket.id }) + String.fromCharCode(10),
  );
  write(marker, { pid: process.pid, started: true });
  while (!fs.existsSync(release)) await wait(25);
  const answer = await request('POST', '/api/boards/' + board + '/calls', {
    calls: [
      {
        id: settings.receiptId,
        tool: '_relay_result',
        args: {
          ticket: settings.ticket.id,
          delivered: true,
          originSessionId: session.sessionId,
          originEpoch: session.epoch,
          detail: 'Scratch route completed once',
          evidenceCapability: settings.ticket.evidenceCapability,
        },
      },
    ],
  });
  if (answer.body.results?.[0]?.ok !== true) throw new Error('late scoped receipt was not accepted');
}
main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
