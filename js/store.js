/* ==========================================================================
   LifeOS — store.js
   Livello applicativo sopra IndexedDB:
   - cache in memoria + persistenza su IndexedDB
   - event bus interno (le viste si aggiornano da sole)
   - categorie di default, impostazioni, statistiche e selettori utili
   - NESSUN dato viene mai cancellato automaticamente
   ========================================================================== */

import db, { S, ALL_STORES } from './db.js';
import {
  uid, nowISO, dayKey, startOfDay, endOfDay, addDays, isSameDay,
  sortBy, pct, norm, clamp
} from './utils.js';

/* ------------------------------- STATO ---------------------------------- */
const state = {
  tasks: [], events: [], notes: [], ideas: [], goals: [],
  journal: [], inbox: [], categories: [], reminders: [], customFields: [],
  settings: {}, ready: false
};

/** Chiave umana -> object store IndexedDB */
const STORE_MAP = {
  tasks: S.TASKS, events: S.EVENTS, notes: S.NOTES, ideas: S.IDEAS, goals: S.GOALS,
  journal: S.JOURNAL, inbox: S.INBOX, categories: S.CATEGORIES,
  reminders: S.REMINDERS, customFields: S.FIELDS
};

const listeners = new Map(); // event -> Set<fn>

export function on(event, cb) {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event).add(cb);
  return () => listeners.get(event)?.delete(cb);
}
function emit(event, payload) {
  listeners.get(event)?.forEach((cb) => { try { cb(payload); } catch (e) { console.error('[store] listener', event, e); } });
  listeners.get('*')?.forEach((cb) => { try { cb({ event, payload }); } catch (e) {} });
}

/* --------------------------- IMPOSTAZIONI ------------------------------- */
const DEFAULT_SETTINGS = {
  theme: 'auto',                  // auto | light | dark
  displayName: '',
  defaultRemindersEvent: [1440, 120, 30],
  defaultRemindersTask: [60],
  notificationsEnabled: false,
  notifyGranularityMin: 15,       // controllo periodico dei promemoria
  autoBackup: false,
  autoBackupKeep: 5,
  lastBackupAt: null,
  firstRunDone: false,
  weekStart: 1,                   // 1 = lunedì
  taskView: 'all',                // filtro attività persistito
  seenTips: []
};

export function getSetting(key, dflt) {
  if (key in state.settings) return state.settings[key];
  if (key in DEFAULT_SETTINGS) return DEFAULT_SETTINGS[key];
  return dflt;
}
export function allSettings() { return { ...DEFAULT_SETTINGS, ...state.settings }; }

export async function setSetting(key, value) {
  state.settings[key] = value;
  await db.put(S.SETTINGS, { key, value, updatedAt: nowISO() });
  emit('settings', { key, value });
  return value;
}
export async function setSettings(obj) {
  for (const [k, v] of Object.entries(obj)) await setSetting(k, v);
}

/* ------------------------------ INIZIO ---------------------------------- */
export async function init() {
  await db.openDB();

  const [tasks, events, notes, ideas, goals, journal, inbox, categories, reminders, customFields, settings] =
    await Promise.all([
      db.all(S.TASKS), db.all(S.EVENTS), db.all(S.NOTES), db.all(S.IDEAS), db.all(S.GOALS),
      db.all(S.JOURNAL), db.all(S.INBOX), db.all(S.CATEGORIES), db.all(S.REMINDERS),
      db.all(S.FIELDS), db.all(S.SETTINGS)
    ]);

  Object.assign(state, { tasks, events, notes, ideas, goals, journal, inbox, categories, reminders, customFields });
  settings.forEach((row) => { state.settings[row.key] = row.value; });

  if (!state.categories.length) await seedCategories();
  if (!state.settings.firstRunDone) await firstRun();

  state.ready = true;
  await rebuildReminders();
  emit('ready');
  emit('change');
  return state;
}

export const isReady = () => state.ready;

