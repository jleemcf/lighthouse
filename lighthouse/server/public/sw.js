// Lighthouse service worker: shows the board server's pushes and opens the board on a tap. Nothing is cached here;
// the page is always fetched live. (Owner, 2026-09-22: notifications on the phone and the computers.)
'use strict';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('push', e => {
  let d = {};
  try {
    d = e.data ? e.data.json() : {};
  } catch (err) {
    d = { title: 'Lighthouse', body: e.data ? e.data.text() : '' };
  }
  const opts = { body: d.body || '', data: { url: d.url || '/' }, icon: '/icon-192.png', badge: '/icon-192.png' };
  if (d.tag) {
    opts.tag = d.tag;
    opts.renotify = true;
  } // a second ask on the same card replaces the first on screen
  if (d.t && !isNaN(Date.parse(d.t))) opts.timestamp = Date.parse(d.t);
  e.waitUntil(self.registration.showNotification(d.title || 'Lighthouse', opts));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const target = new URL((e.notification.data && e.notification.data.url) || '/', self.location.origin).href;
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      const open = list.find(c => 'focus' in c);
      if (open) {
        open.postMessage({ kind: 'open', url: target });
        return open.focus();
      } // the page reads the card or board from the url
      return self.clients.openWindow(target);
    }),
  );
});

self.addEventListener('pushsubscriptionchange', e => {
  // the browser renewed the subscription: tell the board, keeping the switches
  e.waitUntil(
    (async () => {
      const r = await fetch('/api/push', { credentials: 'include' });
      const j = await r.json();
      const sub = await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: j.key });
      await fetch('/api/push/subscribe', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subscription: sub.toJSON(),
          oldEndpoint: e.oldSubscription ? e.oldSubscription.endpoint : null,
        }),
      });
    })().catch(() => {}),
  );
});
