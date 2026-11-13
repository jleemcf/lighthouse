'use strict';
const { testPort, spawnServer } = require('../../tests/sandbox.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { req, wait } = require('./helpers');

for (const configured of [false, true])
  test(`standing cards: ${configured ? 'listed slugs are excluded' : 'no exemptions by default'}`, async t => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lhstanding-'));
    const port = await testPort();
    const cfg = {
      port,
      bind: '127.0.0.1',
      storeFile: 'store.json',
      tokens: { OWNER: { name: 'reader', via: 'page' } },
      boards: { t: { access: { reader: 'owner' } }, other: { access: { reader: 'owner' } } },
      ...(configured ? { standingCards: ['team-mailbox'] } : {}),
    };
    const at = new Date(Date.now() - 25 * 3600000).toISOString();
    const recent = new Date(Date.now() - 60000).toISOString();
    const card = (board, slug) => ({
      id: board + '-' + slug,
      board,
      title: 'Team conversation',
      status: 'held',
      updatedAt: at,
      decisions: [],
      log: [
        ...Array.from({ length: configured && slug === 'team-mailbox' ? 60 : 12 }, () => ({
          t: recent,
          kind: 'STATUS',
          text: 'Work update',
        })),
        { t: recent, kind: 'FYI', event: 'task_finished', text: 'Delivered the previous report' },
        { t: recent, kind: 'ACTION', text: 'Consider another proposal?' },
      ],
    });
    const cards = [card('t', 'team-mailbox'), card('t', 'team-mailbox-followup'), card('other', 'team-mailbox')];
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(cfg));
    fs.writeFileSync(
      path.join(dir, 'store.json'),
      JSON.stringify({ cards: Object.fromEntries(cards.map(item => [item.id, item])), comments: {} }),
    );
    const env = { ...process.env };
    delete env.TYPESAFE_API_KEY;
    const child = spawnServer(path.join(dir, 'config.json'), {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    t.after(() => child.kill());
    let output = '';
    child.stdout.on('data', data => (output += data));
    child.stderr.on('data', data => (output += data));
    for (let attempt = 0; attempt < 80 && !output.includes('listening'); attempt++) await wait(50);
    assert.ok(output.includes('listening'), 'server started');
    for (const board of ['t', 'other']) {
      const response = await req(port, 'GET', `/api/boards/${board}/conduct?minutes=60`, null, 'OWNER');
      assert.equal(response.status, 200);
      const expected = cards.filter(item => item.board === board && (!configured || item.id.endsWith('-followup')));
      const expectedIds = expected.map(item => item.id).sort();
      assert.equal(response.body.stale.count, expected.length);
      assert.equal(response.body.signals.catchAll, expected.length);
      assert.equal(response.body.signals.afterDone, expected.length);
      for (const examples of [
        response.body.stale.examples,
        response.body.examples.catchAll,
        response.body.examples.afterDone,
      ])
        assert.deepEqual(examples.map(item => item.id).sort(), expectedIds);
    }
  });