/** Categorie iniziali suggerite (l'utente può eliminarle o modificarle). */
async function seedCategories() {
  const seeds = [
    { name: 'Università', icon: '🎓', color: '#4f6df5', description: 'Esami, lezioni, studio' },
    { name: 'Informatica', icon: '💻', color: '#0ea5e9', description: 'Progetti, corsi, codice' },
    { name: 'Game Development', icon: '🎮', color: '#8b5cf6', description: 'Godot, prototipi, design' },
    { name: 'Musica', icon: '🎵', color: '#ec4899', description: 'Brani, pratica, ascolti' },
    { name: 'D&D', icon: '🎲', color: '#f59e0b', description: 'Sessioni, campagne, personaggi' },
    { name: 'Idee', icon: '💡', color: '#eab308', description: 'Brainstorming e spunti' },
    { name: 'Personale', icon: '📌', color: '#10b981', description: 'Vita quotidiana' },
    { name: 'Studio', icon: '📚', color: '#6366f1', description: 'Materiale e ripasso' }
  ];
  const rows = seeds.map((c, i) => ({ id: uid('cat'), order: i, createdAt: nowISO(), ...c }));
  await db.putMany(S.CATEGORIES, rows);
  state.categories = rows;
}

/** Prima esecuzione: imposta alcuni default e una nota di benvenuto. */
async function firstRun() {
  await setSettings({ firstRunDone: true, weekStart: 1 });
  const welcome = {
    id: uid('note'),
    title: 'Benvenuto in LifeOS 👋',
    text: [
      'Questa è la tua app personale: tutto vive sul tuo telefono.',
      '',
      '• Usa il pulsante + per creare eventi, attività, note, idee, obiettivi o pensieri.',
      '• Il microfono 🎤 accanto ai campi dettano il testo nella lingua del dispositivo.',
      '• "Parla con LifeOS" raccoglie un pensiero al volo e prova a capire cosa farne.',
      '• L\'Inbox raccoglie tutto senza obbligarti a decidere subito.',
      '• Da Altro → Backup puoi esportare un file JSON con tutti i tuoi dati.'
    ].join('\n'),
    categoryId: null,
    tags: ['lifeos'],
    archived: false,
    favorite: true,
    attachments: [],
    createdAt: nowISO(), updatedAt: nowISO(),
    source: 'system'
  };
  await db.put(S.NOTES, welcome);
  state.notes.unshift(welcome);
}

/* -------------------------- CRUD GENERICO ------------------------------- */

/**
 * Salva (crea o aggiorna) un elemento in uno store.
 * @param {'tasks'|'events'|'notes'|'ideas'|'goals'|'journal'|'inbox'|'categories'|'customFields'} name
 * @param {object} obj
 */
export async function save(name, obj) {
  const store = STORE_MAP[name];
  if (!store) throw new Error(`Store sconosciuto: ${name}`);
  const existing = obj.id ? await db.get(store, obj.id) : null;
  const rec = {
    ...existing, ...obj,
    id: obj.id || uid(name.slice(0, 4)),
    createdAt: obj.createdAt || existing?.createdAt || nowISO(),
    updatedAt: nowISO()
  };
  await db.put(store, rec);
  upsertInMemory(name, rec);
  emit('change', { store: name, action: existing ? 'update' : 'create', item: rec });
  emit(name, rec);
  // I promemoria derivano da eventi/attività/obiettivi
  if (name === 'events' || name === 'tasks' || name === 'goals') await rebuildReminders();
  return rec;
}

/**
 * Azzera la copia in memoria dello stato (usata dopo la cancellazione
 * completa dei dati). Non tocca il database.
 */
export function resetState() {
  for (const k of Object.keys(state)) {
    if (Array.isArray(state[k])) state[k] = [];
  }
  state.settings = { ...DEFAULT_SETTINGS };
  emit('change', { store: '*', action: 'reset' });
}

/**
 * Cancella definitivamente TUTTI i dati dell'utente: database IndexedDB e
 * copia in memoria. Viene invocata solo da un'azione esplicita e confermata.
 */
export async function wipeAllData() {
  await db.wipe();
  resetState();
}

export async function remove(name, id) {
  const store = STORE_MAP[name];
  if (!store) return;
  await db.del(store, id);
  state[name] = state[name].filter((x) => x.id !== id);
  // rimuove i promemoria collegati (solo quelli generati da questo elemento)
  const orphan = state.reminders.filter((r) => r.refId === id);
  if (orphan.length) {
    await db.delMany(S.REMINDERS, orphan.map((r) => r.id));
    const ids = new Set(orphan.map((r) => r.id));
    state.reminders = state.reminders.filter((r) => !ids.has(r.id));
  }
  emit('change', { store: name, action: 'delete', id });
  emit('delete', { store: name, id });
}

