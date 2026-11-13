'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
test(
  'ThreeBoardUpgradeRehearsalPreservesEveryCardRolePolicyClockAndLane',
  {
    skip: process.platform !== 'linux' && 'run the rehearsal in Linux or WSL',
    timeout: 120000,
  },
  async context => {
    const result = await require('../../verification/upgrade-rehearsal.cjs').rehearse(context);
    assert.equal(result.fixtureOnly, true);
    assert.equal(result.boardCount, 3);
    assert.equal(result.cardCount, 3);
    assert.deepEqual(
      result.operators.map(operator => operator.protocol),
      ['tools', 'tools', 'lines'],
    );
  },
);
