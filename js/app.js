/* ==========================================================================
   LifeOS — app.js
   Bootstrap dell'applicazione:
   · registrazione delle viste e del router
   · tema (auto/chiaro/scuro) con sync del colore della barra di sistema
   · service worker, prompt di installazione, banner offline
   · pulsante + (creazione rapida) e menu principale
   · ripristino dei dati all'avvio e avvio del motore dei promemoria
   ========================================================================== */

import { init, getSetting, setSetting, on, allSettings, isReady } from './store.js';
import * as router from './router.js';
import { qs, qsa, onClick, toast, menuSheet, sheet, node, confirmDialog } from './ui.js';
import { openEditor } from './editors.js';
import { startEngine } from './reminders.js';
import { maybeAutoBackup } from './backup.js';
import { notifyMissed } from './notifications.js';
import { dueNow } from './reminders.js';

/* ------------------------------- ROTTE ---------------------------------- */
import * as home from './views/home.js';
import * as calendar from './views/calendar.js';
import * as tasks from './views/tasks.js';
import * as notes from './views/notes.js';
import * as ideas from './views/ideas.js';
import * as inbox from './views/inbox.js';
import * as goals from './views/goals.js';
import * as journal from './views/journal.js';
import * as remindersView from './views/reminders.js';
import * as voiceView from './views/voice.js';
import * as searchView from './views/search.js';
import * as moreView from './views/more.js';

let deferredInstallPrompt = null;
let swRegistration = null;
let booted = false;

/* ------------------------------- AVVIO ---------------------------------- */
async function boot() {
  if (booted) return;   // il modulo puo' essere eseguito prima di DOMContentLoaded:
  booted = true;        // evitiamo un doppio avvio e listener duplicati
  try {
    applyStoredTheme();
    await init();
    // ripristina la configurazione AI se l'utente l'aveva attivata
    const aiCfg = getSetting('ai', null);
    if (aiCfg) {
      const { configure } = await import('./ai/adapter.js');
      configure(aiCfg);
    }
    registerRoutes();
    wireShell();
    await router.start(qs('#view'));
    startEngine();
    maybeAutoBackup().catch(() => {});
    hideSplash();
    setupServiceWorker();
    checkMissedReminders();
  } catch (err) {
    console.error('[app] avvio non riuscito', err);
    const splash = qs('#splash');
    if (splash) {
      splash.innerHTML = `<div class="splash-logo">LifeOS</div>
        <p style="color:#ffb4b4;max-width:340px;text-align:center;padding:0 24px">
          Avvio non riuscito: ${String(err.message || err)}<br><br>
          Se stai aprendo il file direttamente da disco, avvia invece un server locale
          (es. <code>python3 -m http.server</code>): i moduli JavaScript e IndexedDB richiedono http/https.
        </p>`;
    }
  }
}

function registerRoutes() {
  router.register('home', home);
  router.register('calendar', calendar);
  router.register('tasks', tasks);
  router.register('notes', notes);
  router.register('ideas', ideas);
  router.register('inbox', inbox);
  router.register('goals', goals);
  router.register('journal', journal);
  router.register('reminders', remindersView);
  router.register('voice', voiceView);
  router.register('search', searchView);
  router.register('more', moreView);
}

function hideSplash() {
  const s = qs('#splash');
  const shell = qs('#app-shell');
  if (shell) shell.classList.remove('hidden');
  if (s) {
    setTimeout(() => {
      s.classList.add('out');
      setTimeout(() => s.remove(), 400);
    }, 260);
  }
}