function upsertInMemory(name, rec) {
  const arr = state[name];
  const i = arr.findIndex((x) => x.id === rec.id);
  if (i >= 0) arr[i] = rec; else arr.unshift(rec);
}

/* --------------------------- LETTURE ------------------------------------ */
export const list = (name) => state[name] || [];
export const byId = (name, id) => (state[name] || []).find((x) => x.id === id) || null;
export const categoryById = (id) => state.categories.find((c) => c.id === id) || null;

export function categoryStyle(categoryId) {
  const c = categoryById(categoryId);
  if (!c) return { color: 'var(--text-3)', icon: '', name: 'Senza categoria' };
  return { color: c.color || 'var(--accent)', icon: c.icon || '📁', name: c.name };
}

/* --------------------------- SELEZIONI UTILI ---------------------------- */

/** Attività in scadenza oggi (incluse quelle scadute non completate). */
export function tasksToday() {
  const t0 = startOfDay(); const t1 = endOfDay();
  return sortBy(state.tasks.filter((t) => {
    if (!t.due) return false;
    const d = new Date(t.due);
    return d >= t0 && d <= t1;
  }), (t) => new Date(t.due).getTime());
}

export function tasksOverdue() {
  const now = Date.now();
  return sortBy(state.tasks.filter((t) => t.status !== 'done' && t.due && new Date(t.due).getTime() < now && !isTodayTask(t)),
    (t) => new Date(t.due).getTime());
}
function isTodayTask(t) { return t.due && isSameDay(new Date(t.due), new Date()); }

export function tasksOpen() {
  return state.tasks.filter((t) => t.status !== 'done');
}

/** Priorità calcolata: tiene conto di scadenza + priorità dichiarata. */
export function effectiveStatus(task) {
  if (task.status === 'done') return 'done';
  if (task.due && new Date(task.due).getTime() < Date.now()) return 'expired';
  return task.status || 'todo';
}

export function eventsBetween(from, to) {
  return sortBy(state.events.filter((e) => {
    const s = new Date(expandStart(e));
    return s >= from && s <= to;
  }), (e) => new Date(expandStart(e)).getTime());
}

export function upcomingEvents(limit = 5) {
  const now = new Date();
  return sortBy(state.events.filter((e) => new Date(expandStart(e)) >= startOfDay(now)), (e) => new Date(expandStart(e)).getTime()).slice(0, limit);
}

export function eventsOnDay(date) {
  const t0 = startOfDay(date); const t1 = endOfDay(date);
  return sortBy(state.events.filter((e) => {
    const s = new Date(expandStart(e));
    const en = new Date(e.end || e.start);
    return (s >= t0 && s <= t1) || (s <= t0 && en >= t0);
  }), (e) => new Date(expandStart(e)).getTime());
}

/** Per gli eventi ricorrenti usa sempre la data di inizio canonica. */
function expandStart(e) { return e.start || e.date || nowISO(); }

/** Prossimi giorni con almeno un evento (per il badge nella Home). */
export function nextEvent() { return upcomingEvents(1)[0] || null; }

export function notesRecent(limit = 3) {
  return sortBy(state.notes.filter((n) => !n.archived), (n) => new Date(n.updatedAt || n.createdAt).getTime(), -1).slice(0, limit);
}
export function ideasRecent(limit = 3) {
  return sortBy(state.ideas, (n) => new Date(n.createdAt).getTime(), -1).slice(0, limit);
}

export function goalsActive() {
  return state.goals.filter((g) => (g.progress || 0) < 100);
}

