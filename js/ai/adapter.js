/* ==========================================================================
   LifeOS — ai/adapter.js
   Punto di innesto per un modello AI reale (punto 21 della specifica).

   Perché esiste: tutta l'app chiama SOLO le funzioni esportate qui. Oggi
   rispondono con il parser locale a regole; domani, impostando un endpoint
   nelle Impostazioni, le stesse chiamate possono essere inoltrate a un LLM
   senza toccare le viste.

   CONTRATTO (non cambiarlo quando aggiungi un provider):
     interpret(text, ctx) -> Promise<Interpretation>
     Interpretation = {
       intent: 'event'|'task'|'note'|'idea'|'goal'|'journal'|'inbox',
       confidence: number,          // 0..1
       title: string,
       cleanText: string,
       entities: { when, durationMin, priority, recurrence, categoryId, tags, location },
       suggestion: string,
       provider: 'local-rules'|'remote'
     }
     classify(text, ctx)   -> Promise<{categoryId, tags, confidence}>
     summarize(text)       -> Promise<string>
     answer(question, ctx) -> Promise<string>
     suggestOrganizations(ctx) -> Promise<Array<{icon,text,route}>>
     capabilities() -> {remote:boolean, provider:string, ready:boolean}
   ========================================================================== */

import * as parser from './parser.js';
import { list, categoryById, rawSearch, globalStats, tasksOpen, tasksOverdue, goalsActive, pendingReminders } from '../store.js';

/* ------------------------- CONFIGURAZIONE ------------------------------- */
const config = {
  /** 'local-rules' (default) oppure 'remote'. */
  provider: 'local-rules',
  /** Endpoint compatibile con una chat completion. Vuoto = non configurato. */
  endpoint: '',
  apiKey: '',
  model: '',
  timeoutMs: 12000
};

export function configure(patch = {}) {
  Object.assign(config, patch || {});
  return { ...config };
}
export const getConfig = () => ({ ...config });

export function capabilities() {
  return {
    provider: config.provider,
    ready: config.provider === 'local-rules' || Boolean(config.endpoint),
    remote: config.provider === 'remote' && Boolean(config.endpoint),
    features: {
      interpret: true,
      classify: true,
      summarize: config.provider === 'remote' ? true : 'extractive',
      answer: config.provider === 'remote' ? true : 'keyword',
      suggestions: true
    }
  };
}

/* --------------------------- INTERPRETAZIONE ---------------------------- */
/**
 * Interpreta un testo libero (dettato o scritto).
 * @param {string} text
 * @param {{categories?:Array, now?:Date}} ctx
 * @returns {Promise<object>}
 */
export async function interpret(text, ctx = {}) {
  const local = parser.analyze(text, { categories: ctx.categories || list('categories'), now: ctx.now });
  const base = { ...local, provider: 'local-rules' };

  if (!capabilities().remote) return base;

  try {
    const remote = await callRemote('interpret', { text, hints: { categories: (ctx.categories || list('categories')).map((c) => ({ id: c.id, name: c.name })) } }, base);
    return remote || base;
  } catch (e) {
    console.warn('[ai] provider remoto non disponibile, uso il parser locale', e);
    return { ...base, provider: 'local-rules', fallbackReason: String(e.message || e) };
  }
}

/* ----------------------------- CLASSIFICA ------------------------------- */
export async function classify(text, ctx = {}) {
  const categories = ctx.categories || list('categories');
  const categoryId = parser.suggestCategory(text, categories);
  const tags = parser.parseTags(text);
  return { categoryId, tags, confidence: categoryId ? 0.6 : 0.25, provider: 'local-rules' };
}

/* ------------------------------ RIASSUNTO ------------------------------- */
/**
 * Senza provider remoto facciamo un riassunto estrattivo semplice
 * (frasi più "pesanti" per parole chiave), dichiarandolo apertamente.
 */
export async function summarize(text) {
  const src = String(text || '').trim();
  if (!src) return '';
  if (capabilities().remote) {
    try {
      const out = await callRemote('summarize', { text: src });
      if (out) return out;
    } catch (e) { /* fallback sotto */ }
  }
  const sentences = src.split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter((s) => s.length > 12);
  if (sentences.length <= 3) return src;
  const freq = {};
  src.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\p{L}\s]/gu, ' ').split(/\s+/)
    .filter((w) => w.length > 4).forEach((w) => { freq[w] = (freq[w] || 0) + 1; });
  const scored = sentences.map((s, i) => {
    const words = s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').split(/\s+/);
    const score = words.reduce((a, w) => a + (freq[w] || 0), 0) / Math.sqrt(words.length || 1);
    return { s, i, score };
  }).sort((a, b) => b.score - a.score).slice(0, 3).sort((a, b) => a.i - b.i);
  return '• ' + scored.map((x) => x.s).join('\n• ');
}

