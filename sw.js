/* ContaFácil Pro — Service Worker
 * Hace la app 100% offline y gestiona las actualizaciones de forma limpia.
 *
 * Estrategia anti-caché-vieja:
 *  - HTML  → network-first: si hay internet trae el index fresco; si no, el de caché.
 *  - Assets → cache-first: llevan ?v= en la URL, así que una versión nueva = URL
 *            nueva = se descarga sola (nunca queda código viejo pegado).
 *  - Al activar una versión nueva se borran TODAS las cachés viejas.
 */
const SW_VERSION = '2026.05.29a';            // sincronizar con APP_VERSION de app.js
const CACHE_NAME = 'contafacil-' + SW_VERSION;

// App shell — archivos mínimos para abrir la app sin internet (mismo origen)
const SHELL = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css?v=20260529a',
  './js/db.js?v=20260529a',
  './js/app.js?v=20260529a',
  './js/tax.js?v=20260529a',
];

// ── Instalación: precachear el app shell ──────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(SHELL))
  );
});

// ── Activación: borrar cachés de versiones anteriores ─────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// ── Mensaje desde la app: activar la versión nueva de inmediato ───────────────
self.addEventListener('message', event => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});

// ── Fetch: red-primero para HTML, caché-primero para el resto ─────────────────
self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (!url.protocol.startsWith('http')) return; // ignorar chrome-extension://, etc.

  const isHTML = req.mode === 'navigate' ||
                 (req.headers.get('accept') || '').includes('text/html');

  if (isHTML) {
    // Network-first: index fresco si hay internet; el de caché si no hay
    event.respondWith(
      fetch(req)
        .then(resp => {
          const copy = resp.clone();
          caches.open(CACHE_NAME).then(c => c.put(req, copy)).catch(() => {});
          return resp;
        })
        .catch(() => caches.match(req).then(r => r || caches.match('./index.html')))
    );
  } else {
    // Cache-first: assets versionados (?v=) y recursos externos (Chart.js, etc.)
    event.respondWith(
      caches.match(req).then(cached => {
        if (cached) return cached;
        return fetch(req).then(resp => {
          const copy = resp.clone();
          caches.open(CACHE_NAME).then(c => c.put(req, copy)).catch(() => {});
          return resp;
        }).catch(() => cached);
      })
    );
  }
});
