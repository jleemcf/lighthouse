'use strict';
const { testPort, spawnServer } = require('../../../tests/sandbox.cjs');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { req, rawReq, wait } = require('../helpers');

// The board end to end, first part: the server starts on a temp config and store; identity; the operator's lines
// and their grammar; Owner's messages on a card and the operator's answers; asks opened and settled; the Ops log.
module.exports = async function lines(ctx) {
  const { t } = ctx;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lhsrv-'));
  const port = await testPort();
  const cfg = {
    port,
    bind: '127.0.0.1',
    storeFile: 'store.json',
    tokens: { OWNER: { name: 'owner', via: 'page' }, OPS: { name: 'op-test', via: 'api' }, VIEW: { name: 'viewer1' } },
    boards: {
      t: { name: 'Test', access: { owner: 'owner', 'op-test': 'operator', viewer1: 'viewer' } },
      r: { name: 'Retired', access: { owner: 'owner', 'op-test': 'operator' } },
    },
  };
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(cfg));
  const oldTime = '2026-09-01T12:00:00Z';
  fs.writeFileSync(
    path.join(dir, 'store.json'),
    JSON.stringify({
      cards: {
        't-old-note': { id: 't-old-note', board: 't', title: 'Old reply', status: 'queued', decisions: [], log: [] },
      },
      comments: {
        oldnote: {
          id: 'oldnote',
          board: 't',
          cardId: 't-old-note',
          t: oldTime,
          text: 'A reply delivered from elsewhere.',
          by: 'op-test',
          via: 'api',
          handled: true,
        },
      },
    }),
  );
  const child = spawnServer(path.join(dir, 'config.json'), {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout.on('data', d => (out += d));
  child.stderr.on('data', d => (out += d));
  t.after(() => child.kill());
  for (let i = 0; i < 40 && !out.includes('listening'); i++) await wait(100);
  assert.ok(out.includes('listening'), 'server started: ' + out);

  // identity
  let r = await req(port, 'GET', '/api/state');
  assert.equal(r.status, 401, 'no token is refused');
  r = await req(port, 'GET', '/api/whoami', null, 'OWNER');
  assert.equal(r.body.principal, 'owner');
  assert.equal(r.body.roles.t, 4);
  r = await req(port, 'GET', '/api/state', null, 'OWNER');
  assert.deepEqual(
    r.body.cards['t-old-note'].messageTimes,
    [oldTime],
    'startup recovers a past operator reply without a card log line',
  );

  // the operator opens a task and moves it with state=; the board reads nothing from firstmate's records
  r = await req(
    port,
    'POST',
    '/api/boards/t/events',
    {
      rows: [
        {
          label: 'TASK_CREATED',
          task: 'task1',
          title: 'Task_one',
          severity: 'low',
          text: 'First task, in plain words.',
        },
      ],
    },
    'OPS',
  );
  assert.equal(r.status, 200);
  assert.ok(r.body.results[0].ok, JSON.stringify(r.body.results));
  r = await req(port, 'PATCH', '/api/cards/t-task1', { description: 'plain words from the operator' }, 'OPS');
  assert.equal(r.status, 200);
  r = await req(
    port,
    'POST',
    '/api/boards/t/events',
    { rows: [{ label: 'STATUS', task: 'task1', state: 'inflight', text: 'A crewmate is on it.' }] },
    'OPS',
  );
  assert.ok(r.body.results[0].ok);
  r = await req(port, 'GET', '/api/state', null, 'VIEW');
  assert.equal(r.body.cards['t-task1'].status, 'inflight', 'state= moved the card');
  // the operator's picture: uploaded through the same door as Owner's, named on the line by id, shown in the
  // conversation and the log
  r = await rawReq(
    port,
    'POST',
    '/api/attachments',
    Buffer.from('89504e470d0a1a0a', 'hex'),
    { 'Content-Type': 'image/png', 'X-Name': 'shot.png' },
    'OPS',
  );
  assert.equal(r.status, 201, r.raw);
  const shot = r.body.id;
  r = await req(
    port,
    'POST',
    '/api/boards/t/events',
    { rows: [{ label: 'FYI', task: 'task1', text: 'the screen after the deploy', attachments: [shot, 'nosuchid'] }] },
    'OPS',
  );
  assert.equal(r.body.results[0].ok, false, 'an unknown attachment refuses the whole line');
  r = await req(
    port,
    'POST',
    '/api/boards/t/events',
    { rows: [{ label: 'FYI', task: 'task1', text: 'the screen after the deploy', attachments: [shot] }] },
    'OPS',
  );
  assert.ok(r.body.results[0].ok);
  r = await req(port, 'GET', '/api/comments?cardId=t-task1', null, 'OWNER');
  {
    const c = r.body.comments.find(x => x.text === 'the screen after the deploy');
    assert.ok(c, 'the line is a message');
    assert.deepEqual(
      c.attachments.map(a => a.name),
      ['shot.png'],
      'the authorized picture rides with it',
    );
  }
  r = await req(port, 'GET', '/api/state', null, 'OWNER');
  {
    const e = r.body.cards['t-task1'].log.find(x => x.text === 'the screen after the deploy');
    assert.equal(e.attachments[0].id, shot, 'and with the log entry');
  }
  assert.equal(r.body.cards['t-task1'].title, 'Task one', 'title= with underscores becomes plain words');
  assert.equal(r.body.cards['t-task1'].description, 'A crewmate is on it.');
  assert.equal(r.body.cards['t-task1'].severity, 'low');
  assert.equal(r.body.cards['t-task1'].context, 'First task, in plain words.', 'the opening text is the task context');
  r = await req(
    port,
    'POST',
    '/api/boards/t/events',
    { rows: [{ label: 'CONTEXT', task: 'task1', text: 'A fuller description.', body: '- with detail' }] },
    'OPS',
  );
  r = await req(port, 'GET', '/api/state', null, 'VIEW');
  assert.equal(r.body.cards['t-task1'].context, 'A fuller description.\n\n- with detail', 'CONTEXT rewrites it');
  assert.equal(r.body.cards['t-task1'].description, 'A crewmate is on it.', 'and leaves the status alone');
  r = await req(port, 'POST', '/api/boards/t/sync', { cards: [] }, 'OPS');
  assert.notEqual(r.status, 200, 'the record sync door is gone');

  // viewer cannot write
  r = await req(port, 'POST', '/api/comments', { cardId: 't-task1', text: 'hi' }, 'VIEW');
  assert.equal(r.status, 403);

  // Owner posts; server stamps identity; operator sees it unhandled; operator replies and it becomes handled
  r = await req(port, 'POST', '/api/comments', { cardId: 't-task1', text: 'Merge it.' }, 'OWNER');
  assert.equal(r.status, 201);
  assert.equal(r.body.by, 'owner');
  assert.equal(r.body.via, 'page');
  assert.equal(r.body.handled, false);
  assert.equal(
    (await req(port, 'GET', '/api/state', null, 'OWNER')).body.cards['t-task1'].messageTimes,
    undefined,
    'Owner writing does not flag an operator message',
  );
  const cid = r.body.id;
  r = await req(port, 'GET', '/api/comments?board=t&handled=false', null, 'OPS');
  assert.equal(r.body.comments.length, 1);
  r = await req(port, 'POST', '/api/comments', { cardId: 't-task1', text: 'Merged.', replyTo: cid }, 'OPS');
  assert.equal(r.body.by, 'op-test');
  assert.equal(r.body.handled, true);
  assert.equal(
    (await req(port, 'GET', '/api/state', null, 'OWNER')).body.cards['t-task1'].messageTimes.length,
    1,
    'an operator comment flags the card even without a log line',
  );
  r = await req(port, 'GET', '/api/comments?board=t&handled=false', null, 'OPS');
  assert.equal(r.body.comments.length, 0, 'reply marked the original handled');

  // outbox rows: the label grammar executed by the server
  r = await req(
    port,
    'POST',
    '/api/boards/t/events',
    {
      rows: [
        {
          label: 'STATUS',
          task: 'task1',
          title: 'Put_the_marker_file_in',
          text: "The worker finished; the pull request is on Owner's desk.",
        },
        { label: 'ACTION', task: 'task1', text: 'Merge or close PR 7.' },
        {
          label: 'TASK_CREATED',
          task: 'op-cleanup',
          title: 'Tidy the archive',
          severity: 'low',
          complexity: 'small',
          nature: 'ops',
          text: 'Archive old cards.',
        },
        { label: 'FYI', task: 'nope', text: 'orphan' },
      ],
    },
    'OPS',
  );
  assert.equal(r.status, 200);
  const res = r.body.results;
  assert.ok(res[0].ok && res[1].ok && res[2].ok && res[3].ok, JSON.stringify(res));
  // a line naming a task nobody opened opens it, titled from its slug, and the activity says so
  r = await req(port, 'GET', '/api/state', null, 'OWNER');
  assert.ok(r.body.cards['t-nope'], 'the FYI line opened the card');
  assert.equal(r.body.cards['t-nope'].title, 'Orphan', 'titled for now from the line');
  assert.ok(r.body.cards['t-nope'].provisionalTitle);
  assert.equal(r.body.cards['t-nope'].openedByLine, 'FYI');
  assert.ok(
    r.body.boards.t.activity.some(a => /opened nope with a FYI line/.test(a.text)),
    'the activity records it',
  );
  r = await req(
    port,
    'POST',
    '/api/boards/t/events',
    {
      rows: [
        {
          label: 'ACTION',
          task: 'unpinned-fm',
          state: 'waiting',
          text: 'firstmate is running unpinned; restarting it is your call.',
        },
      ],
    },
    'OPS',
  );
  assert.ok(r.body.results[0].ok);
  r = await req(port, 'GET', '/api/state', null, 'OWNER');
  assert.equal(r.body.cards['t-unpinned-fm'].status, 'waiting');
  assert.equal(
    r.body.cards['t-unpinned-fm'].decisions.filter(d => !d.resolvedAt).length,
    1,
    'an ACTION on an unopened task opens it red',
  );
  // local policy: a STATUS that puts a card in Waiting opens a decision from its own words; a REPLY
  // resolves it and does not reopen it
  r = await req(
    port,
    'POST',
    '/api/boards/t/events',
    {
      rows: [{ label: 'STATUS', task: 'op-cleanup', state: 'waiting', text: 'Archive policy is for Owner to decide.' }],
    },
    'OPS',
  );
  assert.ok(r.body.results[0].ok);
  r = await req(port, 'GET', '/api/state', null, 'OWNER');
  {
    const d = r.body.cards['t-op-cleanup'].decisions.filter(x => !x.resolvedAt);
    assert.equal(d.length, 1, 'Waiting opened an ask');
    assert.equal(d[0].ask, 'Archive policy is for Owner to decide.');
    assert.equal(d[0].kind, 'waiting');
  }
  // a card red by the older flag (needsAction + ask on the card) clears on a REPLY, and Handled clears it too
  r = await req(
    port,
    'PUT',
    '/api/cards/t-legacy',
    { board: 't', title: 'Old ask', needsAction: true, ask: 'Decide the old thing.', status: 'waiting' },
    'OPS',
  );
  assert.equal(r.status, 200);
  r = await req(
    port,
    'POST',
    '/api/boards/t/events',
    { rows: [{ label: 'REPLY', task: 'legacy', text: 'Decided long ago.' }] },
    'OPS',
  );
  assert.ok(r.body.results[0].ok);
  r = await req(port, 'GET', '/api/state', null, 'OWNER');
  assert.equal(r.body.cards['t-legacy'].needsAction, false, 'a REPLY clears the artifact-era flag');
  r = await req(port, 'PATCH', '/api/cards/t-legacy', { needsAction: true }, 'OPS');
  r = await req(port, 'POST', '/api/cards/t-legacy/resolve', {}, 'OWNER');
  assert.equal(r.status, 200);
  assert.equal(r.body.settled, 1, 'Handled clears it');
  // Owner settles an ask himself
  r = await req(port, 'POST', '/api/cards/t-op-cleanup/resolve', {}, 'OPS');
  assert.equal(r.status, 403, 'an api identity cannot settle an ask');
  r = await req(port, 'POST', '/api/cards/t-op-cleanup/resolve', {}, 'OWNER');
  assert.equal(r.status, 200, r.raw);
  assert.equal(r.body.settled, 1);
  r = await req(port, 'GET', '/api/state', null, 'OWNER');
  assert.equal(r.body.cards['t-op-cleanup'].decisions.filter(x => !x.resolvedAt).length, 0, 'settled');
  assert.ok(r.body.cards['t-op-cleanup'].decisions.some(x => x.resolvedBy === 'owner' && x.settledByOwner));
  r = await req(port, 'POST', '/api/cards/t-op-cleanup/resolve', {}, 'OWNER');
  assert.equal(r.status, 404, 'nothing left to settle');
  r = await req(
    port,
    'POST',
    '/api/boards/t/events',
    {
      rows: [{ label: 'STATUS', task: 'op-cleanup', state: 'waiting', text: 'Archive policy is for Owner to decide.' }],
    },
    'OPS',
  );
  r = await req(
    port,
    'POST',
    '/api/boards/t/events',
    { rows: [{ label: 'REPLY', task: 'op-cleanup', text: 'Owner chose seven days.' }] },
    'OPS',
  );
  r = await req(port, 'GET', '/api/state', null, 'OWNER');
  assert.equal(
    r.body.cards['t-op-cleanup'].decisions.filter(x => !x.resolvedAt).length,
    0,
    'the REPLY resolved it and the card, still in Waiting, did not reopen it',
  );
  r = await req(port, 'GET', '/api/state', null, 'OWNER');
  const c1 = r.body.cards['t-task1'];
  assert.equal(c1.description, "The worker finished; the pull request is on Owner's desk.");
  assert.equal(c1.title, 'Put the marker file in', 'STATUS title= renames the card, underscores as spaces');
  assert.equal(c1.status, 'waiting', 'ACTION puts the card in Waiting');
  assert.equal(c1.decisions.filter(d => !d.resolvedAt).length, 1, 'ACTION opened a decision');
  {
    const rc = await req(port, 'GET', '/api/comments?cardId=t-task1', null, 'OWNER');
    const am = rc.body.comments.find(c => c.label === 'ACTION');
    assert.ok(am, 'the ACTION is a message in the card conversation');
    assert.equal(am.text, 'Merge or close PR 7.');
    assert.equal(am.by, 'op-test');
  }
  assert.equal(r.body.cards['t-op-cleanup'].severity, 'low');
  r = await req(
    port,
    'POST',
    '/api/boards/t/events',
    { rows: [{ label: 'REPLY', task: 'task1', text: 'The answer, with nothing of his left to answer.' }] },
    'OPS',
  );
  {
    const rc = await req(port, 'GET', '/api/comments?cardId=t-task1', null, 'OWNER');
    const rm = rc.body.comments.filter(c => c.label === 'REPLY');
    assert.ok(
      rm.some(c => c.text.startsWith('The answer, with nothing')),
      'a REPLY is a conversation message even with no unanswered message on the card',
    );
  }
  r = await req(
    port,
    'POST',
    '/api/boards/t/events',
    {
      rows: [
        { label: 'RELAYED', task: 'task1', text: 'Your word is in the pane.', body: 'What it authorises: the merge.' },
      ],
    },
    'OPS',
  );
  {
    const rc = await req(port, 'GET', '/api/comments?cardId=t-task1', null, 'OWNER');
    const rm = rc.body.comments.find(c => c.label === 'RELAYED');
    assert.ok(rm, "a RELAYED is a message in the card conversation even with nothing of Owner's to answer");
    assert.ok(rm.text.startsWith('Your word is in the pane.'), rm.text);
    assert.ok(rm.text.includes('What it authorises'), 'the body travels with it');
  }
  r = await req(
    port,
    'POST',
    '/api/boards/t/events',
    {
      rows: [
        { label: 'REPLY', task: 'task1', text: 'Owner merged it.' },
        { label: 'TASK_FINISHED', task: 'task1', text: 'landed' },
      ],
    },
    'OPS',
  );
  r = await req(port, 'GET', '/api/state', null, 'OWNER');
  assert.equal(r.body.cards['t-task1'].decisions.filter(d => !d.resolvedAt).length, 0, 'REPLY resolved the decision');
  assert.equal(r.body.cards['t-task1'].status, 'done');
  assert.equal(r.body.boards.t.shift.state, 'off', 'ordinary operator events never start a shift');
  // OPS: the operator's housekeeping about itself goes to a small log of its own, not General, not the board's
  // latest line
  {
    const before = (await req(port, 'GET', '/api/state', null, 'OWNER')).body,
      g0 = (await req(port, 'GET', '/api/comments?board=t&general=true', null, 'OWNER')).body.comments.length;
    r = await req(
      port,
      'POST',
      '/api/boards/t/events',
      { rows: [{ label: 'OPS', task: 'general', text: 'my watcher stopped; restarted it.' }] },
      'OPS',
    );
    assert.ok(r.body.results[0].ok, JSON.stringify(r.body));
    r = await req(port, 'GET', '/api/state', null, 'OWNER');
    assert.equal(r.body.boards.t.ops.length, 1);
    assert.equal(r.body.boards.t.ops[0].text, 'my watcher stopped; restarted it.');
    assert.equal(
      r.body.boards.t.activity.length,
      before.boards.t.activity.length,
      "an OPS note is not the board's latest line",
    );
    assert.equal(
      (await req(port, 'GET', '/api/comments?board=t&general=true', null, 'OWNER')).body.comments.length,
      g0,
      'an OPS note is not a General message',
    );
  }
  Object.assign(ctx, { port, dir, cid });
};