/* ------------------------------- DOMANDE -------------------------------- */
/**
 * Risponde a domande sui dati personali con ricerca per parole chiave.
 * Con un provider remoto si può passare in contesto l'estratto trovato.
 * @param {string} question
 * @param {{limit?:number}} ctx
 */
export async function answer(question, ctx = {}) {
  const q = String(question || '').trim();
  if (!q) return 'Scrivimi una domanda su ciò che ho salvato.';

  const results = rawSearch(q).slice(0, ctx.limit || 8);

  if (capabilities().remote && results.length) {
    try {
      const out = await callRemote('answer', { question: q, context: results.map((r) => ({ type: r.type, title: r.item.title || r.item.name || r.item.text })) });
      if (out) return out;
    } catch (e) { /* fallback */ }
  }

  if (!results.length) {
    return `Non ho trovato nulla su "${q}". Prova con altre parole, oppure aggiungi l'informazione a LifeOS.`;
  }
  const lines = results.map((r) => {
    const label = r.item.title || r.item.name || String(r.item.text || '').slice(0, 60);
    return `• ${r.type}: ${label}`;
  });
  return `Ho trovato ${results.length} elementi collegati a "${q}":\n${lines.join('\n')}`;
}

/* --------------------------- SUGGERIMENTI ------------------------------- */
export function suggestOrganizations() {
  const out = [];
  const overdue = tasksOverdue();
  const active = goalsActive();
  const pending = pendingReminders(new Date()).slice(0, 3);

  if (overdue.length) out.push({ icon: '🔴', text: `${overdue.length} attività scadute: vuoi ripianificarle?`, route: 'tasks?filter=expired' });
  if (active.length) out.push({ icon: '🎯', text: `Hai ${active.length} obiettivi attivi: controlla l'avanzamento.`, route: 'goals' });
  if (pending.length) out.push({ icon: '🔔', text: `Prossimo promemoria: ${pending[0].title}`, route: 'reminders' });
  const unCategorized = tasksOpen().filter((t) => !t.categoryId);
  if (unCategorized.length > 2) out.push({ icon: '📁', text: `${unCategorized.length} attività senza categoria`, route: 'tasks' });

  const counts = globalStats();
  if (!counts.notes && !counts.tasks) out.push({ icon: '🌱', text: 'Inizia aggiungendo la tua prima attività o nota.', route: 'home' });
  return out;
}

/* --------------------------- CHIAMATA REMOTA ---------------------------- */
/**
 * Chiamata generica a un provider compatibile con "chat completions".
 * Non viene mai usata se `provider !== 'remote'` o manca l'endpoint: la PWA
 * resta perfettamente funzionante offline e senza servizi cloud.
 */
async function callRemote(task, payload, fallback = null) {
  if (!config.endpoint) return fallback;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

  const system = `Sei il motore di LifeOS, un second brain personale.
Rispondi SEMPRE in italiano e SOLO con JSON valido, senza testo attorno.
Task: ${task}. Schema richiesto: ${
    task === 'interpret'
      ? '{"intent":"event|task|note|idea|goal|journal|inbox","confidence":0..1,"title":"...","cleanText":"...","entities":{"when":"ISO8601|null","durationMin":number|null,"priority":"urgent|normal|low|null","recurrence":{"freq":"none|daily|weekly|monthly|yearly","interval":1}|null,"categoryId":"string|null","tags":["..."],"location":"string|null"},"suggestion":"..."}'
      : task === 'summarize' ? '{"summary":"..."}'
        : '{"answer":"..."}'
  }`;

  try {
    const res = await fetch(config.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {})
      },
      body: JSON.stringify({
        model: config.model || undefined,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: JSON.stringify(payload) }
        ],
        temperature: 0.2
      }),
      signal: controller.signal
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content || data?.content || '';
    const parsed = JSON.parse(extractJson(text));
    if (task === 'summarize') return parsed.summary || fallback;
    if (task === 'answer') return parsed.answer || fallback;
    return { ...parsed, provider: 'remote' };
  } finally {
    clearTimeout(timeout);
  }
}

function extractJson(text) {
  const s = String(text || '');
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start === -1 || end === -1) return '{}';
  return s.slice(start, end + 1);
}

/** Contesto compatto dei dati, per futuri prompt. */
export function buildContext() {
  const counts = globalStats();
  return {
    counts,
    categories: list('categories').map((c) => ({ id: c.id, name: c.name, icon: c.icon })),
    today: new Date().toISOString(),
    topTasks: tasksOpen().slice(0, 10).map((t) => ({ title: t.title, due: t.due, priority: t.priority })),
    goals: goalsActive().slice(0, 5).map((g) => ({ name: g.name, progress: g.progress })),
    categoryName: (id) => categoryById(id)?.name || null
  };
}
