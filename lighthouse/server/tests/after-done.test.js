'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const makeConduct = require('../conduct');

function report(asks, finished = 'Delivered the fix. Live and working.', completion = true) {
  const at = new Date().toISOString();
  const card = {
    id: 't-fix',
    board: 't',
    title: 'Repair the export',
    status: 'inflight',
    log: [
      { t: at, kind: 'STATUS', text: finished, ...(completion ? { event: 'task_finished' } : {}) },
      ...asks.map(ask => ({ t: at, ...ask })),
    ],
  };
  return makeConduct({
    cfg: {},
    store: { boards: { t: {} }, cards: { 't-fix': card }, comments: {} },
    isStandingCard: () => false,
    isWatchOn: () => false,
    plainWords: text => text,
    judgeActive: () => false,
    staleCards: () => [],
    ST: { health: () => ({}) },
  }).conductOf('t', 60);
}

for (const kind of ['ACTION', 'PROMPT']) {
  for (const text of [
    'Shall I tell the requester the fix is live?',
    'Should I let the requester know it is fixed?',
    'Can I notify the team that it is done?',
    "Can I tell the requester that it's fixed?",
    'Shall I post the "fix is live" note to the person who asked?',
    'Would you like me to announce that it is live and working?',
    'Should I let the team and the requester know the fix is live?',
    'Should I tell the team and the requester the fix is live?',
    'Can I notify the requester that the new dashboard is live?',
    'Shall I post the "new dashboard is live" note to the team and requester?',
    'Should I announce that the new dashboard is live?',
    'Shall I post the "fix is live" note to Sam and Alex?',
  ])
    test(kind + ' leaves completion notification alone: ' + text, () => {
      assert.equal(report([{ kind, text }]).signals.afterDone, 0);
      assert.equal(report([{ kind, text }], 'Live and working').signals.afterDone, 0);
    });

  for (const text of [
    'Shall I start on the follow-up export as well?',
    'Should I fix the notification service?',
    'Shall I post the note proposing a new dashboard?',
    'Tell the team to build another export when this is done?',
    'Shall I notify the team that the fix is live and start the next export?',
    'Should I announce a new dashboard now that the fix is live?',
    'Shall I tell the team to test the export now that the fix is live?',
    'Shall I notify the team that the fix is live? Can I add CSV support?',
    'Shall I post the "fix is live" note to the team and test the export?',
    'Shall I post the "fix is live" note to the team and ask them to test the export?',
    'Shall I post the "fix is live" note to the team and verify the export?',
  ])
    test(kind + ' still flags new work: ' + text, () => {
      assert.equal(report([{ kind, text }]).signals.afterDone, 1);
    });
}

test('a completion notification does not conceal a later new request', () => {
  const result = report([
    { kind: 'ACTION', text: 'Shall I tell the team the fix is live?' },
    { kind: 'PROMPT', text: 'Start another export?' },
  ]);
  assert.equal(result.signals.afterDone, 1);
  assert.match(result.examples.afterDone[0].text, /Start another export/);
});

test('relaying merge instructions and finishing release steps do not finish the task', () => {
  const steps = [
    'The presentation SQL PR passed its checks (PR 123). After its fresh start, firstmate asked whether it ' +
      'may merge. Your earlier Send already said "merged on green", so I re-delivered those exact words, ' +
      'and it merges now. Its deploy changes the production database, so it goes out as a coordinated ' +
      'application release when the lane is free. Switching on still waits for your OK.',
    'The presentation SQL merged on green (PR 123, database change 0042), and its deploy started.',
    'The presentation SQL is live. Database change 0042 was applied with the application release.',
  ];
  const prompt = { kind: 'PROMPT', text: 'Resume the feature from the saved records; both views need a fresh upload' };
  // Confirm the old unanchored alternative mistakes the relay verb for a finish.
  assert.equal(/\b(delivered|closed[- ]out)\b/i.exec(steps[0])[0], 'delivered');
  for (const step of steps) {
    const result = report([prompt], step, false);
    assert.equal(result.signals.afterDone, 0, step);
    assert.equal(result.hints.afterDone.count, 0, step);
  }
  const result = report([...steps.slice(1).map(text => ({ kind: 'STATUS', text })), prompt], steps[0], false);
  assert.equal(result.signals.afterDone, 0);
  assert.deepEqual(result.examples.afterDone, []);
  assert.equal(result.hints.afterDone.count, 0);
});

test('explicit task finishes still flag a new ask', () => {
  for (const finished of [
    'Finished: repaired the export.',
    'The task is done; the export works.',
    'Task done.',
    'Delivered the repaired export.',
    'Closed out the export repair.',
  ]) {
    const result = report([{ kind: 'ACTION', text: 'Add a second export format?' }], finished);
    assert.equal(result.signals.afterDone, 1, finished);
    assert.match(result.examples.afterDone[0].text, /Add a second export format/);
    const legacy = report([{ kind: 'ACTION', text: 'Add a second export format?' }], finished, false);
    assert.equal(legacy.signals.afterDone, 0, finished);
    assert.equal(legacy.hints.afterDone.certainty, 'uncertain');
    assert.equal(legacy.hints.afterDone.count, 1, finished);
  }
});

test('generated step reports never become authoritative completion from wording', () => {
  let checked = 0;
  for (const prefix of ['Finished', 'Done', 'Delivered', 'Closed out', 'Complete', 'Completed', 'Task done'])
    for (const step of ['preflight', 'validation', 'handoff', 'the release', 'the first export'])
      for (const suffix of ['; implementation still pending.', '; approval still needed.', '; remaining work follows.'])
        for (const kind of ['ACTION', 'PROMPT']) {
          const text = prefix + ' ' + step + suffix;
          const result = report([{ kind, text: 'May I implement the remaining export?' }], text, false);
          assert.equal(result.signals.afterDone, 0, text);
          assert.equal(result.hints.afterDone.certainty, 'uncertain');
          assert.equal(result.hints.afterDone.count, 1, text);
          checked++;
        }
  assert.equal(checked, 210);
});
