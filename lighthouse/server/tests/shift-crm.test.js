'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const { cardFixture } = require('./card-fixture');
const { wait } = require('./helpers');
const { testPort } = require('../../tests/sandbox.cjs');

for (const [protocol, modern, expected] of [
  ['tools', true, 'answered during working hours'],
  ['tools', false, 'with the operator'],
  ['lines', false, 'with the operator'],
])
  test('presence: CRM respects lost and legacy no-signal ' + protocol + ' ' + modern, async context => {
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'shift-crm-'));
    const keyFile = path.join(scratch, 'fixture.key');
    fs.writeFileSync(keyFile, 'synthetic-fixture');
    context.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
    const acks = [];
    let question = true;
    const crm = http.createServer((request, response) => {
      let text = '';
      request.on('data', chunk => (text += chunk));
      request.on('end', () => {
        response.setHeader('Content-Type', 'application/json');
        if (request.method === 'GET') {
          response.end(
            JSON.stringify({ questions: question ? [{ id: 'presence', text: 'What is the status?' }] : [] }),
          );
          question = false;
        } else {
          acks.push(JSON.parse(text));
          response.end('{}');
        }
      });
    });
    crm.listen(await testPort(), '127.0.0.1');
    await once(crm, 'listening');
    context.after(() => crm.close());
    const old = new Date(Date.now() - 3600000).toISOString();
    await cardFixture(
      context,
      {
        boards: {
          t: {
            id: 't',
            shift: {
              state: 'on',
              operator: 'operator',
              since: old,
              ...(modern ? { heartbeat: { t: old } } : {}),
              lastSeen: old,
            },
            instruments: { t: old },
          },
        },
      },
      {
        boards: { t: { protocol, access: { owner: 'owner', operator: 'operator' } } },
        crm: { base: 'http://127.0.0.1:' + crm.address().port, keyFile, board: 't', pollSec: 1 },
      },
    );
    for (let attempt = 0; attempt < 150 && !acks.length; attempt++) await wait(20);
    assert.equal(acks.length, 1);
    assert.equal(acks[0].note, expected);
  });
