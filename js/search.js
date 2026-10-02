/* ==========================================================================
   LifeOS — search.js
   Ricerca globale con filtri: tipo, categoria, stato, priorità, periodo.
   Nessun indice esterno: filtra in memoria le collezioni dello store.
   ========================================================================== */

import { rawSearch, list, categoryById, effectiveStatus, eventsOnDay } from './store.js';
import { norm, startOfDay, addDays, fmtDate, relDay, dayKey } from './utils.js';
import { occurrencesBetween } from './recur.js';

/** Etichette e icone per ciascun tipo. */
export const TYPE_META = {
  task: { icon: '✅', label: 'Attività', route: 'tasks' },
  event: { icon: '📅', label: 'Eventi', route: 'calendar' },
  note: { icon: '📝', label: 'Note', route: 'notes' },
  idea: { icon: '💡', label: 'Idee', route: 'ideas' },
  goal: { icon: '🎯', label: 'Obiettivi', route: 'goals' },
  journal: { icon: '📖', label: 'Diario', route: 'journal' },
  inbox: { icon: '📥', label: 'Inbox', route: 'inbox' }
};

export const RANGE_OPTIONS = [
  { value: 'all', label: 'Sempre' },
  { value: 'today', label: 'Oggi' },
  { value: 'week', label: 'Prossimi 7 giorni' },
  { value: 'month', label: 'Prossimi 30 giorni' },
  { value: 'past', label: 'Scaduti / passati' },
  { value: 'nodate', label: 'Senza data' }
];

export const STATUS_OPTIONS = [
  { value: '', label: 'Tutti gli stati' },
  { value: 'todo', label: 'Da fare' },
  { value: 'doing', label: 'In corso' },
  { value: 'done', label: 'Completati' },
  { value: 'expired', label: 'Scaduti' }
];

/** Data "significativa" di un elemento, per i filtri temporali. */
function itemDate(type, item) {
  switch (type) {
    case 'task': return item.due ? new Date(item.due) : null;
    case 'event': return new Date(item.start || item.date);
    case 'goal': return item.due ? new Date(item.due) : null;
    case 'journal': return new Date(item.date || item.createdAt);
    case 'note': case 'idea': case 'inbox': default: return new Date(item.createdAt || item.updatedAt);
  }
}

/** Stato normalizzato per il filtro. */
function itemStatus(type, item) {
  if (type === 'task') return effectiveStatus(item);
  if (type === 'idea') return item.status || 'idea';
  if (type === 'goal') return (item.progress || 0) >= 100 ? 'done' : 'doing';
  if (type === 'event') return new Date(item.start) < new Date() ? 'done' : 'todo';
  return '';
}

/**
 * Esegue la ricerca completa.
 * @param {{query?:string, types?:string[], categoryId?:string, status?:string,
 *          priority?:string, range?:string, from?:string, to?:string, limit?:number}} f
 */
export function search(f = {}) {
  const {
    query = '', types = [], categoryId = '', status = '', priority = '',
    range = 'all', from = null, to = null, limit = 200
  } = f;

  let results = query.trim() ? rawSearch(query) : defaultAll();

  // filtro tipo
  if (types.length) results = results.filter((r) => types.includes(r.type));

  // filtro categoria
  if (categoryId) results = results.filter((r) => r.item.categoryId === categoryId);

  // filtro stato
  if (status) results = results.filter((r) => itemStatus(r.type, r.item) === status);

  // filtro priorità (attività + eventi + obiettivi)
  if (priority) results = results.filter((r) => (r.item.priority || 'normal') === priority);

  // filtro periodo
  const today = startOfDay(new Date());
  if (range !== 'all' || from || to) {
    results = results.filter((r) => {
      // per gli eventi ricorrenti consideriamo anche le occorrenze
      if (r.type === 'event' && r.item.recurrence?.freq && r.item.recurrence.freq !== 'none') {
        const wFrom = from ? new Date(from) : startOfDay();
        const wTo = to ? new Date(to) : addDays(today, 365);
        return occurrencesBetween(r.item, wFrom, wTo).length > 0;
      }
      const d = itemDate(r.type, r.item);
      if (range === 'nodate') return !d;
      if (!d) return false;
      const t = d.getTime();
      switch (range) {
        case 'today': return d >= today && d < addDays(today, 1);
        case 'week': return d >= today && d < addDays(today, 7);
        case 'month': return d >= today && d < addDays(today, 30);
        case 'past': return t < Date.now();
        default:
          if (from && t < new Date(from).getTime()) return false;
          if (to && t > new Date(to).getTime() + 86399000) return false;
          return true;
      }
    });
  }

  // ordinamento: più recenti/rilevanti prima
  results.sort((a, b) => {
    const da = itemDate(a.type, a.item)?.getTime() || 0;
    const db_ = itemDate(b.type, b.item)?.getTime() || 0;
    return db_ - da;
  });

  return { total: results.length, items: results.slice(0, limit), query, filters: f };
}

