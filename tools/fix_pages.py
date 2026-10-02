#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
LifeOS — correzione dei percorsi per GitHub Pages (sottocartella /LifeOS/).

Applica in modo idempotente:
  1. index.html          percorsi relativi espliciti + diagnostica di avvio
  2. service-worker.js   v2: precache verificato, scope relativo, pulizia cache
  3. manifest.json       start_url/scope/icons relativi
  4. reset.html          pagina di diagnostica autonoma (senza dipendenze)
  5. 404.html            pagina di cortesia per i percorsi inesistenti
  6. .nojekyll           disattiva l'elaborazione Jekyll di GitHub Pages
  7. js/pwa.js           versione app, stato SW, cache, force update
  8. js/app.js           registrazione SW robusta + flag di avvio + pulizia SW orfani
  9. js/views/more.js    card di diagnostica dell'installazione
"""
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
report = []


def write(rel, content):
    path = os.path.join(ROOT, rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8') as fh:
        fh.write(content)
    report.append(('scritto', rel, len(content)))


def patch(rel, fn):
    path = os.path.join(ROOT, rel)
    with open(path, 'r', encoding='utf-8') as fh:
        src = fh.read()
    out, note = fn(src)
    if out != src:
        with open(path, 'w', encoding='utf-8') as fh:
            fh.write(out)
    report.append((note, rel, len(out)))


# ---------------------------------------------------------------- index.html
INDEX_HTML = '''<!DOCTYPE html>
<html lang="it" data-theme="auto">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <title>LifeOS — Il tuo secondo cervello</title>
  <meta name="description" content="LifeOS: PWA personale offline-first per eventi, attività, note, idee, obiettivi e pensieri. Dati solo sul tuo dispositivo." />
  <meta name="theme-color" content="#0e1116" media="(prefers-color-scheme: dark)" />
  <meta name="theme-color" content="#f4f5fa" media="(prefers-color-scheme: light)" />
  <meta name="color-scheme" content="light dark" />
  <meta name="apple-mobile-web-app-capable" content="yes" />
  <meta name="mobile-web-app-capable" content="yes" />
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
  <meta name="apple-mobile-web-app-title" content="LifeOS" />
  <meta name="format-detection" content="telephone=no" />

  <!-- Percorsi RELATIVI (./...): funzionano sia in http://localhost:8000/
       sia in una sottocartella di GitHub Pages, es. /Life_OS/ -->
  <link rel="manifest" href="./manifest.json" />
  <link rel="icon" href="./icons/favicon.png" sizes="32x32" />
  <link rel="apple-touch-icon" href="./icons/apple-touch-icon.png" />
  <link rel="stylesheet" href="./css/styles.css" onerror="window.__LIFEOS_CSS_FAILED = true" />
</head>
<body>

  <!-- ============ SPLASH ============ -->
  <div id="splash" class="splash">
    <div class="splash-logo">Life<span>OS</span></div>
    <div class="splash-tag">Il tuo secondo cervello, sul tuo telefono</div>
    <div class="spinner"></div>
  </div>

  <!-- ============ SHELL ============ -->
  <div id="app-shell" class="app-shell hidden">
    <header class="app-bar">
      <button class="icon-btn" id="btn-menu" aria-label="Apri menu">☰</button>
      <div class="app-bar-title">
        <span id="bar-title">LifeOS</span>
        <span id="bar-sub" class="bar-sub"></span>
      </div>
      <div class="app-bar-actions">
        <button class="icon-btn" id="btn-search" aria-label="Ricerca globale">🔍</button>
        <button class="icon-btn" id="btn-theme" aria-label="Cambia tema">🌗</button>
      </div>
    </header>

    <div id="offline-banner" class="offline-banner hidden" role="status">
      ⚠️ Sei offline — tutte le funzioni locali restano attive
    </div>

    <main id="view" class="view" tabindex="-1"></main>

    <nav class="bottom-nav" id="bottom-nav" aria-label="Navigazione principale">
      <a class="nav-slot" href="#/home" data-route="home"><span class="nav-ico">🏠</span><span class="nav-lbl">Home</span></a>
      <a class="nav-slot" href="#/calendar" data-route="calendar"><span class="nav-ico">📅</span><span class="nav-lbl">Calendario</span></a>
      <div class="nav-slot center">
        <button id="fab" class="fab" aria-label="Crea nuovo elemento">+</button>
      </div>
      <a class="nav-slot" href="#/tasks" data-route="tasks"><span class="nav-ico">✅</span><span class="nav-lbl">Attività</span></a>
      <a class="nav-slot" href="#/notes" data-route="notes"><span class="nav-ico">📝</span><span class="nav-lbl">Note</span></a>
      <a class="nav-slot" href="#/ideas" data-route="ideas"><span class="nav-ico">💡</span><span class="nav-lbl">Idee</span></a>
    </nav>
  </div>

  <div id="sheet-root"></div>
  <div id="modal-root"></div>
  <div id="toast-root" class="toast-root" aria-live="polite" aria-atomic="true"></div>

  <noscript>
    <div style="padding:24px;font-family:system-ui">LifeOS richiede JavaScript attivo per funzionare.</div>
  </noscript>

  <!-- ============ DIAGNOSTICA DI AVVIO (script classico, senza CSS) ============
       Se il foglio di stile o il modulo principale non si caricano entro 4 s,
       mostra un pannello leggibile con gli URL REALI risolti e il loro stato
       HTTP. Serve a distinguere subito un 404 di percorso da un errore di codice. -->
  <script>
  window.__LIFEOS_BOOTED = false;
  (function () {
    var FILES = ['./css/styles.css', './js/app.js', './manifest.json', './icons/icon-192.png', './service-worker.js'];
    var rows = [];

    function esc(s) {
      return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    function build(cssFailed) {
      var h = '<h1 style="font-size:19px;margin:0 0 10px">LifeOS non si &egrave; avviato correttamente</h1>'
        + '<p style="margin:0 0 10px">Foglio di stile: <b>' + (cssFailed ? 'NON caricato' : 'caricato') + '</b> &middot; modulo JavaScript: <b>non avviato</b>.</p>'
        + '<p style="margin:0 0 12px">Pagina corrente: <code>' + esc(location.href) + '</code></p>'
        + '<ul style="margin:0 0 14px;padding-left:20px">';
      rows.forEach(function (r) {
        var col = r.status === '...' ? '#666' : (String(r.status).indexOf('200') === 0 ? '#127a2e' : '#b00020');
        h += '<li style="margin-bottom:4px"><code>' + esc(r.url) + '</code> &mdash; <b style="color:' + col + '">' + esc(r.status) + '</b></li>';
      });
      h += '</ul>'
        + '<div style="background:#f4f5f7;border-left:4px solid #4f6df5;padding:12px 14px;margin:0 0 14px">'
        + '<b>Cosa controllare</b><br>'
        + '1. Gli URL sopra devono contenere la cartella in cui hai pubblicato l\\'app (es. <code>/Life_OS/</code>). '
        + 'Se non c\\'&egrave;, il sito non &egrave; pubblicato all\\'indirizzo che stai aprendo: su GitHub Pages il nome della cartella &egrave; quello del repository e distingue maiuscole e minuscole.<br>'
        + '2. Se vedi <b>404</b>, quei file non esistono in quella posizione: controlla che <code>css/</code>, <code>js/</code> e <code>icons/</code> siano presenti nel repository accanto a <code>index.html</code>.<br>'
        + '3. Se i file esistono ma l\\'app resta cos&igrave;, il service worker ha in cache una versione incompleta: usa il pulsante qui sotto.'
        + '</div>'
        + '<p style="margin:0"><button id="boot-reset" style="font:inherit;padding:11px 15px;border:1px solid #999;border-radius:8px;background:#fff;cursor:pointer">'
        + 'Svuota cache e service worker, poi ricarica</button>'
        + ' <a href="./reset.html" style="margin-left:12px">Diagnostica completa</a></p>';
      return h;
    }

    function render(cssFailed) {
      var box = document.getElementById('boot-diag');
      if (!box) {
        box = document.createElement('div');
        box.id = 'boot-diag';
        box.setAttribute('style', 'position:fixed;inset:0;z-index:2147483647;overflow:auto;background:#fff;color:#111;'
          + 'font:14px/1.6 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;padding:20px 18px 40px');
        box.addEventListener('click', function (e) {
          if (e.target && e.target.id === 'boot-reset') {
            e.target.disabled = true;
            e.target.textContent = 'Pulizia in corso...';
            (async function () {
              try {
                if ('serviceWorker' in navigator) {
                  var regs = await navigator.serviceWorker.getRegistrations();
                  await Promise.all(regs.map(function (r) { return r.unregister(); }));
                }
                if (window.caches) {
                  var keys = await caches.keys();
                  await Promise.all(keys.map(function (k) { return caches.delete(k); }));
                }
              } catch (err) { /* niente da fare */ }
              location.reload();
            })();
          }
        });
        document.body.appendChild(box);
      }
      box.innerHTML = build(cssFailed);
    }

    setTimeout(function () {
      if (window.__LIFEOS_BOOTED) return;
      var cssFailed = window.__LIFEOS_CSS_FAILED === true;
      rows = FILES.map(function (f) { return { url: new URL(f, location.href).href, status: '...' }; });
      render(cssFailed);
      FILES.forEach(function (f, i) {
        fetch(rows[i].url, { cache: 'no-store' })
          .then(function (r) {
            rows[i].status = r.status + ' ' + (r.headers.get('content-type') || '');
          })
          .catch(function () { rows[i].status = 'errore di rete'; })
          .then(function () {
            if (!window.__LIFEOS_BOOTED) render(cssFailed);
          });
      });
    }, 4000);
  })();
  </script>

  <script type="module" src="./js/app.js"></script>
</body>
</html>
'''


# --------------------------------------------------------- service-worker.js
SERVICE_WORKER = r'''/* ==========================================================================
   LifeOS — service-worker.js  (versione 2)

   Correzioni per la pubblicazione in una sottocartella (GitHub Pages /LifeOS/):
   - tutti i percorsi sono derivati da BASE (la cartella del service worker),
     quindi funzionano sia in http://localhost:8000/ sia in /LifeOS/;
   - il precache viene VERIFICATO: se un asset non risponde 200 la nuova shell
     non viene attivata, cosi' una cache incompleta non puo' piu' sostituire
     una versione funzionante (era la causa della pagina senza CSS);
   - cache versionata e pulizia di TUTTE le cache precedenti in activate;
   - skipWaiting() + clients.claim() per aggiornare subito l'app;
   - nessuna risposta non-200 viene mai messa in cache.

   Strategia di recupero:
   - navigazione (HTML) -> network-first, poi cache, poi offline.html
   - asset statici       -> cache-first + aggiornamento in background
   ========================================================================== */

const VERSION = 'lifeos-v2.0.0';
const SHELL_CACHE = `${VERSION}-shell`;
const RUNTIME_CACHE = `${VERSION}-runtime`;
const STAGING_CACHE = `${VERSION}-staging`;

/* Cartella in cui vive il service worker: /  oppure /LifeOS/ */
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
    })));

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
    for (const req of await staging.keys()) {
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
    await Promise.all(keys.filter((k) => !keep.includes(k)).map((k) => caches.delete(k)));
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
    event.source?.postMessage({ type: 'PONG', version: VERSION, base: BASE, shell: SHELL_CACHE });
  }
  if (data.type === 'CLEAR_CACHES') {
    event.waitUntil((async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
      event.source?.postMessage({ type: 'CACHES_CLEARED', version: VERSION });
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
'''


# ------------------------------------------------------------- manifest.json
MANIFEST = '''{
  "id": "lifeos-personal",
  "name": "LifeOS — Secondo cervello personale",
  "short_name": "LifeOS",
  "description": "PWA offline-first per organizzare eventi, attività, note, idee, obiettivi e pensieri. Dettatura vocale, promemoria multipli e backup JSON locale.",
  "lang": "it-IT",
  "dir": "ltr",
  "start_url": "./",
  "scope": "./",
  "display": "standalone",
  "display_override": ["standalone", "minimal-ui", "browser"],
  "orientation": "portrait",
  "background_color": "#0e1116",
  "theme_color": "#4f6df5",
  "categories": ["productivity", "lifestyle", "utilities"],
  "prefer_related_applications": false,
  "icons": [
    { "src": "./icons/favicon.png", "sizes": "32x32", "type": "image/png" },
    { "src": "./icons/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any" },
    { "src": "./icons/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any" },
    { "src": "./icons/icon-maskable-192.png", "sizes": "192x192", "type": "image/png", "purpose": "maskable" },
    { "src": "./icons/icon-maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ],
  "shortcuts": [
    { "name": "Nuova attività", "short_name": "Attività", "url": "./index.html#/tasks?new=task" },
    { "name": "Parla con LifeOS", "short_name": "Voce", "url": "./index.html#/voice" },
    { "name": "Inbox", "short_name": "Inbox", "url": "./index.html#/inbox" },
    { "name": "Promemoria", "short_name": "Promemoria", "url": "./index.html#/reminders" }
  ]
}
'''


# --------------------------------------------------------------- 404.html
PAGE_404 = '''<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <title>Percorso non trovato — LifeOS</title>
  <link rel="icon" href="./icons/favicon.png" sizes="32x32" />
  <style>
    :root { color-scheme: light dark; }
    body { margin:0; font:16px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
           background:#0e1116; color:#e8ecf3; display:flex; min-height:100dvh;
           align-items:center; justify-content:center; padding:24px; }
    .card { max-width:520px; background:#161b23; border:1px solid #263042; border-radius:18px; padding:26px 22px; }
    h1 { font-size:20px; margin:0 0 10px; }
    p { margin:0 0 12px; color:#a7b1c2; }
    code { background:#0e1116; padding:2px 6px; border-radius:6px; font-size:14px; }
    a.btn { display:inline-block; margin-top:10px; background:#4f6df5; color:#fff; text-decoration:none;
            padding:12px 18px; border-radius:12px; font-weight:650; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Percorso non trovato</h1>
    <p>Questa pagina non fa parte di LifeOS. L'app usa un router a hash: tutte le sezioni si aprono da <code>index.html#/...</code>.</p>
    <p>Pagina richiesta: <code id="req"></code></p>
    <a class="btn" href="./index.html">Apri LifeOS</a>
  </div>
  <script>
    document.getElementById('req').textContent = location.pathname + location.hash;
  </script>
</body>
</html>
'''


# -------------------------------------------------------------- reset.html
RESET_HTML = '''<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <title>Diagnostica LifeOS</title>
  <link rel="icon" href="./icons/favicon.png" sizes="32x32" />
  <style>
    :root { color-scheme: light dark; }
    body { margin:0; font:15px/1.65 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
           background:#0e1116; color:#e8ecf3; padding:22px 18px 60px; }
    .wrap { max-width:620px; margin:0 auto; }
    h1 { font-size:21px; margin:0 0 4px; }
    .sub { color:#8b96a8; margin:0 0 20px; }
    .card { background:#161b23; border:1px solid #263042; border-radius:16px; padding:18px 16px; margin-bottom:14px; }
    h2 { font-size:15px; margin:0 0 10px; letter-spacing:.02em; text-transform:uppercase; color:#8b96a8; }
    table { width:100%; border-collapse:collapse; font-size:13.5px; }
    td { padding:6px 0; vertical-align:top; border-bottom:1px solid #1f2734; word-break:break-all; }
    td:first-child { color:#8b96a8; width:44%; }
    .ok { color:#3ddc84; font-weight:650; }
    .ko { color:#ff6b6b; font-weight:650; }
    .warn { color:#ffc107; font-weight:650; }
    button, a.btn { display:inline-block; font:inherit; font-weight:650; border-radius:12px; padding:12px 16px;
                    border:0; cursor:pointer; text-decoration:none; margin:6px 8px 0 0; }
    .primary { background:#4f6df5; color:#fff; }
    .ghost { background:#222a36; color:#e8ecf3; }
    .danger { background:#7a1f28; color:#ffd9dd; }
    button[disabled] { opacity:.55; cursor:default; }
    .note { color:#8b96a8; font-size:13px; margin-top:10px; }
    code { background:#0e1116; padding:1px 5px; border-radius:5px; font-size:13px; }
  </style>
</head>
<body>
<div class="wrap">
  <h1>Diagnostica LifeOS</h1>
  <p class="sub">Questa pagina non usa il service worker né il CSS dell'app: funziona anche quando l'app non parte.</p>

  <div class="card">
    <h2>Installazione</h2>
    <table id="env"></table>
  </div>

  <div class="card">
    <h2>File dell'app (stato HTTP reale)</h2>
    <table id="files"></table>
    <p class="note">Se un file risulta 404, non esiste in quella posizione: su GitHub Pages il percorso della cartella corrisponde al nome del repository e distingue maiuscole e minuscole.</p>
  </div>

  <div class="card">
    <h2>Service worker e cache</h2>
    <table id="sw"></table>
  </div>

  <div class="card">
    <h2>Azioni</h2>
    <button class="primary" id="hard">Svuota cache e service worker, poi ricarica</button>
    <a class="btn ghost" href="./index.html">Apri LifeOS</a>
    <button class="danger" id="wipe">Elimina i dati di LifeOS (IndexedDB)</button>
    <p class="note">Il primo pulsante risolve una cache rimasta bloccata su una versione precedente. Il secondo cancella definitivamente eventi, attività, note, idee, obiettivi, diario, inbox e categorie salvati su questo dispositivo: esporta prima un backup dall'app.</p>
  </div>
</div>

<script>
(async function () {
  var APP_FILES = ['./index.html', './css/styles.css', './js/app.js', './js/store.js', './js/router.js',
                   './js/editors.js', './js/recur.js', './js/ai/parser.js', './js/views/more.js',
                   './manifest.json', './service-worker.js', './icons/icon-192.png'];

  function row(k, v, cls) {
    return '<tr><td>' + k + '</td><td class="' + (cls || '') + '">' + v + '</td></tr>';
  }

  var env = document.getElementById('env');
  env.innerHTML =
    row('URL della pagina', location.href) +
    row('Cartella dell\\'app', location.pathname.replace(/[^/]*$/, '') || '/') +
    row('Origine', location.origin) +
    row('Contesto sicuro (HTTPS o localhost)', window.isSecureContext ? 'Sì' : 'NO — il service worker non si registra', window.isSecureContext ? 'ok' : 'ko') +
    row('Versione attesa dell\\'app', '2.0.0');

  var files = document.getElementById('files');
  files.innerHTML = APP_FILES.map(function (f) {
    return '<tr><td><code>' + f + '</code></td><td id="f-' + f.replace(/[^a-z0-9]/gi, '_') + '">verifica…</td></tr>';
  }).join('');

  APP_FILES.forEach(function (f) {
    var cell = document.getElementById('f-' + f.replace(/[^a-z0-9]/gi, '_'));
    fetch(f, { cache: 'no-store' }).then(function (r) {
      var ct = r.headers.get('content-type') || '—';
      cell.innerHTML = '<span class="' + (r.ok ? 'ok' : 'ko') + '">' + r.status + '</span> · ' + ct;
    }).catch(function () {
      cell.innerHTML = '<span class="ko">errore di rete</span>';
    });
  });

  var swTable = document.getElementById('sw');
  var lines = '';
  if (!('serviceWorker' in navigator)) {
    lines += row('Service worker', 'non supportato da questo browser', 'warn');
  } else {
    var regs = await navigator.serviceWorker.getRegistrations();
    if (!regs.length) lines += row('Registrazioni', 'nessuna', 'warn');
    regs.forEach(function (r) {
      var w = r.active || r.installing || r.waiting;
      lines += row('Scope', r.scope);
      lines += row('Script', w ? w.scriptURL : '—');
      lines += row('Stato', w ? w.state : '—', w && w.state === 'activated' ? 'ok' : 'warn');
    });
  }
  try {
    var keys = await caches.keys();
    lines += row('Cache presenti', keys.length ? keys.join('<br>') : 'nessuna');
  } catch (e) { lines += row('Cache', 'non leggibili', 'warn'); }
  swTable.innerHTML = lines;

  document.getElementById('hard').addEventListener('click', function () {
    this.disabled = true; this.textContent = 'Pulizia in corso…';
    (async function () {
      try {
        if ('serviceWorker' in navigator) {
          var regs = await navigator.serviceWorker.getRegistrations();
          await Promise.all(regs.map(function (r) { return r.unregister(); }));
        }
        if (window.caches) {
          var ks = await caches.keys();
          await Promise.all(ks.map(function (k) { return caches.delete(k); }));
        }
      } catch (e) {}
      location.replace('./index.html');
    })();
  });

  document.getElementById('wipe').addEventListener('click', function () {
    if (!confirm('Eliminare DEFINITIVAMENTE tutti i dati di LifeOS su questo dispositivo?')) return;
    if (!confirm('Ultima conferma: eventi, attività, note, idee, obiettivi, diario, inbox e categorie verranno cancellati.')) return;
    var req = indexedDB.deleteDatabase('lifeos');
    req.onsuccess = req.onerror = req.onblocked = function () { alert('Dati eliminati. Ricarico LifeOS.'); location.replace('./index.html'); };
  });
})();
</script>
</body>
</html>
'''


# ------------------------------------------------------------------ js/pwa.js
PWA_JS = '''/* ==========================================================================
   LifeOS — pwa.js
   Versione dell'app, stato del service worker, contenuto delle cache e
   forzatura dell'aggiornamento. Usato dalla card di diagnostica e dalla
   pagina reset.html.
   ========================================================================== */

export const APP_VERSION = '2.0.0';
export const BUILD = 'github-pages';

/** Cartella in cui è pubblicata l'app (es. /LifeOS/ oppure /). */
export const basePath = () => new URL('./', document.baseURI).pathname;

/** Chiede al service worker attivo la sua versione. */
export function askSwVersion(timeout = 1200) {
  return new Promise((resolve) => {
    if (!('serviceWorker' in navigator) || !navigator.serviceWorker.controller) return resolve(null);
    const ch = new MessageChannel();
    const t = setTimeout(() => resolve(null), timeout);
    ch.port1.onmessage = (e) => {
      if (e.data && e.data.type === 'PONG') { clearTimeout(t); resolve(e.data); }
    };
    try { navigator.serviceWorker.controller.postMessage({ type: 'PING' }, [ch.port2]); }
    catch (err) { clearTimeout(t); resolve(null); }
  });
}

/** Fotografia completa dell'installazione. */
export async function pwaInfo() {
  const info = {
    appVersion: APP_VERSION,
    build: BUILD,
    base: basePath(),
    href: location.href,
    secure: Boolean(window.isSecureContext),
    swSupported: 'serviceWorker' in navigator,
    sw: null,
    swVersion: null,
    caches: []
  };
  if (info.swSupported) {
    try {
      const regs = await navigator.serviceWorker.getRegistrations();
      info.sw = regs.map((r) => {
        const w = r.active || r.installing || r.waiting;
        return { scope: r.scope, scriptURL: w ? w.scriptURL : null, state: w ? w.state : null };
      });
    } catch (e) { info.sw = []; }
    info.swVersion = await askSwVersion();
  }
  try { info.caches = await caches.keys(); } catch (e) { info.caches = []; }
  return info;
}

/** Svuota cache e service worker, poi ricarica. */
export async function forceUpdate() {
  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    }
    if (window.caches) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
  } catch (e) { /* procediamo comunque con la ricarica */ }
  location.reload();
}

/** Attiva l'aggiornamento quando il service worker è in attesa. */
export function promoteWaiting(reg) {
  if (!reg) return;
  if (reg.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' });
  reg.addEventListener('updatefound', () => {
    const sw = reg.installing;
    if (!sw) return;
    sw.addEventListener('statechange', () => {
      if (sw.state === 'installed' && navigator.serviceWorker.controller) {
        sw.postMessage({ type: 'SKIP_WAITING' });
      }
    });
  });
}

/* ------------- riempie la card #pwa-diag quando compare ------------- */
let filling = false;
async function fillDiag() {
  const el = document.getElementById('pwa-diag');
  if (!el || filling) return;
  filling = true;
  try {
    const i = await pwaInfo();
    const swText = i.sw && i.sw.length
      ? i.sw.map((s) => `${s.state || '—'} · <code>${s.scope}</code>`).join('<br>')
      : (i.swSupported ? 'nessuna registrazione' : 'non supportato dal browser');
    el.innerHTML = `
      <div>Versione app: <b>${i.appVersion}</b> <span class="dim">(${i.build})</span></div>
      <div>Versione service worker: <b>${i.swVersion ? i.swVersion.version : '—'}</b></div>
      <div>Cartella pubblicata: <code>${i.base}</code></div>
      <div>Service worker: ${swText}</div>
      <div>Cache: ${i.caches.length ? i.caches.map((c) => `<code>${c}</code>`).join(' ') : 'nessuna'}</div>
      <div>Contesto sicuro: ${i.secure ? 'sì' : 'no'}</div>`;
  } finally {
    filling = false;
  }
}

/** Osserva i cambi di vista e riempie la card quando è presente. */
export function watchDiagnostics() {
  const root = document.getElementById('view') || document.body;
  try {
    new MutationObserver(() => { fillDiag(); }).observe(root, { childList: true, subtree: true });
  } catch (e) { /* observer non disponibile */ }
  fillDiag();
}
'''


# ------------------------------------------------------ card in views/more.js
DIAG_CARD = '''      <div class="divider"></div>
      <div class="h3" style="margin-bottom:10px">🩺 Diagnostica dell'installazione</div>
      <div id="pwa-diag" class="muted" style="line-height:1.7">Raccolta informazioni…</div>
      <div class="btn-row" style="margin-top:12px">
        <a class="btn sm" href="./reset.html">Pagina di diagnostica</a>
      </div>
'''


def main():
    write('index.html', INDEX_HTML)
    write('service-worker.js', SERVICE_WORKER)
    write('manifest.json', MANIFEST)
    write('404.html', PAGE_404)
    write('reset.html', RESET_HTML)
    write('js/pwa.js', PWA_JS)

    # .nojekyll: disattiva l'elaborazione Jekyll di GitHub Pages
    npath = os.path.join(ROOT, '.nojekyll')
    if not os.path.exists(npath):
        open(npath, 'w').close()
    report.append(('creato', '.nojekyll', 0))

    # --- app.js: registrazione SW robusta + flag di avvio + pulizia SW orfani
    def fix_app(src):
        note = 'aggiornato'
        new_reg = (
            "navigator.serviceWorker.register(\n"
            "      new URL('service-worker.js', document.baseURI).href,\n"
            "      { scope: new URL('./', document.baseURI).href }\n"
            "    )"
        )
        src2, n = re.subn(
            r"navigator\.serviceWorker\.register\(\s*'\./service-worker\.js'\s*,\s*\{\s*scope:\s*'\./'\s*\}\s*\)",
            new_reg, src
        )
        if n == 0:
            src2, n = re.subn(
                r"navigator\.serviceWorker\.register\([^)]*\)",
                new_reg, src
            )
        if n == 0:
            note = 'ATTENZIONE: registrazione SW non trovata'
        tail = """

