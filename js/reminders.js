/* ==========================================================================
   LifeOS — reminders.js
   Motore dei promemoria.

   COME FUNZIONA (con onestà sui limiti):
   - Mentre l'app è aperta (o in background per poco) un timer controlla ogni
     `notifyGranularityMin` i promemoria scaduti e li notifica.
   - Se il browser sospende i timer (app in background/schermo spento), al
     ritorno in primo piano eseguiamo subito un controllo.
   - I promemoria scaduti mentre l'app era chiusa vengono mostrati in un
     riepilogo ("Promemoria arretrati") alla riapertura.
   - Non promettiamo notifiche con l'app chiusa: senza push server nessun
     browser lo garantisce.
   ========================================================================== */

import { pendingReminders, markReminderFired, getSetting, on, _state } from './store.js';
import { showNotification, notifyMissed, permissionState } from './notifications.js';
import { offsetLabel, fmtDate, relTime } from './utils.js';

let timer = null;
let started = false;
const MISSED_KEY = 'lifeos_missed_shown_at';

/** Promemoria scaduti e non ancora notificati. */
export function dueNow(now = new Date()) {
  return _state.reminders.filter((r) => !r.fired && !r.done && new Date(r.at) <= now);
}

/** Promemoria scaduti prima dell'apertura dell'app (per il riepilogo). */
export function missedSince(sinceTs) {
  const now = Date.now();
  return dueNow().filter((r) => new Date(r.at).getTime() <= now && (!sinceTs || new Date(r.at).getTime() > sinceTs))
    .sort((a, b) => new Date(a.at) - new Date(b.at));
}

async function check({ notify = true } = {}) {
  const due = dueNow().sort((a, b) => new Date(a.at) - new Date(b.at));
  if (!due.length) return 0;
  const limit = 4; // evita raffiche di notifiche
  for (const r of due.slice(0, limit)) {
    const when = `⏰ ${r.refType === 'event' ? 'Evento' : r.refType === 'task' ? 'Attività' : 'Obiettivo'} · ${offsetLabel(r.offsetMin)}`;
    if (notify && permissionState() === 'granted') {
      await showNotification(r.title || 'Promemoria LifeOS', `${when}\n${fmtDate(r.at, 'datetime')}`, { tag: r.id, url: r.url });
    }
    await markReminderFired(r.id);
  }
  if (due.length > limit) await markReminderFired(due[limit].id);
  on('reminders', () => {});
  return due.length;
}

/** Avvia il ciclo di controllo periodico. */
export function startEngine() {
  if (started) return;
  started = true;

  // 1) riepilogo dei promemoria persi mentre l'app era chiusa
  let lastSeen = null;
  try { lastSeen = Number(localStorage.getItem(MISSED_KEY)) || null; } catch (e) {}
  const missed = missedSince(lastSeen);
  if (missed.length && permissionState() === 'granted') {
    setTimeout(() => notifyMissed(missed), 2600);
  }
  try { localStorage.setItem(MISSED_KEY, String(Date.now())); } catch (e) {}

  // 2) controllo periodico
  const everyMin = Math.max(1, Number(getSetting('notifyGranularityMin', 15)));
  scheduleTick(everyMin);

  // 3) controlli "reattivi" quando l'app torna in primo piano
  document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
  window.addEventListener('focus', () => check());
  window.addEventListener('online', () => check());
  on('reminders', () => { /* lo stato è cambiato: nessuna azione immediata */ });
}

function scheduleTick(minutes) {
  clearInterval(timer);
  timer = setInterval(() => check(), Math.max(60, minutes * 60) * 1000);
  // primo controllo poco dopo l'avvio
  setTimeout(() => check(), 4000);
}

/** Ricalcola l'intervallo se l'utente cambia le impostazioni. */
export function reschedule() {
  scheduleTick(Math.max(1, Number(getSetting('notifyGranularityMin', 15))));
}

/** Controllo manuale (dal pannello Promemoria). */
export const checkNow = () => check({ notify: true });

/** Anteprima: i prossimi N promemoria, con etichetta relativa. */
export function upcomingPreview(limit = 12) {
  return pendingReminders(new Date()).slice(0, limit).map((r) => ({
    ...r,
    when: `${relTime(r.at) === 'adesso' ? 'adesso' : fmtDate(r.at, 'datetime')}`,
    label: offsetLabel(r.offsetMin)
  }));
}

export function stopEngine() { clearInterval(timer); started = false; }

export const isRunning = () => started;
