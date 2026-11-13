// Functional test of the board server's API: spawns the server on a free port with a temp config and store.
// Each test runs its scenario groups (tests/server/*.js) in order against one running server, sharing a ctx object.
// Run: node --test lighthouse/server/tests/server.test.js
'use strict';
const { test } = require('node:test');

const run =
  (...groups) =>
  async t => {
    const ctx = { t };
    for (const group of groups) await group(ctx);
  };

test(
  'board server end to end',
  run(
    require('./server/e2e-lines'),
    require('./server/e2e-prompts'),
    require('./server/e2e-transcript'),
    require('./server/e2e-conversation'),
  ),
);

test(
  'the watch operator: NOTICE, its settlement by OPS, the instruments pulse and the conduct report',
  run(require('./server/watch')),
);

test(
  'notifications: Owner subscribes a device, an ask reaches it encrypted, the switches and the drop on 410',
  run(require('./server/notifications')),
);

test(
  'the board talks back: refusals and corrections become notes the board watch prints to the operator',
  run(require('./server/talkback')),
);

test('stale cards draw one gentle reminder per board', run(require('./server/stale')));

test(
  'the CRM question lane: fetch, the staff line, received and working, the answer with its file, needs_owner, ' +
    'retries by id',
  run(require('./server/crm')),
);