/* ==========================================================================
   LifeOS — estensione GitHub Pages (aggiunta automatica)
   1) pulisce eventuali service worker registrati a uno scope diverso
      (per esempio una vecchia copia pubblicata nella root del dominio);
   2) promuove subito un aggiornamento in attesa;
   3) segnala alla diagnostica di avvio che il modulo è partito.
   ========================================================================== */
import { watchDiagnostics, promoteWaiting, pruneStaleCaches } from './pwa.js';

(async () => {
  if (!('serviceWorker' in navigator)) { watchDiagnostics(); return; }
  const base = new URL('./', document.baseURI).href;
  try {
    const regs = await navigator.serviceWorker.getRegistrations();
    for (const r of regs) {
      const w = r.active || r.installing || r.waiting;
      const swUrl = w ? w.scriptURL : '';
      if (swUrl && swUrl.includes('/service-worker.js') && !swUrl.startsWith(base)) {
        await r.unregister();
      }
    }
    const reg = await navigator.serviceWorker.getRegistration(base);
    promoteWaiting(reg);
    await pruneStaleCaches();
  } catch (e) { /* la diagnostica lo mostrerà */ }
  watchDiagnostics();
})();

window.__LIFEOS_BOOTED = true;
"""
        return src2 + tail, note

    patch('js/app.js', fix_app)

    # --- more.js: card di diagnostica
    def fix_more(src):
        if 'id="pwa-diag"' in src:
            return src, 'già presente'
        anchor = '<button class="btn danger sm" data-wipe>'
        if anchor in src:
            return src.replace(anchor, DIAG_CARD + '      ' + anchor, 1), 'card inserita'
        return src, 'ATTENZIONE: ancora data-wipe non trovata'

    patch('js/views/more.js', fix_more)

    print('LifeOS — correzione percorsi per GitHub Pages')
    print('=' * 62)
    for what, rel, size in report:
        print('  {:<12} {:<24} {:>7} byte'.format(what, rel, size))
    print('=' * 62)


if __name__ == '__main__':
    sys.exit(main())
