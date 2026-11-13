'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { wait } = require('./helpers');
const makeCrm = require('../crm');
const makeJev = require('../jev');
const push = require('../push');

function responseFixture(context, body, event, status = 200) {
  const response = new PassThrough();
  response.statusCode = status;
  response.on('error', () => {});
  context.after(() => response.destroy());
  context.mock.method(http, 'request', (url, options, receive) => {
    assert.equal(url.hostname, '127.0.0.1');
    const request = new EventEmitter();
    request.setTimeout = () => {};
    request.write = () => {};
    request.end = () =>
      queueMicrotask(() => {
        receive(response);
        if (event) response.emit(event, new Error('fixture response failure'));
        else {
          const bytes = Buffer.from(body);
          const split = bytes.indexOf(Buffer.from('🕒')) + 1;
          response.write(bytes.subarray(0, split));
          response.end(bytes.subarray(split));
        }
      });
    return request;
  });
}

async function within(promise) {
  let deadline;
  try {
    return await Promise.race([
      promise,
      new Promise((resolve, reject) => (deadline = setTimeout(() => reject(new Error('reader hung')), 200))),
    ]);
  } finally {
    clearTimeout(deadline);
  }
}

for (const event of [null, 'aborted', 'error']) {
  test(`CRM response reader handles ${event || 'split UTF-8'}`, async context => {
    responseFixture(context, JSON.stringify({ questions: [], cursor: '🕒 café' }), event);
    let poll;
    const timeout = context.mock.method(global, 'setTimeout', callback => {
      poll = callback;
      return { unref() {} };
    });
    const interval = context.mock.method(global, 'setInterval', () => ({ unref() {} }));
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-crm-reader-'));
    context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const keyFile = path.join(directory, 'fixture.key');
    fs.writeFileSync(keyFile, 'fixture-only');
    const store = { boards: { test: {} }, crm: { outbox: [], delivered: {} } };
    makeCrm({
      cfg: { crm: { base: 'http://127.0.0.1:12345', board: 'test', keyFile } },
      CONFIG_PATH: path.join(directory, 'fixture.json'),
      store,
      now: () => new Date().toISOString(),
      save() {},
    });
    timeout.mock.restore();
    interval.mock.restore();
    await within(poll());
    if (event) assert.match(store.crm.fault, /aborted|fixture response failure/);
    else assert.equal(store.crm.cursor, '🕒 café');
  });

  test(`Jev response reader handles ${event || 'split UTF-8'}`, async context => {
    responseFixture(context, JSON.stringify({ answers: { same_as: { choice: '🕒 café', confidence: 1 } } }), event);
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-reader-'));
    context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const keyFile = path.join(directory, 'fixture.env');
    fs.writeFileSync(keyFile, 'TYPESAFE_API_KEY=fixture-only');
    const previousUrl = process.env.LH_JEV_URL;
    process.env.LH_JEV_URL = 'http://127.0.0.1:12345';
    context.after(() => {
      if (previousUrl === undefined) delete process.env.LH_JEV_URL;
      else process.env.LH_JEV_URL = previousUrl;
    });
    const card = { id: 'subject', board: 'test', title: 'Subject' };
    const judge = makeJev({
      cfg: { typesafeEnvFile: keyFile },
      store: { cards: { subject: card, other: { id: 'other', board: 'test' } } },
      now: () => new Date().toISOString(),
      slugOf: (board, identity) => identity,
    });
    judge.judgeCard(card.id);
    for (let attempt = 0; attempt < 40 && !card.judge; attempt++) await wait(5);
    assert.ok(card.judge, 'reader hung');
    if (event) assert.match(card.judge.error, /aborted|fixture response failure/);
    else assert.equal(card.judge.sameAs, '🕒 café');
  });

  test(`push response reader handles ${event || 'split UTF-8'}`, async context => {
    responseFixture(context, '🕒 café', event, 500);
    const subscription = {
      endpoint: 'http://127.0.0.1:12345/push',
      keys: {
        p256dh: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
        auth: 'BTBZMqHH6r4Tts7J_aSIgg',
      },
    };
    const result = await within(push.send(subscription, 'Fixture', push.generateKeys()));
    assert.equal(result.ok, false);
    assert.equal(result.drop, false);
    if (event) {
      assert.equal(result.status, 0);
      assert.match(result.error, /aborted|fixture response failure/);
    } else assert.equal(result.error, '🕒 café');
  });
}
