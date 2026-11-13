'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { handoffFixture } = require('./handoff-fixture');
const { watch } = require('../../operator-kit/scripts/shift-session.cjs');

for (const at of ['attachment', 'heartbeat'])
  test('kit adopts page-accepted epoch after stale ' + at + ' without acknowledging pickup', async context => {
    const f = handoffFixture(context);
    context.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
    const file = path.join(f.home, 'session-test.json');
    const identity = {
      sessionId: f.second.sessionId,
      epoch: 1,
      processId: 'test-process',
      file,
      credential: 'synthetic-fixture-only',
      headers: { 'X-Lighthouse-Epoch': '1' },
    };
    fs.writeFileSync(file, JSON.stringify(identity), { mode: 0o600 });
    let beats = 0;
    let attachments = 0;
    let accepted = false;
    const accept = () => {
      f.prepare();
      f.save();
      f.seal();
      f.accept();
      accepted = true;
    };
    if (at === 'attachment') accept();
    const stop = watch({
      board: 'tools',
      identity,
      shadow: () => false,
      request: async (method, route, body) => {
        try {
          const who = { ...f.second, epoch: identity.epoch };
          if (method === 'GET') return { status: 200, body: f.ctx.handoff.status('tools') };
          if (route.endsWith('/ownership')) {
            attachments++;
            if (!accepted) {
              accept();
              return { status: 200 };
            }
            f.ctx.ownership.control('tools', who, body);
          } else {
            f.ctx.transact(
              () => {},
              () => f.ctx.ownership.renew(who, 'tools', identity.epoch, identity.processId),
            );
            beats++;
          }
          return { status: 200 };
        } catch (error) {
          return { status: error.status || 409, body: { error: error.message } };
        }
      },
    });
    context.after(stop);
    const settle = async () => {
      for (let turn = 0; turn < 30; turn++) await Promise.resolve();
    };
    await settle();
    assert.equal(identity.epoch, 2);
    assert.equal(JSON.parse(fs.readFileSync(file)).epoch, 2);
    context.mock.timers.tick(5000);
    await settle();
    assert.equal(attachments, 2);
    assert.equal(beats, 1);
    assert.equal(f.ctx.ownership.record('tools').phase, 'pickup');
    assert.equal(f.ctx.ownership.record('tools').holderSessionId, identity.sessionId);
    f.ctx.ownership.record('tools').leaseUntil = Date.now() - 1;
    assert.throws(() => f.pickup(), /expired|lost/);
    assert.equal(f.ctx.ownership.record('tools').phase, 'pickup');
  });
