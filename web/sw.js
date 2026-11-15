// Service worker: apre l'app anche senza rete (i dati restano sul server).
const VERSION = 'ricettario-v5';
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
