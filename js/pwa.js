/* ==========================================================================
   LifeOS — pwa.js
   Versione dell'app, stato del service worker, contenuto delle cache,
   pulizia delle cache rimaste da versioni precedenti e forzatura
   dell'aggiornamento. Usato dalla card di diagnostica e da reset.html.
   ========================================================================== */

export const APP_VERSION = '2.0.0';
export const BUILD = 'github-pages';

/** Cartella in cui è pubblicata l'app (es. /LifeOS/ oppure /). */
export const basePath = () => new URL('./', document.baseURI).pathname;

/**
 * Chiede la versione al service worker.
 * Funziona anche quando la pagina non è ancora controllata dal worker
 * (primo avvio): in quel caso si parla direttamente al worker attivo.
 */
export async function askSwVersion(timeout = 1500) {
  if (!('serviceWorker' in navigator)) return null;
  let target = navigator.serviceWorker.controller;
  if (!target) {
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      target = reg && (reg.active || reg.waiting || reg.installing);
    } catch (e) { target = null; }
  }
  if (!target) return null;
  return new Promise((resolve) => {
    const ch = new MessageChannel();
    const t = setTimeout(() => resolve(null), timeout);
    ch.port1.onmessage = (e) => {
      if (e.data && e.data.type === 'PONG') { clearTimeout(t); resolve(e.data); }
    };
    try { target.postMessage({ type: 'PING' }, [ch.port2]); }
    catch (err) { clearTimeout(t); resolve(null); }
  });
}

/**
 * Elimina le cache che non appartengono alla versione corrente del service
 * worker. Serve a liberare il dispositivo da una copia incompleta rimasta
 * da un'installazione precedente (per esempio una versione pubblicata prima
 * della correzione dei percorsi).
 */
export async function pruneStaleCaches() {
  if (!window.caches) return { removed: [], kept: [], version: null };
  const info = await askSwVersion();
  const prefix = info && info.version ? info.version : null;
  let keys = [];
  try { keys = await caches.keys(); } catch (e) { return { removed: [], kept: [], version: prefix }; }
  if (!prefix) return { removed: [], kept: keys, version: null };
  const stale = keys.filter((k) => !k.startsWith(prefix));
  try { await Promise.all(stale.map((k) => caches.delete(k))); } catch (e) { /* nulla da fare */ }
  return { removed: stale, kept: keys.filter((k) => k.startsWith(prefix)), version: prefix };
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
