'use strict';
// Web Push without a dependency: VAPID (RFC 8292) and the aes128gcm content encoding (RFC 8291) on Node's own crypto.
// The board server uses it to reach Owner's phone and computers when something needs his attention. The push
// service (Apple's, Google's, Mozilla's) sees only ciphertext; the board's VAPID pair is made once and kept beside the
// config, and the private half never leaves the machine.
const crypto = require('crypto'),
  https = require('https'),
  http = require('http'),
  fs = require('fs');

const b64u = b => Buffer.from(b).toString('base64url');
const fromB64u = s => Buffer.from(String(s || ''), 'base64url');
const pad32 = d => (d.length >= 32 ? d : Buffer.concat([Buffer.alloc(32 - d.length), d]));

// The VAPID pair: {publicKey, privateKey} as base64url (the public key is the 65-byte uncompressed point the browser
// needs).
function loadKeys(file) {
  try {
    const k = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (k && k.publicKey && k.privateKey) return k;
  } catch (e) {}
  const k = generateKeys();
  fs.writeFileSync(file, JSON.stringify(k, null, 2), { mode: 0o600 });
  return k;
}
function generateKeys() {
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  return {
    publicKey: b64u(ecdh.getPublicKey()),
    privateKey: b64u(pad32(ecdh.getPrivateKey())),
    createdAt: new Date().toISOString(),
  };
}

// The Authorization header for one push: a signed JWT naming the push service's origin, and the public key it is
// checked with. The contact (sub) must be a real https or mailto address: Apple answers BadJwtToken to a placeholder.
function vapidHeader(endpoint, keys, subject) {
  const aud = new URL(endpoint).origin;
  const hdr = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const pay = b64u(
    JSON.stringify({
      aud,
      exp: Math.floor(Date.now() / 1000) + 12 * 3600,
      sub: subject || 'https://example.org/contact',
    }),
  );
  const pub = fromB64u(keys.publicKey),
    d = pad32(fromB64u(keys.privateKey));
  const jwk = { kty: 'EC', crv: 'P-256', x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33, 65)), d: b64u(d) };
  const key = crypto.createPrivateKey({ key: jwk, format: 'jwk' });
  const data = hdr + '.' + pay;
  const sig = crypto.sign('sha256', Buffer.from(data), { key, dsaEncoding: 'ieee-p1363' });
  return 'vapid t=' + data + '.' + b64u(sig) + ', k=' + keys.publicKey;
}

// RFC 8291: the payload encrypted to the subscription's keys, one record, aes128gcm framing. opts.asPrivate and
// opts.salt exist for the test vector only.
function encrypt(plaintext, sub, opts = {}) {
  const uaPub = fromB64u(sub.keys.p256dh),
    auth = fromB64u(sub.keys.auth);
  if (uaPub.length !== 65 || uaPub[0] !== 4)
    throw new Error('the subscription p256dh key is not a 65-byte uncompressed point');
  if (auth.length !== 16) throw new Error('the subscription auth secret is not 16 bytes');
  const as = crypto.createECDH('prime256v1');
  if (opts.asPrivate) as.setPrivateKey(opts.asPrivate);
  else as.generateKeys();
  const asPub = as.getPublicKey(),
    shared = as.computeSecret(uaPub);
  const salt = opts.salt || crypto.randomBytes(16);
  const { cek, nonce } = deriveKeys(shared, auth, uaPub, asPub, salt);
  const c = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const body = Buffer.concat([
    c.update(Buffer.concat([Buffer.from(plaintext), Buffer.from([2])])),
    c.final(),
    c.getAuthTag(),
  ]); // 0x02: the last record's delimiter
  const rs = Buffer.alloc(4);
  rs.writeUInt32BE(4096);
  return Buffer.concat([salt, rs, Buffer.from([asPub.length]), asPub, body]);
}
function deriveKeys(shared, auth, uaPub, asPub, salt) {
  const ikm = Buffer.from(
    crypto.hkdfSync('sha256', shared, auth, Buffer.concat([Buffer.from('WebPush: info\0'), uaPub, asPub]), 32),
  );
  const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  return { cek, nonce };
}
// The reverse, as a browser would do it: for the tests (uaPrivate is the subscriber's raw private key).
function decrypt(body, uaPrivate, authB64u) {
  const salt = body.subarray(0, 16),
    idlen = body[20],
    asPub = body.subarray(21, 21 + idlen),
    ct = body.subarray(21 + idlen);
  const ua = crypto.createECDH('prime256v1');
  ua.setPrivateKey(uaPrivate);
  const uaPub = ua.getPublicKey(),
    shared = ua.computeSecret(asPub);
  const { cek, nonce } = deriveKeys(shared, fromB64u(authB64u), uaPub, asPub, salt);
  const d = crypto.createDecipheriv('aes-128-gcm', cek, nonce);
  d.setAuthTag(ct.subarray(ct.length - 16));
  const plain = Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()]);
  const end = plain.lastIndexOf(2);
  return plain.subarray(0, end).toString('utf8');
}

// One push to one subscription. Resolves, never rejects: {ok, status, error, drop}; drop means the subscription is gone
// (404 or 410) and should be forgotten.
function send(sub, payload, keys, opts = {}) {
  return new Promise(resolve => {
    let body, auth;
    try {
      body = encrypt(typeof payload === 'string' ? payload : JSON.stringify(payload), sub);
      auth = vapidHeader(sub.endpoint, keys, opts.subject);
    } catch (e) {
      return resolve({ ok: false, status: 0, error: e.message, drop: true });
    }
    let u;
    try {
      u = new URL(sub.endpoint);
    } catch (e) {
      return resolve({ ok: false, status: 0, error: 'bad endpoint', drop: true });
    }
    const mod = u.protocol === 'http:' ? http : https;
    const headers = {
      'Content-Type': 'application/octet-stream',
      'Content-Encoding': 'aes128gcm',
      'Content-Length': body.length,
      TTL: String(opts.ttl == null ? 86400 : opts.ttl),
      Urgency: opts.urgency || 'high',
      Authorization: auth,
    };
    const req = mod.request(u, { method: 'POST', headers }, res => {
      let d = '';
      res.setEncoding('utf8');
      res.on('data', c => (d += c));
      res.on('end', () =>
        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 300,
          status: res.statusCode,
          error: res.statusCode >= 300 ? d.slice(0, 200) : null,
          drop: res.statusCode === 404 || res.statusCode === 410,
        }),
      );
      res.on('error', error => resolve({ ok: false, status: 0, error: error.message, drop: false }));
      res.on('aborted', () => resolve({ ok: false, status: 0, error: 'response aborted', drop: false }));
    });
    req.on('error', e => resolve({ ok: false, status: 0, error: e.message, drop: false }));
    req.setTimeout(15000, () => req.destroy(new Error('timeout')));
    req.end(body);
  });
}

module.exports = { loadKeys, generateKeys, vapidHeader, encrypt, decrypt, send, b64u, fromB64u };
