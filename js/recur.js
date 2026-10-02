/* ==========================================================================
   LifeOS — recur.js
   Gestione delle ricorrenze per gli eventi (nessuna dipendenza esterna).
   Un evento con `recurrence: {freq, interval, until, count}` genera occorrenze
   virtuali: non vengono mai salvate come copie, sono calcolate al volo.
   freq: 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly'
   ========================================================================== */

import { addDays, addMinutes, dayKey } from './utils.js';

export const FREQ_IT = {
  none: 'Nessuna',
  daily: 'Ogni giorno',
  weekly: 'Ogni settimana',
  monthly: 'Ogni mese',
  yearly: 'Ogni anno'
};

export const FREQ_OPTIONS = Object.entries(FREQ_IT).map(([value, label]) => ({ value, label }));

export function normalizeRecurrence(r) {
  if (!r || !r.freq || r.freq === 'none') return null;
  return {
    freq: r.freq,
    interval: Math.max(1, Number(r.interval) || 1),
    until: r.until || null,
    count: r.count ? Number(r.count) : null
  };
}

/** Sposta una data avanti di una "unità" di ricorrenza. */
function step(date, rec) {
  const d = new Date(date);
  switch (rec.freq) {
    case 'daily': return addDays(d, rec.interval);
    case 'weekly': return addDays(d, 7 * rec.interval);
    case 'monthly': {
      const day = d.getDate();
      const target = new Date(d);
      target.setDate(1);
      target.setMonth(target.getMonth() + rec.interval);
      const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
      target.setDate(Math.min(day, lastDay));
      return target;
    }
    case 'yearly': {
      const target = new Date(d);
      const day = target.getDate();
      target.setDate(1);
      target.setFullYear(target.getFullYear() + rec.interval);
      target.setMonth(new Date(d).getMonth());
      const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
      target.setDate(Math.min(day, lastDay));
      return target;
    }
    default: return null;
  }
}

/** Durata dell'evento in millisecondi (fallback: 1 ora). */
export function eventDuration(e) {
  const start = new Date(e.start);
  const end = e.end ? new Date(e.end) : addMinutes(start, Number(e.durationMin) || 60);
  return Math.max(0, end - start);
}

/**
 * Tutte le occorrenze di un evento che cadono nell'intervallo [from, to].
 * Se l'evento non è ricorrente restituisce 0 o 1 occorrenza.
 * @returns {Array<{start:Date, end:Date, index:number, key:string}>}
 */
export function occurrencesBetween(event, from, to) {
  const out = [];
  const base = new Date(event.start || event.date);
  if (isNaN(base)) return out;
  const dur = eventDuration(event);
  const rec = normalizeRecurrence(event.recurrence);

  if (!rec) {
    if (base >= from && base <= to) out.push({ start: base, end: new Date(base.getTime() + dur), index: 0, key: dayKey(base) });
    return out;
  }

  const untilTs = rec.until ? new Date(rec.until).getTime() : null;
  let cur = new Date(base);
  let i = 0;
  const hardLimit = 800; // protezione contro loop infiniti

  while (i < hardLimit && cur <= to) {
    if (untilTs !== null && cur.getTime() > untilTs) break;
    if (rec.count && i >= rec.count) break;
    if (cur >= from) {
      out.push({ start: new Date(cur), end: new Date(cur.getTime() + dur), index: i, key: dayKey(cur) });
    } else if (rec.count && i >= rec.count) break;
    const next = step(cur, rec);
    if (!next || isNaN(next) || next.getTime() <= cur.getTime()) break;
    cur = next;
    i++;
  }
  return out;
}

/** Prossima occorrenza dalla data indicata (anche passata). */
export function nextOccurrence(event, from = new Date()) {
  const horizon = addDays(from, 400);
  const list = occurrencesBetween(event, new Date(Math.min(from.getTime(), new Date(event.start).getTime())), horizon);
  return list.find((o) => o.start >= from) || list[list.length - 1] || null;
}

/** Descrizione breve della ricorrenza, per le card. */
export function recurrenceLabel(r) {
  const rec = normalizeRecurrence(r);
  if (!rec) return '';
  const base = FREQ_IT[rec.freq] || '';
  return rec.interval > 1 ? `${base} (ogni ${rec.interval})` : base;
}
