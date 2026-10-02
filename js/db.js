/* ==========================================================================
   LifeOS — db.js
   Wrapper IndexedDB senza dipendenze.
   - Schema versionato con onupgradeneeded (migrazioni cumulative)
   - API a Promise (get / getAll / put / del / index / count)
   - Nessuna cancellazione automatica dei dati: solo wipe() esplicito
   ========================================================================== */

export const DB_NAME = 'lifeos';
export const DB_VERSION = 1;

/** Nomi degli object store. */
export const S = {
  TASKS: 'tasks',
  EVENTS: 'events',
  NOTES: 'notes',
  IDEAS: 'ideas',
  GOALS: 'goals',
  JOURNAL: 'journal',
  INBOX: 'inbox',
  CATEGORIES: 'categories',
  REMINDERS: 'reminders',
  FIELDS: 'customFields',
  SETTINGS: 'settings'
};

export const ALL_STORES = Object.values(S);

let _db = null;

/** Apre (o crea/aggiorna) il database. Idempotente. */
export function openDB() {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) {
      reject(new Error('IndexedDB non supportato su questo browser'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (event) => {
      const db = req.result;
      const oldVersion = event.oldVersion;

      /* --- v1: creazione iniziale di tutti gli store --- */
      if (oldVersion < 1) {
        // attività
        const tasks = db.createObjectStore(S.TASKS, { keyPath: 'id' });
        tasks.createIndex('status', 'status');
        tasks.createIndex('due', 'due');
        tasks.createIndex('categoryId', 'categoryId');
        tasks.createIndex('updatedAt', 'updatedAt');

        // eventi
        const events = db.createObjectStore(S.EVENTS, { keyPath: 'id' });
        events.createIndex('start', 'start');
        events.createIndex('categoryId', 'categoryId');

        // note
        const notes = db.createObjectStore(S.NOTES, { keyPath: 'id' });
        notes.createIndex('updatedAt', 'updatedAt');
        notes.createIndex('categoryId', 'categoryId');
        notes.createIndex('archived', 'archived');

        // idee
        const ideas = db.createObjectStore(S.IDEAS, { keyPath: 'id' });
        ideas.createIndex('createdAt', 'createdAt');
        ideas.createIndex('status', 'status');

        // obiettivi
        const goals = db.createObjectStore(S.GOALS, { keyPath: 'id' });
        goals.createIndex('due', 'due');

        // diario / pensieri
        const journal = db.createObjectStore(S.JOURNAL, { keyPath: 'id' });
        journal.createIndex('date', 'date');

        // inbox
        const inbox = db.createObjectStore(S.INBOX, { keyPath: 'id' });
        inbox.createIndex('createdAt', 'createdAt');

        // categorie
        db.createObjectStore(S.CATEGORIES, { keyPath: 'id' });

        // promemoria programmati/generati
        const reminders = db.createObjectStore(S.REMINDERS, { keyPath: 'id' });
        reminders.createIndex('at', 'at');
        reminders.createIndex('refId', 'refId');

        // campi personalizzati dell'utente
        db.createObjectStore(S.FIELDS, { keyPath: 'id' });

        // impostazioni (chiave/valore)
        db.createObjectStore(S.SETTINGS, { keyPath: 'key' });
      }

      /* Qui andrebbero le migrazioni future:
         if (oldVersion < 2) { ... }  */
    };

    req.onsuccess = () => {
      _db = req.result;
      // Se un'altra scheda aggiorna lo schema, non bloccare: chiudi e ricarica.
      _db.onversionchange = () => { _db.close(); _db = null; };
      resolve(_db);
    };
    req.onerror = () => reject(req.error || new Error('Apertura IndexedDB non riuscita'));
    req.onblocked = () => reject(new Error('Database bloccato da un\'altra scheda aperta'));
  });
}

function tx(store, mode) {
  if (!_db) throw new Error('Database non inizializzato: chiamare openDB() prima');
  return _db.transaction(store, mode).objectStore(store);
}

/** Esegue una richiesta IDB e la converte in Promise. */
function p(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export const db = {
  /* Apre/crea il database: esposto anche sull'oggetto per comodita' */
  openDB,

  async get(store, id) { return p(tx(store, 'readonly').get(id)); },

  async all(store) { return p(tx(store, 'readonly').getAll()); },

  async put(store, value) { return p(tx(store, 'readwrite').put(value)); },

  async putMany(store, values) {
    if (!values || !values.length) return 0;
    const os = tx(store, 'readwrite');
    await Promise.all(values.map((v) => p(os.put(v))));
    return values.length;
  },

  async del(store, id) { return p(tx(store, 'readwrite').delete(id)); },

  async delMany(store, ids) {
    const os = tx(store, 'readwrite');
    await Promise.all(ids.map((id) => p(os.delete(id))));
    return ids.length;
  },

  async clear(store) { return p(tx(store, 'readwrite').clear()); },

  async count(store) { return p(tx(store, 'readonly').count()); },

  /** Ricerca tramite indice. */
  async byIndex(store, indexName, value) {
    const os = tx(store, 'readonly');
    if (!os.indexNames.contains(indexName)) return [];
    return p(os.index(indexName).getAll(value));
  },

  /** Cancella TUTTI i dati (usato solo da azione esplicita dell'utente). */
  async wipe() {
    if (!_db) await openDB();
    for (const s of ALL_STORES) {
      try { await p(tx(s, 'readwrite').clear()); } catch (e) { /* store inesistente */ }
    }
  },

  /** Dimensione stimata dei dati (se il browser la espone). */
  async usage() {
    try {
      if (navigator.storage && navigator.storage.estimate) {
        return await navigator.storage.estimate();
      }
    } catch (e) { /* noop */ }
    return null;
  }
};

export default db;
