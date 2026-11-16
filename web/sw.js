// Service worker: apre l'app anche senza rete (i dati restano sul server).
const VERSION = 'ricettario-v8';
const SHELL = ['./', 'index.html', 'store.js', 'config.js', 'ingredienti.js', 'ricette-base.js', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const req = e.request; if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.hostname.endsWith('supabase.co') || url.hostname.endsWith('supabase.in')) return; // dati sempre dalla rete
  const sameOrigin = url.origin === location.origin;
  if (sameOrigin && (req.mode === 'navigate' || /\.(html|js|webmanifest)$/.test(url.pathname))) {
    // prima la rete (per ricevere gli aggiornamenti), poi la copia salvata
    e.respondWith(fetch(req).then(r => { const c = r.clone(); caches.open(VERSION).then(ca => ca.put(req, c)); return r; }).catch(() => caches.match(req).then(r => r || caches.match('index.html'))));
    return;
  }
  if (sameOrigin || url.hostname === 'cdn.jsdelivr.net' || url.hostname.endsWith('gstatic.com') || url.hostname.endsWith('googleapis.com')) {
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(r => { if (r.ok || r.type === 'opaque') { const c = r.clone(); caches.open(VERSION).then(ca => ca.put(req, c)); } return r; })));
  }
});

// ---------- notifiche ----------
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (x) { d = { title: 'Il mio ricettario', body: e.data ? e.data.text() : '' }; }
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const front = wins.find(w => w.visibilityState === 'visible' && w.focused);
    wins.forEach(w => w.postMessage({ type: 'push', payload: d }));
    // con l'app davanti agli occhi timer e ricette pronte li gestisce l'app stessa
    if (front && (d.kind === 'timer' || d.kind === 'job')) return;
    await self.registration.showNotification(d.title || 'Il mio ricettario', {
      body: d.body || '', tag: d.tag || undefined, renotify: !!d.tag, icon: 'icons/icon-192.png', badge: 'icons/badge-96.png',
      data: { url: d.url || './', kind: d.kind || '' }, vibrate: d.kind === 'timer' ? [400, 150, 400, 150, 400] : [200, 100, 200],
      requireInteraction: d.kind === 'timer', lang: 'it'
    });
  })());
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || './', self.registration.scope).href;
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const w = wins.find(x => x.url.startsWith(self.registration.scope));
    if (w) { await w.focus(); w.postMessage({ type: 'open', url }); return; }
    await self.clients.openWindow(url);
  })());
});
