/* ==========================================================================
   LifeOS — service-worker.js  (versione 2)

   Correzioni per la pubblicazione in una sottocartella (GitHub Pages /LifeOS/):
   - tutti i percorsi sono derivati da BASE (la cartella del service worker),
     quindi funzionano sia in http://localhost:8000/ sia in /LifeOS/;
   - il precache viene VERIFICATO: se un asset non risponde 200 la nuova shell
     non viene attivata, cosi' una cache incompleta non puo' sostituire una
     versione funzionante (era la causa della pagina senza CSS);
   - cache versionata e pulizia di TUTTE le cache precedenti in activate;
   - skipWaiting() + clients.claim() per aggiornare subito l'app;
   - nessuna risposta non-200 viene mai messa in cache.

   Strategia di recupero:
   - navigazione (HTML) -> network-first, poi cache, poi offline.html
   - asset statici       -> cache-first + aggiornamento in background
   ========================================================================== */

const VERSION = 'lifeos-v2.0.0';
const SHELL_CACHE = VERSION + '-shell';
const RUNTIME_CACHE = VERSION + '-runtime';
const STAGING_CACHE = VERSION + '-staging';

/* Cartella in cui vive il service worker: / oppure /LifeOS/ */
const BASE = new URL('./', self.location).href;
const abs = (p) => new URL(p, BASE).href;

/* Tutte le risorse dell'app shell (percorsi relativi a BASE). */
const SHELL_ASSETS = [
  './',
  './index.html',
  './offline.html',
  './404.html',
  './manifest.json',
  './css/styles.css',
  './icons/favicon.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-192.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  './js/app.js',
  './js/pwa.js',
  './js/db.js',
  './js/utils.js',
  './js/store.js',
  './js/router.js',
  './js/ui.js',
  './js/fields.js',
  './js/editors.js',
  './js/voice.js',
  './js/notifications.js',
  './js/reminders.js',
  './js/backup.js',
  './js/search.js',
  './js/recur.js',
  './js/ai/parser.js',
  './js/ai/adapter.js',
  './js/views/home.js',
  './js/views/calendar.js',
  './js/views/tasks.js',
  './js/views/notes.js',
  './js/views/ideas.js',
  './js/views/inbox.js',
  './js/views/goals.js',
  './js/views/journal.js',
  './js/views/reminders.js',
  './js/views/voice.js',
  './js/views/search.js',
  './js/views/more.js'
];

/* ------------------------------- INSTALL -------------------------------- */
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const staging = await caches.open(STAGING_CACHE);

    const results = await Promise.allSettled(SHELL_ASSETS.map(async (p) => {
      const url = abs(p);
      const res = await fetch(new Request(url, { cache: 'reload' }));
      if (!res.ok) throw new Error(res.status + ' su ' + url);
      await staging.put(url, res.clone());
      return p;
    }));

    const failed = results
      .map((r, i) => (r.status === 'rejected' ? SHELL_ASSETS[i] + ' (' + r.reason + ')' : null))
      .filter(Boolean);

    const keys = await caches.keys();
    const hasWorkingShell = keys.includes(SHELL_CACHE);

    if (failed.length && hasWorkingShell) {
      /* Non sostituire una shell funzionante con una incompleta. */
      console.warn('[LifeOS SW] precache incompleto, mantengo la versione precedente:', failed);
      await caches.delete(STAGING_CACHE);
      return;
    }

    if (failed.length) {
      console.warn('[LifeOS SW] precache incompleto (prima installazione):', failed);
    }

    /* Promuovi la staging a shell ufficiale. */
    if (keys.includes(SHELL_CACHE)) await caches.delete(SHELL_CACHE);
    const shell = await caches.open(SHELL_CACHE);
    const staged = await staging.keys();
    for (const req of staged) {
      const res = await staging.match(req);
      if (res) await shell.put(req, res);
    }
    await caches.delete(STAGING_CACHE);
    self.skipWaiting();
  })());
});

/* ------------------------------- ACTIVATE ------------------------------- */
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keep = [SHELL_CACHE, RUNTIME_CACHE];
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => keep.indexOf(k) === -1).map((k) => caches.delete(k)));
    if (self.registration.navigationPreload) {
      try { await self.registration.navigationPreload.disable(); } catch (e) { /* noop */ }
    }
    await self.clients.claim();
  })());
});

/* -------------------------------- MESSAGGI ------------------------------ */
self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type === 'SKIP_WAITING') self.skipWaiting();
  if (data.type === 'PING') {
    const payload = { type: 'PONG', version: VERSION, base: BASE, shell: SHELL_CACHE };
    const port = event.ports && event.ports[0];
    if (port) port.postMessage(payload);
    else if (event.source) event.source.postMessage(payload);
  }
  if (data.type === 'CLEAR_CACHES') {
    event.waitUntil((async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
      if (event.source) event.source.postMessage({ type: 'CACHES_CLEARED', version: VERSION });
    })());
  }
});

/* --------------------------------- FETCH -------------------------------- */
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch (e) { return; }
  if (url.origin !== self.location.origin) return;

  /* 1) Navigazione: network-first, poi shell in cache, poi offline.html */
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(SHELL_CACHE);
      try {
        const fresh = await fetch(req);
        if (fresh && fresh.ok) cache.put(abs('./index.html'), fresh.clone());
        return fresh;
      } catch (e) {
        return (await cache.match(abs('./index.html')))
          || (await cache.match(abs('./')))
          || (await cache.match(abs('./offline.html')))
          || new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
      }
    })());
    return;
  }

  /* 2) Asset statici: cache-first con aggiornamento in background */
  event.respondWith((async () => {
    const cached = await caches.match(req, { ignoreSearch: true });
    if (cached && cached.ok) {
      fetch(req).then(async (res) => {
        if (res && res.ok) {
          const cache = await caches.open(RUNTIME_CACHE);
          await cache.put(req, res.clone());
        }
      }).catch(() => { /* offline: va bene cosi' */ });
      return cached;
    }
    try {
      const res = await fetch(req);
      if (res && res.ok) {
        const cache = await caches.open(RUNTIME_CACHE);
        await cache.put(req, res.clone());
      }
      return res;
    } catch (e) {
      const fallback = await caches.match(req, { ignoreSearch: true });
      if (fallback) return fallback;
      return new Response('Risorsa non disponibile offline', {
        status: 503,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' }
      });
    }
  })());
});