/** Senza query: mostra tutto ciò che è recente, così la pagina non è mai vuota. */
function defaultAll() {
  const out = [];
  list('tasks').forEach((i) => out.push({ type: 'task', item: i }));
  list('events').forEach((i) => out.push({ type: 'event', item: i }));
  list('notes').forEach((i) => out.push({ type: 'note', item: i }));
  list('ideas').forEach((i) => out.push({ type: 'idea', item: i }));
  list('goals').forEach((i) => out.push({ type: 'goal', item: i }));
  list('journal').forEach((i) => out.push({ type: 'journal', item: i }));
  list('inbox').forEach((i) => out.push({ type: 'inbox', item: i }));
  return out;
}

/** Suggerimenti: elementi aperti/senza categoria (utile nella Home). */
export function suggestions() {
  const openNoDue = list('tasks').filter((t) => t.status !== 'done' && !t.due);
  const inboxOpen = list('inbox').filter((i) => !i.processed);
  const staleIdeas = list('ideas').filter((i) => (i.status === 'idea') && Date.now() - new Date(i.createdAt).getTime() > 1000 * 3600 * 24 * 30);
  const out = [];
  if (inboxOpen.length) out.push({ icon: '📥', text: `${inboxOpen.length} elementi in Inbox da smistare`, route: 'inbox' });
  if (openNoDue.length) out.push({ icon: '📌', text: `${openNoDue.length} attività senza scadenza: vuoi assegnare una data?`, route: 'tasks?filter=nodue' });
  if (staleIdeas.length) out.push({ icon: '💡', text: `${staleIdeas.length} idee ferme da più di 30 giorni`, route: 'ideas' });
  return out;
}

/** Evidenzia i termini trovati in un testo (ritorna HTML sicuro). */
export function highlight(text, query) {
  const src = String(text || '');
  const terms = norm(query).split(/\s+/).filter((t) => t.length > 1);
  if (!terms.length) return escapeHtml(src);
  let out = escapeHtml(src);
  const seen = new Set();
  terms.forEach((t) => {
    if (seen.has(t)) return;
    seen.add(t);
    // cerca senza accenti nel testo normalizzato e riporta gli indici
    const hay = norm(out);
    let i = 0;
    let guard = 0;
    while (guard++ < 40) {
      const pos = hay.indexOf(t, i);
      if (pos === -1) break;
      const before = out.slice(0, pos);
      const match = out.slice(pos, pos + t.length);
      const after = out.slice(pos + t.length);
      out = `${before}<mark style="background:var(--accent-soft);color:var(--accent);border-radius:4px">${match}</mark>${after}`;
      i = pos + t.length + 60;
      break; // una sola evidenziazione per termine: mantiene l'HTML pulito
    }
  });
  return out;
}

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Riepilogo testuale dei filtri attivi. */
export function filtersSummary(f) {
  const parts = [];
  if (f.types?.length) parts.push(f.types.map((t) => TYPE_META[t]?.label || t).join(', '));
  if (f.categoryId) parts.push(categoryById(f.categoryId)?.name || 'Categoria');
  if (f.status) parts.push(STATUS_OPTIONS.find((s) => s.value === f.status)?.label || f.status);
  if (f.priority) parts.push({ urgent: 'Urgenti', normal: 'Normali', low: 'Bassa priorità' }[f.priority] || f.priority);
  if (f.range && f.range !== 'all') parts.push(RANGE_OPTIONS.find((r) => r.value === f.range)?.label || f.range);
  return parts.join(' · ');
}