/* --------------------------- STATISTICHE --------------------------------- */
export function dayStats(date = new Date()) {
  const t0 = startOfDay(date); const t1 = endOfDay(date);
  const dueToday = state.tasks.filter((t) => t.due && new Date(t.due) >= t0 && new Date(t.due) <= t1);
  const done = dueToday.filter((t) => t.status === 'done');
  const overdue = tasksOverdue();
  const urgent = state.tasks.filter((t) => t.status !== 'done' && t.priority === 'urgent');
  const normal = state.tasks.filter((t) => t.status !== 'done' && t.priority === 'normal');
  const low = state.tasks.filter((t) => t.status !== 'done' && t.priority === 'low');
  const evts = eventsOnDay(date);
  const inboxNew = state.inbox.filter((i) => !i.processed);
  const newIdeas = state.ideas.filter((i) => isSameDay(new Date(i.createdAt), new Date()));

  // Percentuale della giornata: attività con scadenza oggi + eventi già conclusi
  const plannedEvents = evts.length;
  const pastEvents = evts.filter((e) => new Date(e.end || e.start) < new Date()).length;
  const totalUnits = dueToday.length + plannedEvents;
  const doneUnits = done.length + pastEvents;

  return {
    dueToday, doneToday: done, overdue, urgent, normal, low, events: evts,
    inboxNew, newIdeas,
    progress: totalUnits ? pct(doneUnits, totalUnits) : (overdue.length ? 0 : 100),
    openTasks: state.tasks.filter((t) => t.status !== 'done').length
  };
}

export function globalStats() {
  return {
    tasks: state.tasks.length,
    tasksOpen: state.tasks.filter((t) => t.status !== 'done').length,
    events: state.events.length,
    notes: state.notes.length,
    ideas: state.ideas.length,
    goals: state.goals.length,
    journal: state.journal.length,
    inbox: state.inbox.filter((i) => !i.processed).length,
    categories: state.categories.length,
    reminders: state.reminders.filter((r) => !r.fired).length
  };
}

/* ----------------------------- RICERCA ---------------------------------- */
/** Ricerca testuale su tutte le collezioni (usata da search.js). */
export function rawSearch(query) {
  const q = norm(query).trim();
  if (!q) return [];
  const terms = q.split(/\s+/).filter(Boolean);
  const out = [];

  const matches = (...fields) => {
    const hay = norm(fields.filter(Boolean).join(' '));
    return terms.every((t) => hay.includes(t));
  };

  state.tasks.forEach((t) => { if (matches(t.title, t.description, (t.tags || []).join(' '))) out.push({ type: 'task', item: t }); });
  state.events.forEach((e) => { if (matches(e.title, e.description, e.location, e.notes)) out.push({ type: 'event', item: e }); });
  state.notes.forEach((n) => { if (matches(n.title, n.text, (n.tags || []).join(' '))) out.push({ type: 'note', item: n }); });
  state.ideas.forEach((i) => { if (matches(i.title, i.description, i.notes, (i.tags || []).join(' '))) out.push({ type: 'idea', item: i }); });
  state.goals.forEach((g) => { if (matches(g.name, g.description, g.notes)) out.push({ type: 'goal', item: g }); });
  state.journal.forEach((j) => { if (matches(j.text, (j.tags || []).join(' '))) out.push({ type: 'journal', item: j }); });
  state.inbox.forEach((i) => { if (matches(i.text)) out.push({ type: 'inbox', item: i }); });

  return out;
}

/** Duplica un elemento (utile per attività ricorrenti "a mano"). */
export async function duplicate(name, id) {
  const item = byId(name, id);
  if (!item) return null;
  const copy = { ...item, id: undefined, createdAt: undefined, updatedAt: undefined };
  if (copy.title) copy.title = `${copy.title} (copia)`;
  if (copy.name) copy.name = `${copy.name} (copia)`;
  return save(name, copy);
}

/* --------------------------- PROMEMORIA --------------------------------- */
/**
 * Rigenera i record di promemoria a partire da eventi/attività/obiettivi.
 * Gli offset sono definiti dall'utente per ogni elemento (minuti prima).
 * I record già generati mantengono lo stato "fired".
 */
