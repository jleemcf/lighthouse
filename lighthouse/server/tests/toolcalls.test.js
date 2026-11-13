// The tool-call engine against the findings of its design's adversarial reviews (lighthouse/TOOLCALL-DESIGN.md).
// One test, one running server: its scenario groups (tests/toolcalls/*.js) run in order and share a ctx object.
// Run: node --test lighthouse/server/tests/toolcalls.test.js
'use strict';
const { test } = require('node:test');

const run =
  (...groups) =>
  async t => {
    const ctx = { t };
    for (const group of groups) await group(ctx);
  };

test(
  'tool calls: every review finding as a scenario',
  run(
    require('./toolcalls/start'),
    require('./toolcalls/messages'),
    require('./toolcalls/relay'),
    require('./toolcalls/authority'),
    require('./toolcalls/lines'),
    require('./toolcalls/chat'),
    require('./toolcalls/refusals'),
  ),
);
