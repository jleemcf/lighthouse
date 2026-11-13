'use strict';
require('../../tests/sandbox.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const https = require('node:https');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const makeJev = require('../jev');

for (const enabled of [false, true, undefined]) {
  test('server judge consent with a discovered credential: ' + String(enabled), async context => {
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-judge-'));
    context.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
    const keyFile = path.join(scratch, 'fixture.env');
    fs.writeFileSync(keyFile, 'TYPESAFE_API_KEY=synthetic-fixture\n');
    const previousUrl = process.env.LH_JEV_URL;
    process.env.LH_JEV_URL = 'http://127.0.0.1:1';
    context.after(() => {
      if (previousUrl === undefined) delete process.env.LH_JEV_URL;
      else process.env.LH_JEV_URL = previousUrl;
    });
    context.mock.method(https, 'request', () => assert.fail('tests must never reach a paid endpoint'));
    const calls = [];
    context.mock.method(http, 'request', (url, options, callback) => {
      assert.equal(url.hostname, '127.0.0.1');
      const request = new EventEmitter();
      request.end = body => {
        calls.push(JSON.parse(body));
        queueMicrotask(() => {
          const response = new PassThrough();
          response.statusCode = 200;
          callback(response);
          response.end(JSON.stringify({ answers: {} }));
        });
      };
      return request;
    });
    const cfg = { typesafeEnvFile: keyFile, gateMode: 'off' };
    if (enabled !== undefined) cfg.jevEnabled = enabled;
    const store = {
      comments: { note: { via: 'api', untagged: true, text: 'Fixture note' } },
      cards: {
        first: { id: 'first', board: 'fixture', title: 'One task' },
        second: { id: 'second', board: 'fixture', title: 'Another task' },
      },
    };
    const judge = makeJev({ cfg, store, now: () => new Date().toISOString(), slugOf: () => '' });
    assert.equal(judge.typesafeKey(), 'synthetic-fixture', 'credential lookup remains independent of consent');
    judge.judgeComment('note');
    judge.judgeCard('first');
    judge.judgeSpread(store.cards.first, [{ text: 'Fixture work', t: new Date().toISOString() }]);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls.length, enabled === false ? 0 : 3);
    assert.equal(Boolean(store.comments.note.judge), enabled !== false);
    assert.equal(Boolean(store.cards.first.judge), enabled !== false);
    assert.equal(Boolean(store.cards.first.spread), enabled !== false);
    assert.equal(judge.spreadPending.size, 0);
  });
}

test('fresh server example explicitly disables the paid judge', () => {
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, '../config.example.json')));
  assert.equal(config.jevEnabled, false);
});