/* -------------------------------- SHELL --------------------------------- */
function wireShell() {
  const shell = qs('#app-shell');
  const view = qs('#view');

  // barra: ombra/bordo allo scroll
  window.addEventListener('scroll', () => {
    qs('.app-bar')?.classList.toggle('scrolled', window.scrollY > 6);
  }, { passive: true });

  // pulsante + : creazione rapida
  qs('#fab')?.addEventListener('click', async (e) => {
    const fab = e.currentTarget;
    fab.classList.add('spin');
    const choice = await menuSheet('Crea…', [
      { icon: '📅', label: 'Evento', desc: 'Appuntamento con data e promemoria', value: 'event' },
      { icon: '✅', label: 'Attività', desc: 'Cose da fare, con scadenza e checklist', value: 'task' },
      { icon: '📝', label: 'Nota', desc: 'Appunto libero, scrivibile o dettabile', value: 'note' },
      { icon: '💡', label: 'Idea', desc: 'Con importanza, fattibilità e stelle', value: 'idea' },
      { icon: '🎯', label: 'Obiettivo', desc: 'Traguardo con avanzamento', value: 'goal' },
      { icon: '📖', label: 'Pensiero', desc: 'Voce del diario di oggi', value: 'journal' },
      { icon: '📥', label: 'Pensiero veloce', desc: 'Salva in Inbox senza decidere', value: 'inbox' }
    ]);
    fab.classList.remove('spin');
    if (choice) openEditor(choice, null, () => router.refresh());
  });

  // pulsante voce dedicato nella barra (se c'è spazio)
  qs('#btn-search')?.addEventListener('click', () => router.navigate('#/search'));
  qs('#btn-theme')?.addEventListener('click', cycleTheme);

  // menu principale
  qs('#btn-menu')?.addEventListener('click', async () => {
    const choice = await menuSheet('LifeOS', [
      { icon: '🏠', label: 'Home', value: '#/home' },
      { icon: '📥', label: 'Inbox', desc: 'Pensieri da smistare', value: '#/inbox' },
      { icon: '🎯', label: 'Obiettivi', value: '#/goals' },
      { icon: '📖', label: 'Diario', value: '#/journal' },
      { icon: '🎙️', label: 'Parla con LifeOS', desc: 'Dettatura libera', value: '#/voice' },
      { icon: '🔔', label: 'Promemoria', value: '#/reminders' },
      { icon: '🔍', label: 'Ricerca globale', value: '#/search' },
      { icon: '⚙️', label: 'Altro e impostazioni', value: '#/more' }
    ]);
    if (choice) router.navigate(choice);
  });

  // collegamenti interni generici (data-nav) presenti in tutte le viste
  onClick(document.body, '[data-nav]:not(.nav-slot)', (el) => { location.hash = '#/' + el.dataset.nav; });

  // stato rete
  const banner = qs('#offline-banner');
  const updateNet = () => banner?.classList.toggle('hidden', navigator.onLine);
  window.addEventListener('online', () => { updateNet(); toast('Torna online'); });
  window.addEventListener('offline', () => { updateNet(); toast('Offline: le funzioni locali restano attive', 3000); });
  updateNet();

  // scorciatoie da tastiera (desktop)
  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && !/input|textarea|select/i.test(document.activeElement?.tagName || '')) {
      e.preventDefault(); router.navigate('#/search');
    }
  });
}

/* --------------------------------- TEMA --------------------------------- */
export function applyStoredTheme() {
  let theme = 'auto';
  try { theme = localStorage.getItem('lifeos_theme') || 'auto'; } catch (e) {}
  applyTheme(theme);
}

export function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  const dark = theme === 'dark' || (theme === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', dark ? '#0e1116' : '#4f6df5');
  try { localStorage.setItem('lifeos_theme', theme); } catch (e) {}
}

function cycleTheme() {
  const order = ['auto', 'light', 'dark'];
  let cur = 'auto';
  try { cur = localStorage.getItem('lifeos_theme') || 'auto'; } catch (e) {}
  const next = order[(order.indexOf(cur) + 1) % order.length];
  applyTheme(next);
  setSetting('theme', next).catch(() => {});
  toast({ auto: '🌗 Tema automatico', light: '☀️ Tema chiaro', dark: '🌙 Tema scuro' }[next]);
}

window.matchMedia?.('(prefers-color-scheme: dark)')?.addEventListener?.('change', () => {
  let cur = 'auto';
  try { cur = localStorage.getItem('lifeos_theme') || 'auto'; } catch (e) {}
  if (cur === 'auto') applyTheme('auto');
});

/* ---------------------------- SERVICE WORKER ---------------------------- */
async function setupServiceWorker() {
  if (!('serviceWorker' in navigator)) {
    console.info('[app] Service Worker non supportato: l\'app funziona, ma senza cache offline.');
    return;
  }
  if (location.protocol === 'file:') {
    console.info('[app] Service Worker non disponibile su file://: usa un server locale (http).');
    return;
  }
  try {
    swRegistration = await navigator.serviceWorker.register(
      new URL('service-worker.js', document.baseURI).href,
      { scope: new URL('./', document.baseURI).href }
    );
    swRegistration.addEventListener('updatefound', () => {
      const nw = swRegistration.installing;
      nw?.addEventListener('statechange', () => {
        if (nw.state === 'installed' && navigator.serviceWorker.controller) {
          toast('Aggiornamento pronto: chiudi e riapri l\'app', 4200);
        }
      });
    });
  } catch (e) {
    console.warn('[app] registrazione Service Worker non riuscita', e);
  }
}

