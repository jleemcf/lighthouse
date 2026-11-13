// The push module against the published test vector (RFC 8291, appendix A), a round trip, and the VAPID header.
// Run: node --test lighthouse/server/tests/push.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const push = require('../push');

test('RFC 8291 test vector: the same keys and salt give the same bytes', () => {
  const sub = {
    endpoint: 'https://push.example.net/x',
    keys: {
      p256dh: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
      auth: 'BTBZMqHH6r4Tts7J_aSIgg',
    },
  };
  const out = push.encrypt('When I grow up, I want to be a watermelon', sub, {
    asPrivate: push.fromB64u('yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw'),
    salt: push.fromB64u('DGv6ra1nlYgDCS1FRnbzlw'),
  });
  assert.equal(
    push.b64u(out),
    'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8w' +
      'EqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
  );
  assert.equal(
    push.decrypt(out, push.fromB64u('q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94'), sub.keys.auth),
    'When I grow up, I want to be a watermelon',
  );
});

test('a round trip with fresh keys, and a VAPID header the push service can check', () => {
  const ua = crypto.createECDH('prime256v1');
  ua.generateKeys();
  const auth = crypto.randomBytes(16);
  const sub = {
    endpoint: 'https://web.push.apple.com/abc',
    keys: { p256dh: push.b64u(ua.getPublicKey()), auth: push.b64u(auth) },
  };
  const body = push.encrypt(JSON.stringify({ title: 'Needs you', body: 'a card' }), sub);
  assert.equal(body.readUInt32BE(16), 4096);
  assert.equal(body[20], 65);
  assert.deepEqual(JSON.parse(push.decrypt(body, ua.getPrivateKey(), sub.keys.auth)), {
    title: 'Needs you',
    body: 'a card',
  });

  const keys = push.generateKeys();
  const h = push.vapidHeader(sub.endpoint, keys, 'mailto:someone@example.com');
  const m = /^vapid t=([^,]+), k=(.+)$/.exec(h);
  assert.ok(m, h);
  assert.equal(m[2], keys.publicKey);
  const [hdr, pay, sig] = m[1].split('.');
  assert.deepEqual(JSON.parse(Buffer.from(hdr, 'base64url').toString()), { typ: 'JWT', alg: 'ES256' });
  const claims = JSON.parse(Buffer.from(pay, 'base64url').toString());
  assert.equal(claims.aud, 'https://web.push.apple.com');
  assert.equal(claims.sub, 'mailto:someone@example.com');
  assert.ok(claims.exp > Date.now() / 1000);
  const pub = push.fromB64u(keys.publicKey);
  const pubKey = crypto.createPublicKey({
    key: { kty: 'EC', crv: 'P-256', x: push.b64u(pub.subarray(1, 33)), y: push.b64u(pub.subarray(33, 65)) },
    format: 'jwk',
  });
  assert.ok(
    crypto.verify(
      'sha256',
      Buffer.from(hdr + '.' + pay),
      { key: pubKey, dsaEncoding: 'ieee-p1363' },
      push.fromB64u(sig),
    ),
    'the signature checks with the public key',
  );
});
