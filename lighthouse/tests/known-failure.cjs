'use strict';
const { test } = require('node:test');

function knownFailure(flow, rule, prepare) {
  test(`${flow}: ${rule} fixture`, async context => {
    const check = await prepare(context);
    await context.test(
      `${rule} [scout flow: ${flow}]`,
      { todo: process.env.TEST_KNOWN_FAILURES_STRICT !== '1' && 'confirmed pre-publication defect' },
      check,
    );
  });
}

module.exports = { knownFailure };