/** C'è una nuova versione in attesa? */
export async function updateAvailable() {
  if (!swRegistration) return false;
  await swRegistration.update().catch(() => {});
  return Boolean(swRegistration.waiting);
}

/** Attiva la nuova versione e ricarica. */
export async function applyUpdate() {
  if (!swRegistration?.waiting) { toast('Nessun aggiornamento in attesa'); return false; }
  swRegistration.waiting.postMessage({ type: 'SKIP_WAITING' });
  toast('Aggiornamento in corso…');
  setTimeout(() => location.reload(), 900);
  return true;
}

/* ---------------------------- INSTALLAZIONE ----------------------------- */
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  console.info('[app] l\'app può essere installata');
});

window.addEventListener('appinstalled', () => {
  toast('LifeOS installata 🎉', 3000);
  deferredInstallPrompt = null;
});

/** Mostra il prompt nativo di installazione. Ritorna true se mostrato. */
export async function installPrompt() {
  if (deferredInstallPrompt) {
    deferredInstallPrompt.prompt();
    const { outcome } = await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    return outcome === 'accepted';
  }
  // iOS e browser senza prompt: spieghiamo la procedura
  const ua = navigator.userAgent;
  const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  await new Promise((resolve) => {
    const body = node(`<div>
      ${isIOS
        ? `<ol style="font-size:14.5px;line-height:2;padding-left:20px">
             <li>Apri LifeOS con <b>Safari</b></li>
             <li>Tocca il pulsante <b>Condividi</b> (quadrato con freccia)</li>
             <li>Scegli <b>Aggiungi a Home</b></li>
             <li>Conferma: apparirà l'icona di LifeOS</li>
           </ol>
           <p class="mic-hint">Su iPhone le notifiche e (spesso) la dettatura funzionano solo dopo l'installazione, con iOS 16.4 o superiore.</p>`
        : `<ol style="font-size:14.5px;line-height:2;padding-left:20px">
             <li>Apri il menu del browser (⋮ oppure ⋯)</li>
             <li>Scegli <b>Installa app</b> o <b>Aggiungi a schermata Home</b></li>
             <li>Conferma</li>
           </ol>
           <p class="mic-hint">Se la voce non compare, il browser non ritiene l'app installabile: verifica di essere su http/https (non file://).</p>`}
    </div>`);
    const foot = node(`<div class="btn-row" style="width:100%"><button class="btn primary" data-ok style="flex:1">Ho capito</button></div>`);
    const s = sheet({ title: '📲 Installare LifeOS', body, foot });
    onClick(foot, '[data-ok]', () => { s.close(); resolve(); });
  });
  return false;
}

/* ----------------------- PROMEMORIA ALLA RIAPERTURA --------------------- */
async function checkMissedReminders() {
  // piccola attesa: lasciamo respirare l'animazione iniziale
  setTimeout(() => {
    const due = dueNow();
    if (due.length) {
      console.info(`[app] ${due.length} promemoria in scadenza`);
      const banner = qs('#offline-banner');
      if (banner) {
        banner.textContent = `🔔 ${due.length} promemoria in scadenza — tocca per aprirli`;
        banner.classList.remove('hidden');
        banner.style.cursor = 'pointer';
        banner.addEventListener('click', () => { banner.classList.add('hidden'); location.hash = '#/reminders'; }, { once: true });
      }
    }
  }, 2400);
}

/* -------------------------- RICARICA AUTOMATICA ------------------------- */
// Quando il service worker prende il controllo di una nuova versione, ricarichiamo.
navigator.serviceWorker?.addEventListener?.('controllerchange', () => {
  if (window.__lifeosReloading) return;
  window.__lifeosReloading = true;
  setTimeout(() => location.reload(), 300);
});

/* ------------------------------- FUORI ---------------------------------- */
// API minima esposta per il debug manuale dalla console del browser.
window.LifeOS = {
  navigate: router.navigate,
  go: router.go,
  openEditor,
  toast,
  refresh: () => router.refresh(),
  version: '1.0.0'
};

document.addEventListener('DOMContentLoaded', boot);
if (document.readyState !== 'loading') boot();


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
