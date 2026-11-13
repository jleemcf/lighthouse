'use strict';
// Notifications: Web Push (push.js speaks the protocol) to every device of Owner's that has the board switched on,
// when an operator opens an ask on a card or the watch leaves a notice; and the /api/push routes that list his
// devices and set their switches. The device's switches live on its subscription here, so any device can set
// another's.
const path = require('path'),
  push = require('./push');

module.exports = function makeNotify(ctx) {
  const { cfg, CONFIG_PATH, store, now, newId, save, isOwner, roleOn, send, readBody } = ctx;
  const VAPID_FILE = path.resolve(path.dirname(CONFIG_PATH), cfg.vapidFile || 'vapid.json');
  let VAPID = null;
  const vapid = () => VAPID || (VAPID = push.loadKeys(VAPID_FILE));
  const owns = (who, subscription) =>
    subscription.by === who?.name && (subscription.installationId || null) === (who?.installationId || null);
  const visibleBoards = who => Object.keys(store.boards).filter(board => roleOn(who, board) >= 1);
  const pushDevices = who =>
    Object.values(store.push.subs)
      .filter(subscription => owns(who, subscription))
      .map(s => ({
        id: s.id,
        device: s.device,
        boards: Object.fromEntries(visibleBoards(who).map(board => [board, !!s.boards?.[board]])),
        createdAt: s.createdAt,
        lastOk: s.lastOk || null,
        lastError: s.lastError || null,
      }))
      .sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
  function notify(board, msg) {
    if (ctx.inTransaction?.()) return ctx.afterCommit(() => notify(board, msg));
    ctx.registry?.refresh();
    const subs = Object.values(store.push.subs).filter(subscription => {
      let principal = { name: subscription.by };
      if (subscription.installationId) {
        const installed = ctx.registry?.credentials().installations[subscription.installationId];
        if (!installed || installed.revoked) return false;
        principal = {
          name: installed.scope.principal,
          board: installed.scope.boardId,
          installationId: installed.id,
          installationRole: installed.scope.role,
          installationVersion: installed.version,
        };
      }
      return subscription.boards?.[board] && roleOn(principal, board) >= 1;
    });
    if (!subs.length) return;
    let keys;
    try {
      keys = vapid();
    } catch (e) {
      console.log('push: no keys: ' + e.message);
      return;
    }
    const payload = Object.assign({ board, boardName: (store.boards[board] || {}).name || board, t: now() }, msg);
    for (const s of subs)
      push.send(s, payload, keys, { subject: cfg.pushSubject }).then(r => {
        if (r.ok) {
          s.lastOk = now();
          s.failures = 0;
          s.lastError = null;
        } else {
          s.failures = (s.failures || 0) + 1;
          s.lastError = `${r.status} ${r.error || ''}`.trim();
          console.log(`push to ${s.device} failed: ${s.lastError}`);
          if (r.drop) {
            delete store.push.subs[s.id];
            console.log(`push: ${s.device} is gone (${r.status}), forgotten`);
          }
        }
        save();
      });
  }

  // Owner's devices and their switches; his alone
  async function pushRoutes(req, res, { q, p, who, cors }) {
    if (!isOwner(who)) return send(res, 403, { error: 'owner only' }, cors);
    const subs = store.push.subs;
    if (req.method === 'GET' && p === '/api/push') {
      let key;
      try {
        key = vapid().publicKey;
      } catch (e) {
        return send(res, 500, { error: 'no push keys: ' + e.message }, cors);
      }
      const mine = q.endpoint ? Object.values(subs).find(s => owns(who, s) && s.endpoint === q.endpoint) : null;
      return send(
        res,
        200,
        { key, devices: pushDevices(who), mine: mine ? mine.id : null, boards: visibleBoards(who) },
        cors,
      );
    }
    if (req.method !== 'POST') return send(res, 404, { error: 'no such route' }, cors);
    const b = await readBody(req).catch(() => null);
    if (!b) return send(res, 400, { error: 'bad json' }, cors);
    if (p === '/api/push/subscribe') {
      const sub = b.subscription || {};
      if (!sub.endpoint || !/^https?:\/\//.test(sub.endpoint) || !sub.keys || !sub.keys.p256dh || !sub.keys.auth)
        return send(res, 400, { error: 'a subscription needs an endpoint and keys' }, cors);
      let cur = Object.values(subs).find(x => x.endpoint === sub.endpoint);
      if (cur && !owns(who, cur)) return send(res, 403, { error: 'no such device' }, cors);
      // the browser renewed its subscription: the old one's switches carry over
      const old = b.oldEndpoint
        ? Object.values(subs).find(x => owns(who, x) && x.endpoint === b.oldEndpoint && x !== cur)
        : null;
      // the same device under a new endpoint
      if (!cur && old) {
        cur = old;
        cur.endpoint = sub.endpoint;
        cur.keys = { p256dh: sub.keys.p256dh, auth: sub.keys.auth };
        cur.lastError = null;
      } else if (!cur) {
        const id = newId();
        cur = subs[id] = {
          id,
          endpoint: sub.endpoint,
          keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth },
          device: String(b.device || 'a device').slice(0, 60),
          boards: Object.fromEntries(visibleBoards(who).map(board => [board, true])),
          createdAt: now(),
          by: who.name,
          installationId: who.installationId || null,
        };
        console.log(`push: ${cur.device} subscribed`);
      } else {
        cur.keys = { p256dh: sub.keys.p256dh, auth: sub.keys.auth };
        if (old) delete subs[old.id];
      }
      if (b.device) cur.device = String(b.device).slice(0, 60);
      if (b.boards && typeof b.boards === 'object')
        for (const board of visibleBoards(who)) if (board in b.boards) cur.boards[board] = !!b.boards[board];
      save();
      return send(res, 200, { ok: true, mine: cur.id, devices: pushDevices(who) }, cors);
    }
    const s = subs[b.id];
    if (s && !owns(who, s)) return send(res, 404, { error: 'no such device' }, cors);
    if (!s && p !== '/api/push/unsubscribe') return send(res, 404, { error: 'no such device' }, cors);
    if (p === '/api/push/settings') {
      if (b.boards && typeof b.boards === 'object')
        for (const board of visibleBoards(who)) if (board in b.boards) s.boards[board] = !!b.boards[board];
      if (b.device) s.device = String(b.device).slice(0, 60);
      save();
      return send(res, 200, { ok: true, devices: pushDevices(who) }, cors);
    }
    if (p === '/api/push/unsubscribe') {
      if (s) {
        delete subs[s.id];
        console.log(`push: ${s.device} removed by ${who.name}`);
        save();
      }
      return send(res, 200, { ok: true, devices: pushDevices(who) }, cors);
    }
    if (p === '/api/push/test') {
      let keys;
      try {
        keys = vapid();
      } catch (e) {
        return send(res, 500, { error: 'no push keys: ' + e.message }, cors);
      }
      const r = await push.send(
        s,
        {
          kind: 'test',
          title: 'Lighthouse',
          body: 'Notifications reach this device (' + s.device + ').',
          url: '/',
          tag: 'test',
          t: now(),
        },
        keys,
        { subject: cfg.pushSubject, ttl: 60 },
      );
      if (r.ok) {
        s.lastOk = now();
        s.lastError = null;
      } else {
        s.lastError = `${r.status} ${r.error || ''}`.trim();
        if (r.drop) delete subs[s.id];
      }
      save();
      return send(
        res,
        r.ok ? 200 : 502,
        { ok: r.ok, status: r.status, error: r.error, devices: pushDevices(who) },
        cors,
      );
    }
    return send(res, 404, { error: 'no such route' }, cors);
  }

  return { VAPID_FILE, vapid, pushDevices, notify, pushRoutes };
};
