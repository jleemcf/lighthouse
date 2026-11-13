'use strict';
require('../../tests/sandbox.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const https = require('node:https');
const makeJev = require('../jev');
const makeConduct = require('../conduct');

for (const previousVerdict of [false, true]) {
  test('disabled judge with a key keeps volume fallback; previous verdict: ' + previousVerdict, context => {
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-judge-conduct-'));
    context.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
    const keyFile = path.join(scratch, 'fixture.env');
    fs.writeFileSync(keyFile, 'TYPESAFE_API_KEY=synthetic-fixture\n');
    context.mock.method(http, 'request', () => assert.fail('disabled judge must not request'));
    context.mock.method(https, 'request', () => assert.fail('tests must never reach a paid endpoint'));
    const at = new Date().toISOString();
    const card = {
      id: 'fixture-busy',
      board: 'fixture',
      title: 'Busy work',
      status: 'inflight',
      log: Array.from({ length: 12 }, () => ({ kind: 'STATUS', t: at, text: 'Work news' })),
      ...(previousVerdict ? { spread: { t: at, upTo: at, many: 0.1 } } : {}),
    };
    const ctx = {
      cfg: { jevEnabled: false, typesafeEnvFile: keyFile },
      store: { boards: { fixture: {} }, cards: { [card.id]: card }, comments: {} },
      now: () => at,
      slugOf: () => '',
      isStandingCard: () => false,
      isWatchOn: () => false,
      plainWords: text => text,
      staleCards: () => [],
      ST: { health: () => ({}) },
    };
    Object.assign(ctx, makeJev(ctx));
    assert.equal(ctx.typesafeKey(), 'synthetic-fixture');
    const report = makeConduct(ctx).conductOf('fixture', 60);
    assert.equal(report.signals.catchAll, 1);
    assert.deepEqual(report.examples.catchAll, [{ id: card.id, n: 12, text: card.title, judged: false }]);
    assert.equal(report.jev.note, 'disabled by configuration');
  });
}
