/* ==========================================================================
   LifeOS — notifications.js
   Gestione ONESTA delle notifiche locali.

   Cosa è realisticamente possibile in una PWA senza server push:
   1. Notifica immediata (Notification API o ServiceWorkerRegistration.
      showNotification) -> funziona se l'app o il service worker sono vivi.
   2. Promemoria programmato -> affidabile solo mentre l'app è aperta
      (o in background breve). Un timer JavaScript non sopravvive alla
      chiusura dell'app: nessun browser lo garantisce senza push server.
   3. Controllo all'apertura -> quando l'utente riapre LifeOS mostriamo un
      riepilogo dei promemoria scaduti mentre era chiusa.

   LIMITI DI PIATTAFORMA (mostrati all'utente nell'interfaccia):
   - iOS: notifiche web solo da iOS 16.4 e SOLO se la PWA è installata
     nella schermata Home (Safari aperto non basta).
   - Android/Chrome: funzionano, ma i timer in background vengono rallentati
     o sospesi dal sistema quando l'app non è in primo piano.
   - Firefox/desktop: Notification supportata, ServiceWorker showNotification
     supportata, ma nessuna garanzia di esecuzione a app chiusa.
   Non promettiamo quindi notifiche a app chiusa: lo diciamo chiaramente.
   ========================================================================== */

import { toast } from './ui.js';
import { getSetting, setSetting } from './store.js';

/* ---------------------------- PERMESSI ---------------------------------- */
export const notificationsSupported = () => 'Notification' in window;

export function permissionState() {
  if (!notificationsSupported()) return 'unsupported';
  return Notification.permission; // granted | denied | default
}

export async function requestPermission() {
  if (!notificationsSupported()) {
    toast('Questo browser non supporta le notifiche', 3200);
    return 'unsupported';
  }
  if (Notification.permission === 'granted') return 'granted';
  if (Notification.permission === 'denied') {
    toast('Notifiche bloccate: riattivale dalle impostazioni del browser', 3800);
    return 'denied';
  }
  try {
    const res = await Notification.requestPermission();
    await setSetting('notificationsEnabled', res === 'granted');
    if (res === 'granted') toast('Notifiche attivate ✅');
    else toast('Notifiche non attivate');
    return res;
  } catch (e) {
    return 'error';
  }
}

/** Diagnostica mostrata nella pagina Impostazioni. */
export function diagnostics() {
  const ua = navigator.userAgent;
  const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const perm = permissionState();
  const rows = [
    { label: 'API notifiche', ok: notificationsSupported(), note: notificationsSupported() ? 'disponibile' : 'non implementata nel browser' },
    { label: 'Permesso', ok: perm === 'granted', note: perm === 'granted' ? 'concesso' : perm === 'denied' ? 'negato' : perm === 'unsupported' ? 'non disponibile' : 'da richiedere' },
    { label: 'Service Worker', ok: !!navigator.serviceWorker?.controller || !!navigator.serviceWorker, note: navigator.serviceWorker ? 'registrato' : 'non disponibile' },
    { label: 'App installata', ok: standalone, note: standalone ? 'in esecuzione standalone' : 'aperta nel browser' }
  ];
  let advice = '';
  if (isIOS && !standalone) advice = 'Su iPhone le notifiche funzionano solo installando LifeOS nella schermata Home (iOS 16.4+).';
  else if (isIOS) advice = 'iOS consegna le notifiche web solo con l\'app in primo piano o poco dopo; per i promemoria critici usa un\'app di sistema.';
  else if (perm === 'denied') advice = 'Il permesso è bloccato: riabilitalo dalle impostazioni del sito nel browser.';
  else if (perm === 'granted') advice = 'Promemoria attivi mentre LifeOS è aperto. A app chiusa non possiamo garantirli senza un server push.';
  return { rows, advice, isIOS, standalone };
}

/* --------------------------- INVIO NOTIFICA ----------------------------- */

/**
 * Mostra una notifica. Ordine di preferenza:
 * 1) ServiceWorkerRegistration.showNotification (funziona anche in background
 *    breve ed è l'unico modo su Android per mantenere la notifica "ricca").
 * 2) new Notification(...) come fallback.
 * 3) Toast in-app come ultimo fallback.
 */
export async function showNotification(title, body, data = {}) {
  const payload = { body, tag: data.tag || `lifeos-${Date.now()}`, data: { url: data.url || './index.html#/home', ...data }, icon: 'icons/icon-192.png', badge: 'icons/favicon.png', vibrate: [90, 40, 90] };

  if (!notificationsSupported() || Notification.permission !== 'granted') {
    toast(`${title}${body ? ' — ' + body : ''}`, 4200);
    return { via: 'toast', ok: false };
  }

  // 1) Service worker
  try {
    if (navigator.serviceWorker) {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg?.showNotification) {
        await reg.showNotification(title, payload);
        return { via: 'sw', ok: true };
      }
    }
  } catch (e) { console.warn('[notify] sw fallito', e); }

  // 2) Notification diretta
  try {
    const n = new Notification(title, payload);
    n.onclick = () => { window.focus(); if (payload.data.url) location.hash = payload.data.url.replace(/^.*#/, '#'); };
    return { via: 'notification', ok: true };
  } catch (e) { console.warn('[notify] Notification fallita', e); }

  // 3) Fallback
  toast(`${title}${body ? ' — ' + body : ''}`, 4500);
  return { via: 'toast', ok: false };
}

/** Notifica di prova dal pannello impostazioni. */
export async function testNotification() {
  const perm = await requestPermission();
  if (perm !== 'granted') return false;
  return (await showNotification('LifeOS funziona 🎉', 'Questa è una notifica di prova.', { tag: 'test' })).ok;
}

/* ------------------------- RIPRISTINO ALL'APERTURA ---------------------- */
/**
 * Se l'app è stata chiusa e dei promemoria sono scaduti nel frattempo,
 * avvisa l'utente al riavvio (unica mitigazione possibile senza push).
 */
export async function notifyMissed(dueReminders) {
  if (!dueReminders.length) return;
  const n = dueReminders.length;
  const first = dueReminders[0];
  const body = n === 1
    ? `${first.title} — ${new Date(first.at).toLocaleString('it-IT', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`
    : `${n} promemoria mentre LifeOS era chiusa. Il primo: ${first.title}`;
  await showNotification('⏰ Promemoria arretrati', body, { tag: 'missed', url: './index.html#/reminders' });
}

export const notificationHint = () => getSetting('notificationsEnabled', false);
