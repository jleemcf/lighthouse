'use strict';
const { testPort, spawnServer } = require('../../../tests/sandbox.cjs');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { req, wait } = require('../helpers');

// The board talks back: refusals and corrections become notes that the board watch prints to the operator, each
// said once per ten minutes; the asks a line opens, keeps or settles; the copies of a long answer to General.
module.exports = async function talkback(ctx) {
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
  const notes = async () => (await req(port, 'GET', '/api/boards/t/notes', null, 'OWNER')).body.notes;
  const rules = ns => ns.map(n => n.rule);
  let r;
  // a title with characters the line does not allow: cleaned, filed, said
  r = await req(
    port,
    'POST',
    '/api/boards/t/events',
    {
      rows: [
        { label: 'TASK_CREATED', task: 'release', title: "Third_release_(roster,_Signal's)", text: 'the release' },
      ],
    },
    'OPS',
  );
  assert.ok(r.body.results[0].ok);
  r = await req(port, 'GET', '/api/state', null, 'OWNER');
  assert.equal(r.body.cards['t-release'].title, 'Third release roster Signal s', 'the title is cleaned to words');
  let ns = await notes();
  assert.deepEqual(rules(ns), ['title']);
  assert.match(ns[0].text, /\( , ' \)|characters the line does not allow/);
  assert.equal(ns[0].to, 'op-test');
  // an unknown label (as the collector reports it) and untagged prose, once per ten minutes
  r = await req(
    port,
    'POST',
    '/api/boards/t/events',
    {
      rows: [
        {
          label: 'FYI',
          task: 'general',
          text: '9:00 PM ET · WATCH · general: firstmate idle',
          untagged: true,
          malformed: true,
          reason: 'unknown label WATCH',
        },
        { label: 'FYI', task: 'general', text: 'No response requested.', untagged: true },
        { label: 'FYI', task: 'general', text: 'still no line here', untagged: true },
      ],
    },
    'OPS',
  );
  ns = await notes();
  assert.deepEqual(
    rules(ns).slice(1),
    ['malformed', 'untagged'],
    'the reason is said once; the second untagged message within ten minutes is not repeated',
  );
  assert.match(ns[1].text, /unknown label WATCH/);
  // TASK_CREATED for tasks that exist, several in one batch: one note naming them; and lines opening unknown tasks
  r = await req(
    port,
    'POST',
    '/api/boards/t/events',
    {
      rows: [
        { label: 'TASK_CREATED', task: 'release', text: 'again' },
        { label: 'TASK_CREATED', task: 'release', text: 'and again' },
        { label: 'STATUS', task: 'release-notes', text: 'writing them' },
      ],
    },
    'OPS',
  );
  ns = await notes();
  assert.deepEqual(rules(ns).slice(3), ['exists', 'opened']);
  assert.match(ns[3].text, /^2 TASK_CREATED lines named tasks that already exist \(release\)/);
  assert.match(ns[4].text, /nearest: release/);
  // SHIFT used for an answer: filed as FYI, the shift untouched
  r = await req(
    port,
    'POST',
    '/api/boards/t/events',
    {
      rows: [
        {
          label: 'SHIFT',
          task: 'general',
          text: 'Paused, and I am ending the shift now. Nothing is running: every worker is parked at a clean stop.',
        },
      ],
    },
    'OPS',
  );
  r = await req(port, 'GET', '/api/state', null, 'OWNER');
  assert.equal(r.body.boards.t.shift.state, 'off', 'a shift end said anywhere in the first sentence ends the shift');
  r = await req(
    port,
    'POST',
    '/api/boards/t/events',
    {
      rows: [
        {
          label: 'SHIFT',
          task: 'general',
          text: 'Good morning, the shift has started. Firstmate was closed at the end of yesterday.',
          t: '2026-09-30T12:00:00Z',
        },
      ],
    },
    'OPS',
  );
  r = await req(port, 'GET', '/api/state', null, 'OWNER');
  assert.equal(r.body.boards.t.shift.state, 'on', 'a start with an "end" in a later sentence is a start');
  r = await req(
    port,
    'POST',
    '/api/boards/t/events',
    {
      rows: [
        { label: 'SHIFT', task: 'general', text: 'shift started' },
        { label: 'SHIFT', task: 'release', text: 'yes, merged it as you asked' },
      ],
    },
    'OPS',
  );
  r = await req(port, 'GET', '/api/state', null, 'OWNER');
  assert.equal(r.body.boards.t.shift.state, 'on');
  assert.ok(
    r.body.cards['t-release'].log.some(e => e.kind === 'FYI' && /merged it/.test(e.text)),
    'the answer was filed as FYI on its task',
  );
  ns = await notes();
  assert.equal(rules(ns).pop(), 'shift');
  // an ask left in Ops; a statement that nothing is needed is not one
  {
    const before = (await notes()).length;
    r = await req(
      port,
      'POST',
      '/api/boards/t/events',
      {
        rows: [
          {
            label: 'OPS',
            task: 'general',
            text:
              "my sweep reports 'firstmate is absent'. That's expected: I closed it on your word. " +
              'Nothing needs doing until you want it back.',
          },
        ],
      },
      'OPS',
    );
    ns = await notes();
    assert.equal(ns.length, before, 'nothing needed is not an ask');
  }
  r = await req(
    port,
    'POST',
    '/api/boards/t/events',
    { rows: [{ label: 'OPS', task: 'general', text: 'gate re-armed; should I restart the sweep, your call' }] },
    'OPS',
  );
  ns = await notes();
  assert.equal(rules(ns).pop(), 'ops-ask');
  // a card left red by a STATUS that says settled; a bare Waiting; the synthesized ask closing when the card leaves
  // Waiting
  r = await req(
    port,
    'POST',
    '/api/boards/t/events',
    {
      rows: [
        { label: 'ACTION', task: 'release', text: 'Approve the release?' },
        { label: 'STATUS', task: 'release', state: 'inflight', text: 'settled, moving on' },
      ],
    },
    'OPS',
  );
  ns = await notes();
  assert.equal(rules(ns).pop(), 'red');
  r = await req(port, 'GET', '/api/state', null, 'OWNER');
  assert.ok(
    r.body.cards['t-release'].decisions.some(d => !d.resolvedAt),
    'the ask is still open, as the note says',
  );
  r = await req(
    port,
    'POST',
    '/api/boards/t/events',
    {
      rows: [
        { label: 'REPLY', task: 'release', text: 'withdrawn.' },
        { label: 'STATUS', task: 'release-notes', state: 'waiting', text: 'needs a look' },
      ],
    },
    'OPS',
  );
  ns = await notes();
  assert.equal(rules(ns).pop(), 'waiting');
  r = await req(
    port,
    'POST',
    '/api/boards/t/events',
    { rows: [{ label: 'STATUS', task: 'release-notes', state: 'inflight', text: 'back on it' }] },
    'OPS',
  );
  r = await req(port, 'GET', '/api/state', null, 'OWNER');
  assert.ok(
    !r.body.cards['t-release-notes'].decisions.some(d => !d.resolvedAt),
    'the ask the board opened closes when the card leaves Waiting',
  );
  ns = await notes();
  assert.notEqual(rules(ns).pop(), 'red', 'and no red note for it');
  // a REPLY state=waiting with the PROMPT it announces in the same message: no Waiting note, and the PROMPT's ask is
  // the card's only one
  r = await req(
    port,
    'POST',
    '/api/boards/t/events',
    { rows: [{ label: 'TASK_CREATED', task: 'guide', title: 'Guide_page', text: 'the guide' }] },
    'OPS',
  );
  r = await req(
    port,
    'POST',
    '/api/boards/t/events',
    {
      rows: [
        { label: 'REPLY', task: 'guide', state: 'waiting', text: 'Yes; here is the prompt to send.' },
        { label: 'PROMPT', task: 'guide', to: 'firstmate', text: 'Build the guide page.' },
      ],
    },
    'OPS',
  );
  ns = await notes();
  assert.ok(
    !ns.some(n => n.rule === 'waiting' && /guide/.test(n.text)),
    'no Waiting note when the batch ends with a real ask',
  );
  r = await req(port, 'GET', '/api/state', null, 'OWNER');
  {
    const open = r.body.cards['t-guide'].decisions.filter(d => !d.resolvedAt);
    assert.equal(open.length, 1);
    assert.equal(open[0].kind, 'prompt', 'the ask the board opened from the words gave way to the PROMPT');
  }
  // the same note about the same card is said once per ten minutes
  r = await req(
    port,
    'POST',
    '/api/boards/t/events',
    { rows: [{ label: 'REPLY', task: 'release-notes', state: 'waiting', text: 'still on you' }] },
    'OPS',
  );
  r = await req(
    port,
    'POST',
    '/api/boards/t/events',
    { rows: [{ label: 'REPLY', task: 'release-notes', state: 'waiting', text: 'still on you, again' }] },
    'OPS',
  );
  ns = await notes();
  assert.equal(
    ns.filter(n => n.rule === 'waiting' && /release-notes/.test(n.text)).length,
    1,
    'said once for this card within ten minutes, not three times',
  );
  // once Owner has answered on the card, a STATUS state=waiting opens no ask from its words: the card is In flight
  // and the operator is told
  r = await req(
    port,
    'POST',
    '/api/boards/t/events',
    {
      rows: [
        { label: 'TASK_CREATED', task: 'handoff', title: 'Handoff', text: 'the handoff' },
        { label: 'ACTION', task: 'handoff', text: 'Go on piece 15?' },
      ],
    },
    'OPS',
  );
  r = await req(port, 'POST', '/api/comments', { cardId: 't-handoff', text: 'Go.' }, 'OWNER');
  assert.equal(r.status, 201);
  r = await req(
    port,
    'POST',
    '/api/boards/t/events',
    {
      rows: [
        { label: 'RELAYED', task: 'handoff', text: 'delivered your go' },
        { label: 'STATUS', task: 'handoff', state: 'waiting', text: 'I have your go, holding it for a few minutes.' },
      ],
    },
    'OPS',
  );
  r = await req(port, 'GET', '/api/state', null, 'OWNER');
  assert.equal(r.body.cards['t-handoff'].status, 'inflight', 'his move is over');
  assert.ok(!r.body.cards['t-handoff'].decisions.some(d => !d.resolvedAt), 'no ask made from the words');
  ns = await notes();
  assert.equal(rules(ns).pop(), 'mislabel');
  assert.match(ns[ns.length - 1].text, /Owner answered on «handoff» at \d+:\d\d [AP]M/);
  // a Waiting long after his answer is a new ask in the wrong label, not a stale one: the ask is opened from the
  // words and the operator told to use ACTION
  {
    const later = new Date(Date.now() + 40 * 60000).toISOString().replace(/\.\d{3}Z$/, 'Z');
    r = await req(
      port,
      'POST',
      '/api/boards/t/events',
      {
        rows: [
          { label: 'STATUS', task: 'handoff', state: 'waiting', text: 'Here is the plan for your approval.', t: later },
        ],
      },
      'OPS',
    );
    r = await req(port, 'GET', '/api/state', null, 'OWNER');
    assert.equal(r.body.cards['t-handoff'].status, 'waiting');
    assert.ok(
      r.body.cards['t-handoff'].decisions.some(d => !d.resolvedAt && d.kind === 'waiting'),
      'an ask from the words',
    );
    ns = await notes();
    assert.equal(rules(ns).pop(), 'waiting');
    r = await req(
      port,
      'POST',
      '/api/boards/t/events',
      { rows: [{ label: 'REPLY', task: 'handoff', text: 'withdrawn', t: later }] },
      'OPS',
    );
  }
  // a STATUS state=waiting with a PROMPT in the same message, after Owner answered: the PROMPT is a new ask, so no
  // mislabel note and the card waits
  {
    const before = (await notes()).length;
    r = await req(
      port,
      'POST',
      '/api/boards/t/events',
      {
        rows: [
          { label: 'STATUS', task: 'handoff', state: 'waiting', text: 'Piece 5 passed my read.' },
          { label: 'PROMPT', task: 'handoff', to: 'firstmate', text: 'Land piece 5.' },
        ],
      },
      'OPS',
    );
    r = await req(port, 'GET', '/api/state', null, 'OWNER');
    assert.equal(r.body.cards['t-handoff'].status, 'waiting', 'the PROMPT is his move');
    assert.equal(r.body.cards['t-handoff'].decisions.filter(d => !d.resolvedAt).length, 1);
    ns = await notes();
    assert.equal(ns.length, before, 'no note at all when a real ask came in the same message');
  }
  // Owner asks a question back: the REPLY that answers it says state=waiting, so his ask stays open and the card
  // stays in Waiting, with no note and no new ask; the REPLY after his decision settles as before
  {
    r = await req(
      port,
      'POST',
      '/api/boards/t/events',
      {
        rows: [
          { label: 'TASK_CREATED', task: 'clarify', title: 'Clarify', text: 'two ways' },
          { label: 'ACTION', task: 'clarify', rec: 'B', text: 'Fix it now (A) or later (B)?' },
        ],
      },
      'OPS',
    );
    const ask = (await req(port, 'GET', '/api/state', null, 'OWNER')).body.cards['t-clarify'].decisions.find(
      d => !d.resolvedAt,
    );
    assert.equal(
      (await req(port, 'POST', '/api/comments', { cardId: 't-clarify', text: 'What does A cost?' }, 'OWNER')).status,
      201,
    );
    const before = (await notes()).length;
    r = await req(
      port,
      'POST',
      '/api/boards/t/events',
      {
        rows: [{ label: 'REPLY', task: 'clarify', state: 'waiting', text: 'A costs one more database read per call.' }],
      },
      'OPS',
    );
    let c = (await req(port, 'GET', '/api/state', null, 'OWNER')).body.cards['t-clarify'];
    assert.equal(c.status, 'waiting', 'still his move');
    assert.deepEqual(
      c.decisions.filter(d => !d.resolvedAt).map(d => d.id),
      [ask.id],
      'his ask stays open, and no other is made',
    );
    assert.equal((await notes()).length, before, 'no mislabel or Waiting note');
    assert.equal((await req(port, 'POST', '/api/comments', { cardId: 't-clarify', text: 'B.' }, 'OWNER')).status, 201);
    r = await req(
      port,
      'POST',
      '/api/boards/t/events',
      { rows: [{ label: 'REPLY', task: 'clarify', text: 'Doing B.' }] },
      'OPS',
    );
    c = (await req(port, 'GET', '/api/state', null, 'OWNER')).body.cards['t-clarify'];
    assert.ok(
      !c.decisions.some(d => !d.resolvedAt) && c.status === 'inflight',
      'his answer settles it, and the card moves on',
    );
    // with nothing open, a REPLY state=waiting just after he wrote asks from its own words, quietly: no mislabel, no
    // ping
    assert.equal(
      (await req(port, 'POST', '/api/comments', { cardId: 't-clarify', text: 'And the other part?' }, 'OWNER')).status,
      201,
    );
    r = await req(
      port,
      'POST',
      '/api/boards/t/events',
      {
        rows: [
          { label: 'REPLY', task: 'clarify', state: 'waiting', text: 'That part needs your pick: now or Monday.' },
        ],
      },
      'OPS',
    );
    c = (await req(port, 'GET', '/api/state', null, 'OWNER')).body.cards['t-clarify'];
    assert.equal(c.status, 'waiting');
    const q = c.decisions.find(d => !d.resolvedAt);
    assert.ok(
      q && q.kind === 'waiting' && q.quiet && /needs your pick/.test(q.ask),
      'an ask from its words, marked quiet',
    );
    assert.ok(!(await notes()).slice(before).some(n => n.rule === 'mislabel' || n.rule === 'waiting'), 'and no note');
    r = await req(
      port,
      'POST',
      '/api/boards/t/events',
      { rows: [{ label: 'REPLY', task: 'clarify', text: 'withdrawn' }] },
      'OPS',
    );
  }
  // words are not evidence: a STATUS with no state= that says "settled" while an ask is open draws no red note
  {
    const before = (await notes()).length;
    r = await req(
      port,
      'POST',
      '/api/boards/t/events',
      { rows: [{ label: 'STATUS', task: 'handoff', text: 'M31 settled its review note.' }] },
      'OPS',
    );
    ns = await notes();
    assert.equal(ns.length, before, 'a note about other work is not a claim on the ask');
  }
  // a STATUS that keeps state=waiting never draws the red note, whatever it says about pull requests
  r = await req(
    port,
    'POST',
    '/api/boards/t/events',
    {
      rows: [
        { label: 'PROMPT', task: 'handoff', to: 'firstmate', text: 'Land piece 9.' },
        { label: 'STATUS', task: 'handoff', state: 'waiting', text: 'M34 piece 4 is now merged into main and closed.' },
      ],
    },
    'OPS',
  );
  ns = await notes();
  assert.notEqual(rules(ns).pop(), 'red', 'no red note on a line that keeps Waiting');
  // the last ask settled by a line that names no lane moves the card to In flight; state= after the colon is read
  // once and said
  r = await req(
    port,
    'POST',
    '/api/boards/t/events',
    {
      rows: [
        { label: 'TASK_CREATED', task: 'lanes', title: 'Lanes', text: 'the lanes' },
        { label: 'ACTION', task: 'lanes', text: 'Approve?' },
      ],
    },
    'OPS',
  );
  r = await req(port, 'POST', '/api/comments', { cardId: 't-lanes', text: 'Approved.' }, 'OWNER');
  r = await req(
    port,
    'POST',
    '/api/boards/t/events',
    { rows: [{ label: 'REPLY', task: 'lanes', text: 'Thanks, going ahead.' }] },
    'OPS',
  );
  r = await req(port, 'GET', '/api/state', null, 'OWNER');
  assert.equal(r.body.cards['t-lanes'].status, 'inflight', 'the last ask settled and no lane named: In flight');
  r = await req(
    port,
    'POST',
    '/api/boards/t/events',
    { rows: [{ label: 'ACTION', task: 'lanes', text: 'Sign in once?' }] },
    'OPS',
  );
  r = await req(
    port,
    'POST',
    '/api/boards/t/events',
    {
      rows: [{ label: 'REPLY', task: 'lanes', text: 'You signed in; settled. Waiting on the vendor now. state=held' }],
    },
    'OPS',
  );
  r = await req(port, 'GET', '/api/state', null, 'OWNER');
  assert.equal(r.body.cards['t-lanes'].status, 'held', 'state= at the end of the text is read once');
  assert.ok(!r.body.cards['t-lanes'].decisions.some(d => !d.resolvedAt));
  ns = await notes();
  assert.equal(rules(ns).pop(), 'state-place');
  r = await req(
    port,
    'POST',
    '/api/boards/t/events',
    { rows: [{ label: 'ACTION', task: 'lanes', text: 'One more?' }] },
    'OPS',
  );
  r = await req(port, 'POST', '/api/cards/t-lanes/resolve', {}, 'OWNER');
  assert.equal(r.status, 200);
  r = await req(port, 'GET', '/api/state', null, 'OWNER');
  assert.equal(r.body.cards['t-lanes'].status, 'inflight', 'Handled moves it too');
  // done over an open ask draws a note; a RELAYED under standing authority closes the prompt's ask and leaves his
  r = await req(
    port,
    'POST',
    '/api/boards/t/events',
    {
      rows: [
        { label: 'TASK_CREATED', task: 'deleg', title: 'Delegation', text: 'the case' },
        { label: 'ACTION', task: 'deleg', text: 'Decide the vendor.' },
        { label: 'PROMPT', task: 'deleg', to: 'firstmate', text: 'Build the page.' },
      ],
    },
    'OPS',
  );
  r = await req(
    port,
    'POST',
    '/api/boards/t/events',
    {
      rows: [
        {
          label: 'RELAYED',
          task: 'deleg',
          text: 'Sent the page prompt to firstmate myself, under your standing authority.',
        },
      ],
    },
    'OPS',
  );
  r = await req(port, 'GET', '/api/state', null, 'OWNER');
  {
    const open = r.body.cards['t-deleg'].decisions.filter(d => !d.resolvedAt);
    assert.equal(open.length, 1);
    assert.equal(open[0].ask, 'Decide the vendor.', 'his own ask stays his; the prompt closed');
  }
  r = await req(port, 'GET', '/api/comments?cardId=t-deleg', null, 'OWNER');
  {
    const pm = r.body.comments.find(x => x.prompt);
    assert.equal(pm.prompt.decision, 'delegated', 'the Send buttons go');
  }
  r = await req(
    port,
    'POST',
    '/api/boards/t/events',
    { rows: [{ label: 'STATUS', task: 'deleg', state: 'done', text: 'Wrapping up.' }] },
    'OPS',
  );
  ns = await notes();
  assert.equal(rules(ns).pop(), 'done-open', 'done over an open ask is said');
  r = await req(
    port,
    'POST',
    '/api/boards/t/events',
    { rows: [{ label: 'RELAYED', task: 'deleg', text: 'Sent your vendor choice on.' }] },
    'OPS',
  );
  r = await req(port, 'GET', '/api/state', null, 'OWNER');
  assert.ok(!r.body.cards['t-deleg'].decisions.some(d => !d.resolvedAt), 'a plain RELAYED still settles every ask');
  // a card opened by a stray line takes a provisional title from its first clause; title= replaces it; the counter
  // keeps counting until then
  r = await req(
    port,
    'POST',
    '/api/boards/t/events',
    {
      rows: [
        {
          label: 'STATUS',
          task: 'm39-l5',
          state: 'inflight',
          text: '**L5 sanitizer typing** passed review: it moves to records next.',
        },
      ],
    },
    'OPS',
  );
  r = await req(port, 'GET', '/api/state', null, 'OWNER');
  assert.equal(r.body.cards['t-m39-l5'].title, 'L5 sanitizer typing passed review', 'a readable title from the line');
  r = await req(port, 'GET', '/api/boards/t/conduct?minutes=60', null, 'OWNER');
  assert.ok(
    r.body.examples.slugTitled.some(x => x.id === 't-m39-l5'),
    'still owed a title',
  );
  r = await req(
    port,
    'POST',
    '/api/boards/t/events',
    { rows: [{ label: 'STATUS', task: 'm39-l5', title: 'L5_sanitizer_typing', text: 'retitled' }] },
    'OPS',
  );
  r = await req(port, 'GET', '/api/boards/t/conduct?minutes=60', null, 'OWNER');
  assert.ok(!r.body.examples.slugTitled.some(x => x.id === 't-m39-l5'), 'title= settles it');
  r = await req(
    port,
    'POST',
    '/api/boards/t/events',
    {
      rows: [
        {
          label: 'STATUS',
          task: 'stray',
          state: 'inflight',
          text: 'Teams was mid-reload and blocked my reading, so I reloaded it.',
        },
      ],
    },
    'OPS',
  );
  r = await req(
    port,
    'POST',
    '/api/boards/t/events',
    { rows: [{ label: 'TASK_FINISHED', task: 'stray', title: 'Stray_card_opened_by_mistake', text: 'closed' }] },
    'OPS',
  );
  r = await req(port, 'GET', '/api/state', null, 'OWNER');
  assert.equal(r.body.cards['t-stray'].title, 'Stray card opened by mistake', 'title= works on a TASK_FINISHED too');
  assert.equal(r.body.cards['t-stray'].status, 'done');
  // a line already applied is never applied again: a replayed ACTION re-opens nothing
  r = await req(
    port,
    'POST',
    '/api/boards/t/events',
    {
      rows: [
        { label: 'TASK_CREATED', task: 'replay', title: 'Replay', text: 'x', uuid: 'u-1' },
        { label: 'ACTION', task: 'replay', text: 'Slice size?', uuid: 'u-2' },
      ],
    },
    'OPS',
  );
  r = await req(port, 'POST', '/api/cards/t-replay/resolve', {}, 'OWNER');
  assert.equal(r.status, 200);
  r = await req(
    port,
    'POST',
    '/api/boards/t/events',
    { rows: [{ label: 'ACTION', task: 'replay', text: 'Slice size?', uuid: 'u-2' }] },
    'OPS',
  );
  assert.equal(r.body.results[0].duplicate, true, 'recognised as a replay');
  r = await req(port, 'GET', '/api/state', null, 'OWNER');
  assert.ok(!r.body.cards['t-replay'].decisions.some(d => !d.resolvedAt), 'the answered ask stays answered');
  // a notice settles only on an OPS line that acknowledges it
  r = await req(
    port,
    'POST',
    '/api/boards/w/events',
    { rows: [{ label: 'NOTICE', task: 't', text: 'label your lines' }] },
    'WATCH',
  );
  assert.ok(r.body.results[0].ok);
  r = await req(
    port,
    'POST',
    '/api/boards/t/events',
    { rows: [{ label: 'OPS', task: 'general', text: 'watch restarted' }] },
    'OPS',
  );
  r = await req(port, 'GET', '/api/boards/t/conduct?minutes=60', null, 'OWNER');
  assert.equal(r.body.signals.openNotices, 1, 'an unrelated OPS line does not settle it');
  r = await req(
    port,
    'POST',
    '/api/boards/t/events',
    { rows: [{ label: 'OPS', task: 'general', text: 'noted, corrected the labels' }] },
    'OPS',
  );
  r = await req(port, 'GET', '/api/boards/t/conduct?minutes=60', null, 'OWNER');
  assert.equal(r.body.signals.openNotices, 0, 'an acknowledging OPS line does');
  assert.ok(r.body.boardNotes.count >= 8, 'the conduct report counts the notes');
  assert.ok(r.body.boardNotes.byRule.title === 1);
  // a long answer to a General message: the copies to General are capped at five, the rest become one line naming
  // their tasks
  {
    r = await req(port, 'POST', '/api/comments', { board: 't', text: 'Rebuild the board.' }, 'OWNER');
    const rows = [{ label: 'REPLY', task: 'release', text: 'Rebuilding now.', re: ['general'] }];
    for (let i = 1; i <= 8; i++)
      rows.push({ label: 'TASK_FINISHED', task: 'old' + i, text: 'Closed in the rebuild.', re: ['general'] });
    for (let i = 1; i <= 7; i++) rows.push({ label: 'FYI', task: 'new' + i, text: 'Carried over.', re: ['general'] });
    const before = (await req(port, 'GET', '/api/comments?board=t&general=true', null, 'OWNER')).body.comments.length;
    r = await req(port, 'POST', '/api/boards/t/events', { rows }, 'OPS');
    assert.ok(r.body.results.every(x => x.ok));
    const gen = (await req(port, 'GET', '/api/comments?board=t&general=true', null, 'OWNER')).body.comments.slice(
      before,
    );
    assert.equal(
      gen.length,
      6,
      'five copies and one summing-up line: ' + gen.map(x => x.label + ':' + x.text.slice(0, 20)).join(' | '),
    );
    assert.equal(gen[0].label, 'REPLY');
    assert.ok(gen[0].replyTo, 'the first copy answers his message');
    assert.ok(
      gen.every(x => x.copy),
      'every one is marked a copy',
    );
    assert.match(
      gen[gen.length - 1].text,
      // the expected line is longer than a line of code: the pattern is joined from two parts
      new RegExp(
        /^\.\.\.and 11 more lines of this answer, each on its own task: /.source +
          /old5, old6, old7, old8, new1, new2, new3, new4, new5, new6, new7\./.source,
      ),
    );
    r = await req(port, 'GET', '/api/state', null, 'OWNER');
    assert.equal(r.body.cards['t-old3'].status, 'done', 'the closures landed on their cards');
    r = await req(port, 'GET', '/api/boards/t/conduct?minutes=60', null, 'OWNER');
    assert.equal(r.body.signals.general, 0, 'none of it counts as a line on general');
  }
  // an OPS line that acknowledges the watch's notice is not an answer to Owner, even when the route's re names
  // General
  {
    r = await req(
      port,
      'POST',
      '/api/boards/w/events',
      { rows: [{ label: 'NOTICE', task: 't', text: 'four cards waited without an ask' }] },
      'WATCH',
    );
    assert.ok(r.body.results[0].ok);
    const before = (await notes()).length,
      gen0 = (await req(port, 'GET', '/api/comments?board=t&general=true', null, 'OWNER')).body.comments.length;
    r = await req(
      port,
      'POST',
      '/api/boards/t/events',
      {
        rows: [
          {
            label: 'OPS',
            task: 'general',
            text:
              "The board's operator flagged that four of my cards waited on you without a proper question line. " +
              "I've noted it and corrected them.",
            re: ['general'],
          },
        ],
      },
      'OPS',
    );
    ns = await notes();
    assert.equal(ns.length, before, 'no ops-answer note for a notice acknowledgement');
    r = await req(port, 'GET', '/api/comments?board=t&general=true', null, 'OWNER');
    assert.equal(r.body.comments.length, gen0, 'and nothing delivered to Owner');
    r = await req(port, 'GET', '/api/boards/t/conduct?minutes=60', null, 'OWNER');
    assert.equal(r.body.signals.openNotices, 0, 'the notice is settled');
  }
  // an OPS line that answers a General message of Owner's reaches him anyway, as a REPLY, and the operator is told;
  // a REPLY on general is never a fault
  {
    r = await req(port, 'POST', '/api/comments', { board: 't', text: 'Did both of my requests land?' }, 'OWNER');
    const jid = r.body.id;
    r = await req(
      port,
      'POST',
      '/api/boards/t/events',
      { rows: [{ label: 'OPS', task: 'general', text: 'Both of your requests are handled.', re: ['general'] }] },
      'OPS',
    );
    assert.ok(r.body.results[0].ok);
    r = await req(port, 'GET', '/api/comments?board=t&general=true', null, 'OWNER');
    const ans = r.body.comments.find(x => x.replyTo === jid);
    assert.ok(
      ans && ans.label === 'REPLY' && ans.text === 'Both of your requests are handled.',
      'the answer reached General as a REPLY',
    );
    assert.ok(r.body.comments.find(x => x.id === jid).handled, 'his message is answered');
    ns = await notes();
    assert.equal(rules(ns).pop(), 'ops-answer');
    r = await req(port, 'GET', '/api/state', null, 'OWNER');
    assert.ok(
      r.body.boards.t.ops.some(o => o.text === 'Both of your requests are handled.'),
      'and it is still in the Ops box',
    );
    r = await req(
      port,
      'POST',
      '/api/boards/t/events',
      { rows: [{ label: 'REPLY', task: 'general', text: 'One more thing about that.', re: ['general'] }] },
      'OPS',
    );
    r = await req(port, 'GET', '/api/boards/t/conduct?minutes=60', null, 'OWNER');
    assert.equal(r.body.signals.general, 0, 'a REPLY on general is an answer, not a fault');
  }
  // a stale re from a later turn copies nothing: Owner's message was answered, so nothing waits there
  {
    r = await req(port, 'POST', '/api/comments', { board: 't', text: 'Quick question.' }, 'OWNER');
    r = await req(
      port,
      'POST',
      '/api/boards/t/events',
      { rows: [{ label: 'REPLY', task: 'general', text: 'Answered.', re: ['general'] }] },
      'OPS',
    );
    const before = (await req(port, 'GET', '/api/comments?board=t&general=true', null, 'OWNER')).body.comments.length;
    r = await req(
      port,
      'POST',
      '/api/boards/t/events',
      { rows: [{ label: 'STATUS', task: 'later', text: 'Unrelated work, a later turn.', re: ['general'] }] },
      'OPS',
    );
    assert.equal(
      (await req(port, 'GET', '/api/comments?board=t&general=true', null, 'OWNER')).body.comments.length,
      before,
      'no copy to General once his message is answered',
    );
  }
  // an answer the route delivered to General is not a line on general
  r = await req(port, 'POST', '/api/comments', { board: 't', text: 'How is the release?' }, 'OWNER');
  r = await req(
    port,
    'POST',
    '/api/boards/t/events',
    { rows: [{ label: 'REPLY', task: 'release', text: 'Shipped this morning.', re: ['general'] }] },
    'OPS',
  );
  r = await req(port, 'GET', '/api/boards/t/conduct?minutes=60', null, 'OWNER');
  assert.equal(
    r.body.signals.general,
    0,
    'the answer went to General for Owner, and is not counted against the operator',
  );
  // the notes route: by id from the change feed, as the board watch reads it; the watch may read them, an outsider
  // may not
  r = await req(port, 'GET', '/api/changes?since=0', null, 'OWNER');
  const ch = r.body.changes.filter(c => c.kind === 'note' && c.board === 't');
  assert.ok(ch.length >= 8);
  r = await req(port, 'GET', '/api/boards/t/notes?id=' + ch[0].id, null, 'WATCH');
  assert.equal(r.status, 200);
  assert.equal(r.body.notes.length, 1);
  assert.equal(r.body.notes[0].rule, 'title');
  r = await req(port, 'GET', '/api/boards/t/notes');
  assert.ok(r.status === 401 || r.status === 403, 'an outsider is refused');
};
