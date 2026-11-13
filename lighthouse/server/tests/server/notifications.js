'use strict';
const { testPort, spawnServer } = require('../../../tests/sandbox.cjs');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { req, rawReq, wait } = require('../helpers');

// Notifications: Owner subscribes a device, an ask reaches it encrypted, the per-board switches, the test push, a
// renewed subscription, the device dropped on 410, and the home-screen app's files.
module.exports = async function notifications(ctx) {
  const { t } = ctx;
  const crypto = require('node:crypto');
  const push = require('../../push');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lhsrv-'));
  const port = await testPort();
  const cfg = {
    port,
    bind: '127.0.0.1',
    storeFile: 'store.json',
    tokens: {
      OWNER: { name: 'owner', via: 'page' },
      OPS: { name: 'op-test', via: 'api' },
      WATCH: { name: 'op-watch', via: 'api' },
    },
    boards: {
      t: { name: 'Test', access: { owner: 'owner', 'op-test': 'operator', 'op-watch': 'watch' } },
      w: { name: 'Watch', access: { owner: 'owner', 'op-watch': 'operator' } },
    },
  };
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(cfg));
  fs.writeFileSync(path.join(dir, 'store.json'), JSON.stringify({ cards: {}, comments: {} }));
  // a stand-in push service: records every delivery; answers 410 for one endpoint
  const got = [];
  const svc = http.createServer((rq, rs) => {
    const ch = [];
    rq.on('data', c => ch.push(c));
    rq.on('end', () => {
      got.push({ path: rq.url, headers: rq.headers, body: Buffer.concat(ch) });
      if (rq.url === '/gone') {
        rs.writeHead(410);
        rs.end();
      } else {
        rs.writeHead(201);
        rs.end();
      }
    });
  });
  await new Promise(r => svc.listen(0, '127.0.0.1', r));
  const sport = svc.address().port;
  t.after(() => svc.close());
  const child = spawnServer(path.join(dir, 'config.json'), {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout.on('data', d => (out += d));
  child.stderr.on('data', d => (out += d));
  t.after(() => child.kill());
  for (let i = 0; i < 40 && !out.includes('listening'); i++) await wait(100);
  const ua = crypto.createECDH('prime256v1');
  ua.generateKeys();
  const auth = crypto.randomBytes(16);
  const subscription = {
    endpoint: `http://127.0.0.1:${sport}/phone`,
    keys: { p256dh: push.b64u(ua.getPublicKey()), auth: push.b64u(auth) },
  };
  // Owner's alone
  let r = await req(port, 'GET', '/api/push', null, 'OPS');
  assert.equal(r.status, 403);
  r = await req(port, 'GET', '/api/push', null, 'OWNER');
  assert.equal(r.status, 200);
  assert.equal(push.fromB64u(r.body.key).length, 65, 'a VAPID public key');
  assert.deepEqual(r.body.devices, []);
  assert.ok(fs.existsSync(path.join(dir, 'vapid.json')), 'the pair is kept beside the config');
  const key = r.body.key;
  r = await req(port, 'POST', '/api/push/subscribe', { subscription, device: 'iPhone' }, 'OWNER');
  assert.equal(r.status, 200);
  const mine = r.body.mine;
  assert.deepEqual(r.body.devices[0].boards, { t: true, w: true }, 'every board on to begin with');
  r = await req(port, 'GET', '/api/push?endpoint=' + encodeURIComponent(subscription.endpoint), null, 'OWNER');
  assert.equal(r.body.mine, mine, 'the page finds its own device by endpoint');
  // an ask opened by the operator reaches the device, encrypted to its keys, signed with the board's key
  r = await req(
    port,
    'POST',
    '/api/boards/t/events',
    {
      rows: [
        { label: 'TASK_CREATED', task: 'deploy', title: 'Deploy the thing', text: 'Deploy.' },
        { label: 'ACTION', task: 'deploy', text: 'Approve the deploy to production?' },
      ],
    },
    'OPS',
  );
  assert.ok(r.body.results[1].ok);
  for (let i = 0; i < 50 && got.length < 1; i++) await wait(100);
  assert.equal(got.length, 1, 'one push for one ask');
  assert.equal(got[0].path, '/phone');
  assert.equal(got[0].headers['content-encoding'], 'aes128gcm');
  assert.ok(
    got[0].headers['authorization'].startsWith('vapid t=') && got[0].headers['authorization'].endsWith(', k=' + key),
    got[0].headers['authorization'],
  );
  assert.equal(got[0].headers['ttl'], '86400');
  let msg = JSON.parse(push.decrypt(got[0].body, ua.getPrivateKey(), subscription.keys.auth));
  assert.equal(msg.kind, 'ask');
  assert.equal(msg.title, 'Needs you: Test');
  assert.equal(msg.body, 'Deploy the thing: Approve the deploy to production?');
  assert.equal(msg.url, '/#card=t-deploy');
  assert.equal(msg.tag, 't-deploy');
  // a STATUS on the same card opens nothing new: no push; a second ACTION does
  r = await req(
    port,
    'POST',
    '/api/boards/t/events',
    { rows: [{ label: 'STATUS', task: 'deploy', text: 'Still waiting on you.' }] },
    'OPS',
  );
  await wait(300);
  assert.equal(got.length, 1, 'no push without a new ask');
  r = await req(
    port,
    'POST',
    '/api/boards/t/events',
    { rows: [{ label: 'ACTION', task: 'deploy', text: 'Or should I hold?' }] },
    'OPS',
  );
  for (let i = 0; i < 50 && got.length < 2; i++) await wait(100);
  assert.equal(got.length, 2);
  // a notice from the watch reaches the device for the board it corrects
  r = await req(
    port,
    'POST',
    '/api/boards/w/events',
    { rows: [{ label: 'NOTICE', task: 't', text: 'label your lines' }] },
    'WATCH',
  );
  assert.ok(r.body.results[0].ok, JSON.stringify(r.body));
  for (let i = 0; i < 50 && got.length < 3; i++) await wait(100);
  assert.equal(got.length, 3);
  msg = JSON.parse(push.decrypt(got[2].body, ua.getPrivateKey(), subscription.keys.auth));
  assert.equal(msg.kind, 'notice');
  assert.equal(msg.title, 'Watch notice for Test');
  assert.equal(msg.url, '/#board=t');
  // the board switched off on this device: silence; a test push still goes
  r = await req(port, 'POST', '/api/push/settings', { id: mine, boards: { t: false } }, 'OWNER');
  assert.deepEqual(r.body.devices[0].boards, { t: false, w: true });
  r = await req(
    port,
    'POST',
    '/api/boards/t/events',
    { rows: [{ label: 'ACTION', task: 'deploy', text: 'Third ask.' }] },
    'OPS',
  );
  await wait(300);
  assert.equal(got.length, 3, 'switched off, nothing sent');
  r = await req(port, 'POST', '/api/push/test', { id: mine }, 'OWNER');
  assert.equal(r.status, 200);
  assert.equal(got.length, 4);
  assert.equal(got[3].headers['ttl'], '60');
  assert.ok(r.body.devices[0].lastOk);
  // a renewed subscription keeps the old one's switches; a device the service says is gone is forgotten
  const sub2 = { endpoint: `http://127.0.0.1:${sport}/gone`, keys: subscription.keys };
  r = await req(
    port,
    'POST',
    '/api/push/subscribe',
    { subscription: sub2, oldEndpoint: subscription.endpoint },
    'OWNER',
  );
  assert.equal(r.body.devices.length, 1);
  assert.equal(r.body.devices[0].device, 'iPhone');
  assert.deepEqual(r.body.devices[0].boards, { t: false, w: true });
  assert.equal(r.body.mine, mine, 'the same device, renewed');
  r = await req(
    port,
    'POST',
    '/api/boards/w/events',
    { rows: [{ label: 'ACTION', task: 'x', text: 'Ask on w.' }] },
    'WATCH',
  );
  for (let i = 0; i < 50 && got.length < 5; i++) await wait(100);
  assert.equal(got.length, 5);
  await wait(400);
  r = await req(port, 'GET', '/api/push', null, 'OWNER');
  assert.deepEqual(r.body.devices, [], 'gone (410) is forgotten');
  // the files the home-screen app needs are served without identity
  r = await rawReq(port, 'GET', '/manifest.webmanifest');
  assert.equal(r.status, 200);
  assert.equal(r.body.display, 'standalone');
  r = await rawReq(port, 'GET', '/sw.js');
  assert.equal(r.status, 200);
  assert.equal(r.headers['service-worker-allowed'], '/');
  r = await rawReq(port, 'GET', '/icon-192.png');
  assert.equal(r.status, 200);
  assert.equal(r.headers['content-type'], 'image/png');
};