export async function rebuildReminders() {
  const wanted = new Map();

  const addFor = (refType, ref, baseISO, offsets, label) => {
    if (!baseISO) return;
    const base = new Date(baseISO).getTime();
    (offsets || []).forEach((min) => {
      const at = new Date(base - Number(min) * 60000);
      const id = `${refType}:${ref.id}:${min}`;
      wanted.set(id, {
        id, refType, refId: ref.id, offsetMin: Number(min),
        at: at.toISOString(), title: label, url: refType === 'event' ? '#/calendar' : refType === 'task' ? '#/tasks' : '#/goals',
        done: ref.status === 'done'
      });
    });
  };

  state.events.forEach((e) => addFor('event', e, e.start, e.reminders, e.title));
  state.tasks.forEach((t) => addFor('task', t, t.due, t.reminders, t.title));
  state.goals.forEach((g) => addFor('goal', g, g.due, g.reminders, g.name));

  const existing = new Map(state.reminders.map((r) => [r.id, r]));
  const next = [];
  const toPut = [];

  for (const [id, rec] of wanted) {
    const prev = existing.get(id);
    const merged = { ...rec, fired: prev?.fired || false, firedAt: prev?.firedAt || null };
    // se l'orario è cambiato, il promemoria torna da inviare
    if (prev && prev.at !== rec.at) { merged.fired = false; merged.firedAt = null; }
    next.push(merged);
    if (!prev || prev.at !== merged.at || prev.title !== merged.title || prev.done !== merged.done) toPut.push(merged);
  }

  const toDelete = state.reminders.filter((r) => !wanted.has(r.id)).map((r) => r.id);

  if (toPut.length) await db.putMany(S.REMINDERS, toPut);
  if (toDelete.length) await db.delMany(S.REMINDERS, toDelete);

  state.reminders = next;
  emit('reminders', next);
  return next;
}

/** Promemoria non ancora inviati, ordinati per orario. */
export function pendingReminders(from = new Date()) {
  return sortBy(
    state.reminders.filter((r) => !r.fired && !r.done && new Date(r.at) >= from),
    (r) => new Date(r.at).getTime()
  );
}

export async function markReminderFired(id) {
  const r = state.reminders.find((x) => x.id === id);
  if (!r) return;
  r.fired = true; r.firedAt = nowISO();
  await db.put(S.REMINDERS, r);
  emit('reminders', state.reminders);
}

/* ---------------------------- IMPORTAZIONE ------------------------------ */
/** Sostituisce o unisce i dati (usato da backup.js). */
export async function importData(payload, { merge = false } = {}) {
  const stores = ['tasks', 'events', 'notes', 'ideas', 'goals', 'journal', 'inbox', 'categories', 'reminders', 'customFields'];
  if (!merge) {
    for (const name of stores) {
      await db.clear(STORE_MAP[name]);
      state[name] = [];
    }
  }
  for (const name of stores) {
    const rows = Array.isArray(payload[name]) ? payload[name] : [];
    if (!rows.length) continue;
    await db.putMany(STORE_MAP[name], rows);
    const map = new Map(state[name].map((x) => [x.id, x]));
    rows.forEach((r) => map.set(r.id, r));
    state[name] = [...map.values()];
  }
  if (payload.settings && typeof payload.settings === 'object') {
    for (const [k, v] of Object.entries(payload.settings)) await setSetting(k, v);
  }
  await rebuildReminders();
  emit('change', { store: '*', action: 'import' });
  return globalStats();
}

/** Esporta tutto in un oggetto serializzabile. */
export function exportData() {
  return {
    app: 'LifeOS',
    schema: 1,
    exportedAt: nowISO(),
    counts: globalStats(),
    settings: { ...state.settings },
    categories: state.categories,
    tasks: state.tasks,
    events: state.events,
    notes: state.notes,
    ideas: state.ideas,
    goals: state.goals,
    journal: state.journal,
    inbox: state.inbox,
    reminders: state.reminders,
    customFields: state.customFields
  };
}

/** Verifica l'integrità minima di un backup importato. */
export function validateBackup(obj) {
  if (!obj || typeof obj !== 'object') return { ok: false, error: 'File non valido' };
  const known = ['tasks', 'events', 'notes', 'ideas', 'goals', 'journal', 'inbox', 'categories'];
  const hasAny = known.some((k) => Array.isArray(obj[k]));
  if (!hasAny) return { ok: false, error: 'Il file non contiene dati LifeOS riconoscibili' };
  return { ok: true };
}

export const _state = state;
export const _stores = STORE_MAP;
export const _allStores = ALL_STORES;
