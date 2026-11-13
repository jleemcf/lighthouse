'use strict';
const { testPort, spawnServer } = require('../../../tests/sandbox.cjs');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { req, wait } = require('../helpers');

// Stale cards draw one gentle reminder per board, on shift only; a card the operator says can be closed draws a
// note to close it.
module.exports = async function stale(ctx) {
  const { t } = ctx;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lhsrv-'));
  const port = await testPort();
  const H = 1 / 3600; // one second, in hours
  const cfg = {
    port,
    bind: '127.0.0.1',
    storeFile: 'store.json',
    staleSweepMs: 250,
    staleHours: { default: 2 * H, held: 6 * H, repeat: 4 * H, graceMin: 0 },
    standingCards: ['team-mailbox'],
    tokens: { OWNER: { name: 'owner', via: 'page' }, OPS: { name: 'op-test', via: 'api' } },
    boards: { t: { name: 'Test', access: { owner: 'owner', 'op-test': 'operator' } } },
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
  const notes = async () =>
    ((await req(port, 'GET', '/api/boards/t/notes', null, 'OWNER')).body.notes || []).filter(n => n.rule === 'stale');
  let r = await req(
    port,
    'POST',
    '/api/boards/t/events',
    {
      rows: [
        { label: 'SHIFT', task: 'general', text: 'shift started' },
        { label: 'TASK_CREATED', task: 'flying', title: 'Flying', text: 'in flight', state: 'inflight' },
        { label: 'TASK_CREATED', task: 'parked', title: 'Parked', text: 'held', state: 'held' },
        {
          label: 'TASK_CREATED',
          task: 'team-mailbox',
          title: 'Team mailbox',
          text: 'reports and kit problems',
          state: 'held',
        },
        { label: 'TASK_CREATED', task: 'asking', title: 'Asking', text: 'needs Owner' },
        { label: 'ACTION', task: 'asking', text: 'Approve?' },
        { label: 'TASK_CREATED', task: 'over', title: 'Over', text: 'done' },
        { label: 'TASK_FINISHED', task: 'over', text: 'finished' },
      ],
    },
    'OPS',
  );
  assert.ok(r.body.results.every(x => x.ok));
  await wait(2800);
  let ns = await notes();
  assert.equal(ns.length, 1, 'one note for the board');
  assert.match(ns[0].text, /^1 card has had no line from you in a while: «flying» In flight/);
  assert.ok(
    !/«asking»|«over»|«parked»/.test(ns[0].text),
    'not the red card, not Done, not Held before its 24: ' + ns[0].text,
  );
  r = await req(port, 'GET', '/api/boards/t/conduct?minutes=60', null, 'OWNER');
  assert.equal(r.body.stale.count, 1);
  assert.ok(r.body.stale.lastReminder);
  r = await req(
    port,
    'POST',
    '/api/boards/t/events',
    { rows: [{ label: 'STATUS', task: 'flying', text: 'no change, still in flight because the vendor is slow' }] },
    'OPS',
  );
  r = await req(port, 'GET', '/api/boards/t/conduct?minutes=60', null, 'OWNER');
  assert.equal(r.body.stale.count, 0, 'a no-change line resets the clock');
  await wait(1200);
  ns = await notes();
  assert.equal(ns.length, 1, 'no repeat within the interval');
  assert.match(ns[0].text, /You manage these tasks: apply the right treatment to each now/);
  assert.match(ns[0].text, /Do not ask Owner to confirm housekeeping/);
  r = await req(
    port,
    'POST',
    '/api/boards/t/events',
    {
      rows: [
        { label: 'STATUS', task: 'team-mailbox', text: 'no change, still held for team reports' },
        { label: 'STATUS', task: 'parked', text: "I've checked, and it can be closed: the fix shipped." },
      ],
    },
    'OPS',
  );
  {
    const all = (await req(port, 'GET', '/api/boards/t/notes', null, 'OWNER')).body.notes;
    assert.equal(all[all.length - 1].rule, 'close-it', 'can be closed, left open: close it yourself');
  }
  r = await req(
    port,
    'POST',
    '/api/boards/t/events',
    { rows: [{ label: 'SHIFT', task: 'general', text: 'shift ended' }] },
    'OPS',
  );
  await wait(6500);
  ns = await notes();
  assert.equal(ns.length, 1, 'nothing while off shift');
  r = await req(port, 'GET', '/api/boards/t/conduct?minutes=60', null, 'OWNER');
  const staleIds = r.body.stale.examples.map(card => card.id);
  assert.ok(staleIds.includes('t-parked'), 'an ordinary Held card past its limit is stale');
  assert.ok(!staleIds.includes('t-team-mailbox'), 'the equally idle standing card is not stale');
};
