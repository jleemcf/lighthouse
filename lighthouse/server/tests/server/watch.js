'use strict';
const { testPort, spawnServer } = require('../../../tests/sandbox.cjs');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { req, wait } = require('../helpers');

// The watch operator: NOTICE, its settlement by OPS, the instruments pulse, the conduct report, and the shift as the
// lines and the outbox show it.
module.exports = async function watch(ctx) {
  const { t } = ctx;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lhsrv-'));
  const port = await testPort();
  const cfg = {
    port,
    bind: '127.0.0.1',
    storeFile: 'store.json',
    tokens: {
      OWNER: { name: 'owner', via: 'page' },
      OPS: { name: 'op-test', via: 'api' },
      WATCH: { name: 'op-watch', via: 'api' },
    },
    boards: {
      t: { name: 'Test', access: { owner: 'owner', 'op-test': 'operator', 'op-watch': 'watch' } },
      w: { name: 'Watch', access: { owner: 'owner', 'op-watch': 'operator' } },
    },
  };
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(cfg));
  fs.writeFileSync(path.join(dir, 'store.json'), JSON.stringify({ cards: {}, comments: {} }));
  const child = spawnServer(path.join(dir, 'config.json'), {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout.on('data', d => (out += d));
  child.stderr.on('data', d => (out += d));
  t.after(() => child.kill());
  for (let i = 0; i < 40 && !out.includes('listening'); i++) await wait(100);
  // the watch reads t (rank 1) and operates w
  let r = await req(port, 'GET', '/api/whoami', null, 'WATCH');
  assert.equal(r.body.roles.t, 1);
  assert.equal(r.body.roles.w, 3);
  await req(port, 'POST', '/api/boards/t/shift', { state: 'on', since: '2026-09-22T00:00:00Z' }, 'OPS');
  // faults on t: a general FYI, an untagged note, a line opening a card with a bare slug, a TASK_CREATED naming that
  // existing card, a card put in Waiting with nothing said
  r = await req(
    port,
    'POST',
    '/api/boards/t/events',
    {
      rows: [
        { label: 'FYI', task: 'general', text: 'firstmate is idle.' },
        { label: 'FYI', task: 'general', text: 'Privately, what I need next: the clock.', untagged: true },
        { label: 'STATUS', task: 'stray-card', text: 'something moved.' },
        { label: 'TASK_CREATED', task: 'stray-card', text: 'a task filed inside another' },
        { label: 'TASK_CREATED', task: 'real-task', title: 'A_real_task', text: 'a proper opening' },
        { label: 'OPS', task: 'general', text: 'sweep re-armed.' },
      ],
    },
    'OPS',
  );
  assert.ok(
    r.body.results.every(x => x.ok),
    JSON.stringify(r.body),
  );
  // the instruments pulse
  r = await req(
    port,
    'POST',
    '/api/boards/t/instruments',
    {
      gate: {
        t: new Date(Date.now() - 30 * 60000).toISOString(),
        mode: 'shadow',
        effective: 'shadow',
        failOpenSince: '2026-09-21T15:00:00Z',
        judged: 3,
        pid: 1,
      },
      compactedAt: new Date().toISOString(),
      outbox: { pid: 2 },
      usage: {
        days: [
          {
            day: '2026-11-10',
            requests: 12,
            cacheRead: 700,
            cacheWrite: 100,
            output: 60,
            avgPrompt: 900,
            turns: { fm_reply: 3, private: 'PRIVATE' },
            text: 'PRIVATE',
          },
        ],
        context: { prompt: 900, window: 1000 },
        token: 'PRIVATE',
      },
    },
    'OPS',
  );
  assert.equal(r.status, 200);
  r = await req(port, 'GET', '/api/state', null, 'OPS');
  const usage = r.body.boards.t.instruments.usage;
  assert.equal(usage.days[0].requests, 12, 'daily usage travels with the instruments pulse');
  assert.equal(usage.days[0].turns.fm_reply, 3);
  assert.ok(!JSON.stringify(usage).includes('PRIVATE'), 'only whitelisted numeric aggregates survive');
  await req(port, 'POST', '/api/boards/t/instruments', { outbox: { pid: 2 } }, 'OPS');
  r = await req(port, 'GET', '/api/state', null, 'OPS');
  assert.deepEqual(r.body.boards.t.instruments.usage, usage, 'old collectors remain compatible');
  await req(
    port,
    'POST',
    '/api/boards/t/instruments',
    {
      gate: {
        t: new Date(Date.now() - 30 * 60000).toISOString(),
        mode: 'shadow',
        effective: 'shadow',
        failOpenSince: '2026-09-21T15:00:00Z',
        judged: 3,
        pid: 1,
      },
      compactedAt: new Date().toISOString(),
      outbox: { pid: 2 },
    },
    'OPS',
  );
  r = await req(port, 'POST', '/api/boards/t/instruments', { gate: {} }, 'WATCH');
  assert.equal(r.status, 403, 'the watch cannot post instruments on a board it only reads');
  // the conduct report counts every fault
  r = await req(port, 'GET', '/api/boards/t/conduct?minutes=60', null, 'WATCH');
  assert.equal(r.status, 200, r.raw);
  const sg = r.body.signals;
  assert.equal(sg.general, 1, 'one labelled line on general (the OPS line does not count): ' + JSON.stringify(sg));
  assert.equal(sg.untagged, 1);
  assert.equal(sg.misfiled, 1, 'the TASK_CREATED naming an existing card');
  assert.equal(sg.slugTitled, 1, 'stray-card carries its slug as title');
  assert.equal(sg.compacted, 1);
  assert.equal(sg.gateSilent, 1, 'a 30-minute-old heartbeat in shadow');
  assert.equal(sg.gateFailOpen, 1);
  assert.equal(sg.outboxSilent, 0, 'telemetry just arrived');
  assert.equal(r.body.jev.judged, 0);
  assert.ok(r.body.examples.misfiled[0].id === 't-stray-card');
  // a NOTICE from the watch, written as a line on its own board naming the other board
  r = await req(
    port,
    'POST',
    '/api/boards/w/events',
    {
      rows: [
        { label: 'NOTICE', task: 't', text: 'Only SHIFT and OPS say general; one FYI on general in the last hour.' },
      ],
    },
    'WATCH',
  );
  assert.ok(r.body.results[0].ok, JSON.stringify(r.body));
  const nid = r.body.results[0].notice;
  r = await req(port, 'GET', '/api/comments?board=t&handled=false', null, 'OWNER');
  const n = (r.body.comments || []).find(c => c.id === nid);
  assert.ok(
    n && n.kind === 'notice' && n.by === 'op-watch' && n.cardId === null,
    "the notice sits in t's General, unhandled",
  );
  r = await req(port, 'GET', '/api/comments?board=w', null, 'OWNER');
  assert.ok(
    (r.body.comments || []).some(c => c.kind === 'notice-sent' && c.text.startsWith('To t: ')),
    "and a copy on the watch's own board",
  );
  r = await req(port, 'GET', '/api/boards/t/conduct?minutes=60', null, 'OWNER');
  assert.equal(r.body.signals.openNotices, 1);
  assert.equal(r.body.notices.open[0].id, nid);
  // an operator may not notice; a notice on a board the watch does not watch is refused
  r = await req(port, 'POST', '/api/boards/t/events', { rows: [{ label: 'NOTICE', task: 'w', text: 'no' }] }, 'OPS');
  assert.equal(r.body.results[0].ok, false);
  assert.match(r.body.results[0].reason, /not the watch/);
  // A shift end holds against all later ordinary lines; only an explicit start changes the state.
  r = await req(
    port,
    'POST',
    '/api/boards/t/events',
    {
      rows: [
        { label: 'SHIFT', task: 'general', text: 'shift ended. Everything is down.', t: '2026-09-22T22:03:16Z' },
        { label: 'FYI', task: 'general', text: 'where this afternoon leaves you.', t: '2026-09-22T22:03:16Z' },
        { label: 'STATUS', task: 'later', text: 'a closing status a minute later', t: '2026-09-22T22:04:30Z' },
      ],
    },
    'OPS',
  );
  assert.ok(
    r.body.results.every(x => x.ok),
    JSON.stringify(r.body),
  );
  r = await req(port, 'GET', '/api/state', null, 'OWNER');
  assert.equal(
    r.body.boards.t.shift.state,
    'off',
    'the closing FYI and a status a minute later do not re-light the shift',
  );
  r = await req(
    port,
    'POST',
    '/api/boards/t/events',
    { rows: [{ label: 'FYI', task: 'later', text: 'back at it', t: '2026-09-22T22:20:00Z' }] },
    'OPS',
  );
  r = await req(port, 'GET', '/api/state', null, 'OWNER');
  assert.equal(r.body.boards.t.shift.state, 'off', 'a line well after the end cannot restart a shift');
  r = await req(
    port,
    'POST',
    '/api/boards/t/events',
    {
      rows: [
        { label: 'SHIFT', task: 'general', text: 'shift ended', t: '2026-09-22T22:21:00Z' },
        { label: 'SHIFT', task: 'general', text: 'shift started', t: '2026-09-22T22:21:30Z' },
      ],
    },
    'OPS',
  );
  r = await req(port, 'GET', '/api/state', null, 'OWNER');
  assert.equal(r.body.boards.t.shift.state, 'on', 'SHIFT itself is explicit at any time');
  r = await req(
    port,
    'POST',
    '/api/boards/t/events',
    {
      rows: [
        {
          label: 'OPS',
          task: 'general',
          text: 'noted; the FYI on general was mine, corrected.',
          t: '2026-09-22T22:22:00Z',
        },
      ],
    },
    'OPS',
  );
  // the operator's OPS line settles the notice
  r = await req(
    port,
    'POST',
    '/api/boards/t/events',
    { rows: [{ label: 'OPS', task: 'general', text: 'noted; the FYI on general was mine, corrected.' }] },
    'OPS',
  );
  // a STATUS makes no message, but it is a line: the silence clock follows it
  {
    const t1 = new Date(Date.now() - 50 * 60000).toISOString().replace(/\.\d{3}Z$/, 'Z'),
      t2 = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
    r = await req(
      port,
      'POST',
      '/api/boards/t/events',
      { rows: [{ label: 'FYI', task: 'later', text: 'a message fifty minutes ago', t: t1 }] },
      'OPS',
    );
    r = await req(
      port,
      'POST',
      '/api/boards/t/events',
      { rows: [{ label: 'STATUS', task: 'later', state: 'inflight', text: 'still at it', t: t2 }] },
      'OPS',
    );
    r = await req(port, 'GET', '/api/boards/t/conduct?minutes=60', null, 'OWNER');
    assert.ok(r.body.lastLine >= t2, 'the STATUS counts as the last line: ' + r.body.lastLine);
    assert.ok(r.body.signals.silenceMin < 5, 'no silence');
  }
  r = await req(port, 'GET', '/api/boards/t/conduct?minutes=60', null, 'OWNER');
  assert.equal(r.body.signals.openNotices, 0, 'settled by OPS');
  // an OPS that answers the notice in substance settles it; 'watch restarted' does not
  r = await req(
    port,
    'POST',
    '/api/boards/w/events',
    {
      rows: [
        {
          label: 'NOTICE',
          task: 't',
          text: 'you asked the same questions twice',
          t: new Date(Date.now() + 5 * 60000).toISOString(),
        },
      ],
    },
    'WATCH',
  ); // five minutes after the last OPS: no crossing
  r = await req(
    port,
    'POST',
    '/api/boards/t/events',
    { rows: [{ label: 'OPS', task: 'general', text: 'my watch restarted after its limit' }] },
    'OPS',
  );
  r = await req(port, 'GET', '/api/boards/t/conduct?minutes=60', null, 'OWNER');
  assert.equal(r.body.signals.openNotices, 1, 'a re-arm does not settle it');
  r = await req(
    port,
    'POST',
    '/api/boards/t/events',
    {
      rows: [
        {
          label: 'OPS',
          task: 'general',
          text: 'The watch was right that I asked the same questions again within minutes. From now on I check first.',
        },
      ],
    },
    'OPS',
  );
  r = await req(port, 'GET', '/api/boards/t/conduct?minutes=60', null, 'OWNER');
  assert.equal(r.body.signals.openNotices, 0, 'the substantive answer settles it');
  // an acknowledging OPS that crossed the notice, a minute before it landed, settles it
  {
    const t0 = new Date(Date.now() - 60000).toISOString().replace(/[.][0-9]{3}Z$/, 'Z'),
      t1 = new Date().toISOString().replace(/[.][0-9]{3}Z$/, 'Z');
    r = await req(
      port,
      'POST',
      '/api/boards/t/events',
      {
        rows: [
          {
            label: 'OPS',
            task: 'general',
            text: "Noted: I didn't check for an existing card before opening one; corrected.",
            t: t0,
          },
        ],
      },
      'OPS',
    );
    r = await req(
      port,
      'POST',
      '/api/boards/w/events',
      { rows: [{ label: 'NOTICE', task: 't', text: 'you opened a card that already existed', t: t1 }] },
      'WATCH',
    );
    assert.ok(r.body.results[0].ok);
    r = await req(port, 'GET', '/api/boards/t/conduct?minutes=60', null, 'OWNER');
    assert.equal(r.body.signals.openNotices, 0, 'the crossed acknowledgement settles it');
  }
  // off shift, a stale gate heartbeat and a fail-open are not faults: the gate is meant to be down
  r = await req(
    port,
    'POST',
    '/api/boards/t/instruments',
    {
      gate: {
        t: new Date().toISOString(),
        mode: 'shadow',
        failOpenSince: new Date().toISOString(),
        lastFail: { t: new Date().toISOString(), reason: 'no TYPESAFE_API_KEY in the environment or typesafe.env' },
      },
      outbox: { pid: 1 },
    },
    'OPS',
  );
  r = await req(port, 'GET', '/api/boards/t/conduct?minutes=60', null, 'OWNER');
  assert.match(
    r.body.instruments.gate.lastFail.reason,
    /no TYPESAFE_API_KEY/,
    'the reason a gate failed reaches the board',
  );
  r = await req(
    port,
    'POST',
    '/api/boards/t/instruments',
    { gate: { t: '2026-09-01T00:00:00Z', mode: 'shadow', failOpenSince: '2026-09-01T00:00:00Z' }, outbox: { pid: 1 } },
    'OPS',
  );
  assert.equal(r.status, 200, JSON.stringify(r.body));
  r = await req(
    port,
    'POST',
    '/api/boards/t/events',
    { rows: [{ label: 'SHIFT', task: 'general', text: 'shift ended', t: '2026-09-22T23:00:00Z' }] },
    'OPS',
  );
  r = await req(port, 'GET', '/api/boards/t/conduct?minutes=60', null, 'OWNER');
  assert.equal(r.body.shift, 'off');
  assert.equal(r.body.signals.gateSilent, 0, 'no gate silence off shift');
  assert.equal(r.body.signals.gateFailOpen, 0, 'no fail-open off shift');
  assert.equal(r.body.signals.outboxSilent, 0);
  // An outbox pulse never starts a shift; the command records the explicit edge itself.
  const iso = min => new Date(Date.now() - min * 60000).toISOString().replace(/\.\d{3}Z$/, 'Z');
  r = await req(
    port,
    'POST',
    '/api/boards/t/events',
    { rows: [{ label: 'SHIFT', task: 'general', text: 'shift ended', t: iso(5) }] },
    'OPS',
  );
  r = await req(port, 'POST', '/api/boards/t/instruments', { outbox: { pid: 3, since: iso(6) } }, 'OPS');
  r = await req(port, 'GET', '/api/state', null, 'OWNER');
  assert.equal(r.body.boards.t.shift.state, 'off', 'an outbox already running when the shift ended does not start one');
  r = await req(port, 'POST', '/api/boards/t/instruments', { outbox: { pid: 4, since: iso(1) } }, 'OPS');
  r = await req(port, 'GET', '/api/state', null, 'OWNER');
  assert.equal(r.body.boards.t.shift.state, 'off', 'a new collector alone cannot restart a shift');
  await req(port, 'POST', '/api/boards/t/shift', { state: 'on', since: iso(1) }, 'OPS');
  r = await req(port, 'GET', '/api/state', null, 'OWNER');
  const lit = r.body.boards.t.shift;
  assert.equal(lit.state, 'on', 'an explicit start starts the shift');
  assert.equal(lit.operator, 'op-test');
  assert.ok(Math.abs(Date.parse(lit.since) - (Date.now() - 60000)) < 5000, "its start is the outbox's start");
  assert.equal(lit.lastSeen, lit.since, 'the quiet and silence clocks start there too');
  r = await req(port, 'POST', '/api/boards/t/instruments', { outbox: { pid: 4, since: lit.since } }, 'OPS');
  r = await req(port, 'GET', '/api/state', null, 'OWNER');
  assert.equal(r.body.boards.t.shift.since, lit.since, 'the next pulse changes nothing');
  r = await req(
    port,
    'POST',
    '/api/boards/t/events',
    { rows: [{ label: 'SHIFT', task: 'general', text: 'shift ended' }] },
    'OPS',
  );
  r = await req(port, 'GET', '/api/state', null, 'OWNER');
  assert.equal(r.body.boards.t.shift.state, 'off', 'and a SHIFT line still ends it');
  r = await req(port, 'POST', '/api/boards/t/instruments', { outbox: { pid: 4, since: lit.since } }, 'OPS');
  r = await req(port, 'GET', '/api/state', null, 'OWNER');
  assert.equal(r.body.boards.t.shift.state, 'off', 'the same outbox does not start it again');
  r = await req(port, 'GET', '/api/comments?board=t&general=true', null, 'OWNER');
  assert.ok((r.body.comments || []).find(c => c.id === nid).handled);
};
