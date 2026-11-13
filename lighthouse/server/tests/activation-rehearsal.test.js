'use strict';
const { test } = require('node:test');
test(
  'ThreeBoardUpgradeAndRollbackParity using real installed MCP processes',
  { skip: process.platform !== 'linux' && 'staged host deployment rehearsal runs in Linux/WSL' },
  context => require('../../verification/activation-rehearsal.cjs').rehearsed(context),
);
