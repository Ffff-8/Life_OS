/* ==========================================================================
   LifeOS — ai/parser.js
   Parser locale a regole (nessun modello, nessuna rete).
   Serve a due scopi:
   1) far funzionare "Parla con LifeOS" anche offline, riconoscendo date,
      orari, priorità e intento in italiano;
   2) essere il punto di ingresso sostituibile da un modello AI reale in
      futuro (vedi ai/adapter.js): l'oggetto restituito ha sempre la stessa
      forma (intent + entities + confidence).
   ========================================================================== */

import { addDays, startOfDay, dayKey, capitalize } from '../utils.js';

const GIORNI = { lunedi: 1, martedi: 2, mercoledi: 3, giovedi: 4, venerdi: 5, sabato: 6, domenica: 0 };

function strip(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // rimuove gli accenti
    .replace(/\s+/g, ' ')
    .trim();
}

/* ------------------------- RICONOSCIMENTO DATE -------------------------- */
/** Converte i numeri in parole fino a 30 in cifre ("due ore" -> "2 ore"). */
const NUM_WORDS = {
  un: 1, uno: 1, una: 1, due: 2, tre: 3, quattro: 4, cinque: 5, sei: 6, sette: 7,
  otto: 8, nove: 9, dieci: 10, undici: 11, dodici: 12, quindici: 15, venti: 20,
  trenta: 30, quarantacinque: 45, mezzora: 0.5, mezz: 0.5
};

function wordsToNumbers(text) {
  let out = text;
  Object.entries(NUM_WORDS).forEach(([w, n]) => {
    out = out.replace(new RegExp(`\\b${w}\\b`, 'g'), String(n));
  });
  return out;
}

const MONTHS = {
  gennaio: 0, febbraio: 1, marzo: 2, aprile: 3, maggio: 4, giugno: 5,
  luglio: 6, agosto: 7, settembre: 8, ottobre: 9, novembre: 10, dicembre: 11,
  gen: 0, feb: 1, mar: 2, apr: 3, mag: 4, giu: 5, lug: 6, ago: 7, set: 8, ott: 9, nov: 10, dic: 11
};

/**
 * Estrae una data dal testo.
 * Supporta: "oggi", "domani", "dopodomani", "lunedì", "giovedì prossimo",
 * "il 15 ottobre", "15/10", "tra 3 giorni", "la settimana prossima".
 */
export function parseDate(text, now = new Date()) {
  const t = wordsToNumbers(strip(text));
  const today = startOfDay(now);

  if (/\bdopodomani\b/.test(t)) return { date: addDays(today, 2), matched: 'dopodomani' };
  if (/\bdomani\b/.test(t)) return { date: addDays(today, 1), matched: 'domani' };
  if (/\boggi\b|\bstasera\b|\bstamattina\b|\bstanotte\b/.test(t)) return { date: today, matched: 'oggi' };

  // "tra N giorni / settimane / mesi"
  let m = t.match(/\btra (\d+) (giorn|settiman|mes)/);
  if (m) {
    const n = Number(m[1]);
    const unit = m[2];
    if (unit.startsWith('settiman')) return { date: addDays(today, 7 * n), matched: `tra ${n} settimane` };
    if (unit.startsWith('mes')) {
      const d = new Date(today); d.setMonth(d.getMonth() + n); return { date: d, matched: `tra ${n} mesi` };
    }
    return { date: addDays(today, n), matched: `tra ${n} giorni` };
  }
  if (/\b(settimana|settimana prossima|la prossima settimana)\b/.test(t) && !/\btra \d/.test(t)) {
    return { date: addDays(today, 7), matched: 'settimana prossima' };
  }
  if (/\bmese prossimo\b/.test(t)) {
    const d = new Date(today); d.setMonth(d.getMonth() + 1); return { date: d, matched: 'mese prossimo' };
  }

  // giorno della settimana: "lunedì", "venerdì prossimo", "il martedì"
  for (const [name, dow] of Object.entries(GIORNI)) {
    const re = new RegExp(`\\b${name}\\b`);
    if (re.test(t)) {
      const hasNext = /prossim|prossimo|dopo/.test(t);
      let diff = (dow - today.getDay() + 7) % 7;
      if (diff === 0) diff = 7;
      if (hasNext && diff < 7) diff += 7;
      return { date: addDays(today, diff), matched: name + (hasNext ? ' prossimo' : '') };
    }
  }

  // "15 ottobre" oppure "il 15 di ottobre"
  m = t.match(/\b(\d{1,2})[\s/]*?(di\s+)?(gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre|gen|feb|mar|apr|mag|giu|lug|ago|set|ott|nov|dic)\b/);
  if (m) {
    const day = Number(m[1]);
    const month = MONTHS[m[3]];
    let year = today.getFullYear();
    let d = new Date(year, month, day);
    if (d < today) d = new Date(year + 1, month, day);
    return { date: d, matched: m[0].trim() };
  }

  // formato numerico 15/10 o 15/10/2026
  m = t.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
  if (m) {
    const day = Number(m[1]); const month = Number(m[2]) - 1;
    let year = m[3] ? Number(m[3]) : today.getFullYear();
    if (year < 100) year += 2000;
    let d = new Date(year, month, day);
    if (!m[3] && d < today) d = new Date(year + 1, month, day);
    return { date: d, matched: m[0] };
  }

  return null;
}

/** Estrae un orario: "alle 15", "alle 9:30", "ore 14.30", "alle tre di pomeriggio". */
export function parseTime(text) {
  let t = wordsToNumbers(strip(text));
  const pm = /\b(pomeriggio|sera|serale|notte)\b/.test(t);
  const am = /\b(mattina|mattino)\b/.test(t);

  let m = t.match(/\b(?:alle|ore|h)\s*(\d{1,2})[:.](\d{2})\b/);
  if (m) return normalize(Number(m[1]), Number(m[2]), pm, am);

  m = t.match(/\b(?:alle|ore|h)\s+(\d{1,2})\b/);
  if (m) return normalize(Number(m[1]), 0, pm, am);

  m = t.match(/\b(\d{1,2}):(\d{2})\b/);
  if (m) return normalize(Number(m[1]), Number(m[2]), pm, am);

  if (/\bmezzogiorno\b/.test(t)) return { hours: 12, minutes: 0, matched: 'mezzogiorno' };
  if (/\bmezzanotte\b/.test(t)) return { hours: 0, minutes: 0, matched: 'mezzanotte' };
  return null;

  function normalize(h, min, isPm, isAm) {
    if (isPm && h < 12) h += 12;
    if (isAm && h === 12) h = 0;
    if (h > 23 || min > 59) return null;
    return { hours: h, minutes: min, matched: `${h}:${String(min).padStart(2, '0')}` };
  }
}

/** Estrae una durata: "per due ore", "30 minuti", "un'ora e mezza". */
export function parseDuration(text) {
  const t = wordsToNumbers(strip(text));
  const hourAndHalf = /\b(1|una)\s*ora e mezza\b/.test(t);
  if (hourAndHalf) return { minutes: 90, matched: "un'ora e mezza" };
  let m = t.match(/\b(\d+(?:[.,]\d+)?)\s*(ore|ora|h)\b/);
  if (m) return { minutes: Math.round(parseFloat(m[1].replace(',', '.')) * 60), matched: m[0] };
  m = t.match(/\b(\d+)\s*(minuti|minuto|min)\b/);
  if (m) return { minutes: Number(m[1]), matched: m[0] };
  m = t.match(/\bmezz'?ora\b/);
  if (m) return { minutes: 30, matched: 'mezz\'ora' };
  return null;
}

/** Priorità dal testo. */
export function parsePriority(text) {
  const t = strip(text);
  if (/\burgent|importantissim|subito|immediat|assolutamente|critic/.test(t)) return { priority: 'urgent', matched: 'urgente' };
  if (/\bquando puoi|con calma|bassa priorita|non urgente|tranquill/.test(t)) return { priority: 'low', matched: 'bassa' };
  return null;
}

/** Ricorrenza dal testo. */
export function parseRecurrence(text) {
  const t = strip(text);
  if (/\bogni giorno\b|\btutti i giorni\b|\bquotidian/.test(t)) return { freq: 'daily', interval: 1 };
  if (/\bogni settimana\b|\btutte le settimane\b/.test(t)) return { freq: 'weekly', interval: 1 };
  if (/\bogni mese\b|\btutti i mesi\b/.test(t)) return { freq: 'monthly', interval: 1 };
  if (/\bogni anno\b|\btutti gli anni\b/.test(t)) return { freq: 'yearly', interval: 1 };
  if (/\bogni lunedi\b/.test(t)) return { freq: 'weekly', interval: 1, note: 'lunedì' };
  return null;
}

/* ---------------------------- INTENTO ----------------------------------- */
const INTENT_PATTERNS = [
  { intent: 'event', score: 0, re: /\b(riunione|appuntamento|evento|esame|lezione|visita|dentista|medico|cena|pranzo|colloquio|conferenza|allenamento|partita|concerto|viaggio|volo|treno|compleanno|matrimonio|interrogazione|esame|seminario|presentazione|incontro)\b/, weight: 3 },
  { intent: 'event', score: 0, re: /\b(alle|ore|h)\s*\d{1,2}/, weight: 2 },
  { intent: 'task', score: 0, re: /\b(devo|dovrei|bisogna|ricordami|ricordarmi|da fare|fare|chiamare|comprare|inviare|scrivere|studiare|ripassare|consegnare|pagare|prenotare|finire|completare|preparare|sistemare|ordinare|rispondere)\b/, weight: 3 },
  { intent: 'task', score: 0, re: /\b(entro|scadenza|deadline)\b/, weight: 2 },
  { intent: 'idea', score: 0, re: /\b(idea|ideona|potrei|si potrebbe|sarebbe bello|progetto|potrebbe essere|magari|chissa|cosa ne pensi)\b/, weight: 3 },
  { intent: 'note', score: 0, re: /\b(nota|appunto|appunti|annotare|informazione|riferimento|link da salvare)\b/, weight: 3 },
  { intent: 'journal', score: 0, re: /\b(oggi mi sento|mi sento|sono stanco|sono felice|sono triste|sono nervoso|diario|pensiero|riflessione|umore)\b/, weight: 3 },
  { intent: 'inbox', score: 0, re: /.*/, weight: 0 }
];

/** Classifica l'intento del testo. */
export function parseIntent(text) {
  const t = strip(text);
  const scores = { event: 0, task: 0, idea: 0, note: 0, journal: 0, inbox: 0 };
  INTENT_PATTERNS.forEach((p) => { if (p.re.test(t)) scores[p.intent] += p.weight; });

  // un orario esplicito + parola di evento rafforza "event"
  const hasTime = /\b(alle|ore|h)\s*\d{1,2}/.test(t);
  if (hasTime) scores.event += 1;
  // "devo ... per due ore" => attività con stima
  if (/\bdevo\b/.test(t) && parseDuration(t)) scores.task += 1;

  const best = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
  if (!best[1]) return { intent: 'inbox', confidence: 0.2, scores };
  const total = Object.values(scores).reduce((a, b) => a + b, 0) || 1;
  return { intent: best[0], confidence: Math.min(0.95, best[1] / total + 0.25), scores };
}

/* ------------------------- CLASSIFICAZIONE ------------------------------ */
/** Estrae una categoria idonea confrontando il testo con le categorie utente. */
export function suggestCategory(text, categories = []) {
  const t = strip(text);
  const hints = {
    'universita': /\b(universita|esame|lezione|professor|analisi|algebra|fisica|corso|tesi|laurea|studiare|ripass|appunti di)\b/,
    'informatica': /\b(codice|programma|python|javascript|sql|server|database|bug|deploy|git|api|backend|frontend)\b/,
    'game development': /\b(godot|unity|unreal|videogioco|gioco|sprite|level design|gameplay|player|prototipo di gioco)\b/,
    'musica': /\b(musica|canzone|brano|chitarra|pianoforte|batteria|cantare|prova|band|ascoltare|spotify)\b/,
    'd&d': /\b(d&d|dnd|dungeons|draghi|sessione|campagna|master|personaggio|dado|dadi|gdr)\b/,
    'studio': /\b(studio|libro|capitolo|esercizi|ripasso|riassunto|dispense|manuale)\b/,
    'personale': /\b(spesa|spesa|casa|famiglia|amici|pulizie|banca|bolletta|dottore|palestra)\b/
  };
  for (const cat of categories) {
    const key = strip(cat.name);
    const re = hints[key];
    if (re && re.test(t)) return cat.id;
    if (t.includes(key)) return cat.id;
  }
  return null;
}

/** Estrae eventuali #hashtag scritti a voce ("cancelletto università"). */
export function parseTags(text) {
  const out = [];
  const t = String(text || '');
  t.replace(/#([\p{L}\p{N}_-]+)/gu, (_, tag) => { out.push(tag.toLowerCase()); return ''; });
  t.replace(/\bcancelletto\s+([\p{L}\p{N}_-]+)/giu, (_, tag) => { out.push(tag.toLowerCase()); return ''; });
  return [...new Set(out)];
}

/* --------------------------- ANALISI COMPLETA --------------------------- */
/**
 * Analizza un testo libero e restituisce una struttura pronta a diventare
 * un elemento dell'app. È il cuore di "Parla con LifeOS".
 *
 * @param {string} text
 * @param {{categories?:Array, now?:Date}} opts
 * @returns {{intent:string, confidence:number, entities:object, title:string, cleanText:string, suggestion:string}}
 */
export function analyze(text, opts = {}) {
  const raw = String(text || '').trim();
  const categories = opts.categories || [];
  const now = opts.now || new Date();

  const intentRes = parseIntent(raw);
  const dateRes = parseDate(raw, now);
  const timeRes = parseTime(raw);
  const durRes = parseDuration(raw);
  const prioRes = parsePriority(raw);
  const recRes = parseRecurrence(raw);

  // data + ora -> timestamp ISO
  let when = null;
  if (dateRes?.date) {
    const d = new Date(dateRes.date);
    if (timeRes) d.setHours(timeRes.hours, timeRes.minutes, 0, 0);
    else if (intentRes.intent === 'task') d.setHours(9, 0, 0, 0);
    else d.setHours(9, 0, 0, 0);
    when = d.toISOString();
  } else if (timeRes && intentRes.intent === 'event') {
    const d = new Date(startOfDay(now));
    d.setHours(timeRes.hours, timeRes.minutes, 0, 0);
    if (d < now) d.setDate(d.getDate() + 1);
    when = d.toISOString();
  }

  const categoryId = suggestCategory(raw, categories);
  const tags = parseTags(raw);

  // titolo: pulizia delle formule di comando
  let clean = raw
    .replace(/\b(ricordami di|ricordarmi di|devo ricordarmi di|ricordami|nota che|nota:|appunto:|aggiungi|crea|salva)\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  clean = clean.charAt(0).toUpperCase() + clean.slice(1);

  const title = clean.length > 80 ? clean.slice(0, 77).trim() + '…' : clean;

  const entities = {
    when,
    hasExplicitDate: Boolean(dateRes),
    hasExplicitTime: Boolean(timeRes),
    dateMatched: dateRes?.matched || null,
    timeMatched: timeRes?.matched || null,
    durationMin: durRes?.minutes || null,
    priority: prioRes?.priority || null,
    recurrence: recRes ? { freq: recRes.freq, interval: recRes.interval } : null,
    categoryId,
    tags,
    location: extractLocation(raw)
  };

  return {
    intent: intentRes.intent,
    confidence: intentRes.confidence,
    scores: intentRes.scores,
    entities,
    title: title || 'Senza titolo',
    cleanText: clean,
    raw,
    suggestion: describe(intentRes.intent, entities)
  };
}

/** Luogo: "a Milano", "in via Roma 5", "in aula 3". */
export function extractLocation(text) {
  const m = String(text || '').match(/\b(?:a|in|presso|da)\s+((?:via|piazza|aula|ufficio|ospedale|studio|casa|palestra|biblioteca)\s?[\p{L}\p{N}'’.\s]{2,40})/iu);
  if (m) return m[1].trim().replace(/[.,;]$/, '');
  return null;
}

/** Frase di conferma mostrata all'utente. */
function describe(intent, e) {
  const when = e.when ? new Date(e.when) : null;
  const whenTxt = when
    ? `${dayKey(when)} alle ${String(when.getHours()).padStart(2, '0')}:${String(when.getMinutes()).padStart(2, '0')}`
    : 'nessuna data';
  switch (intent) {
    case 'event': return `Sembra un evento: ${whenTxt}.`;
    case 'task': return e.durationMin
      ? `Sembra un'attività da ${e.durationMin} minuti, per ${whenTxt}.`
      : `Sembra un'attività, per ${whenTxt}.`;
    case 'idea': return 'Sembra un\'idea da esplorare.';
    case 'note': return 'Sembra una nota da conservare.';
    case 'journal': return 'Sembra un pensiero personale da mettere nel diario.';
    default: return 'Non sono sicuro di cosa sia: lo salvo in Inbox così decidi dopo.';
  }
}

/** Titolo suggerito per l'elemento, per tipo. */
export function titleFor(intent, analysis) {
  const t = analysis.title;
  switch (intent) {
    case 'event': return t.slice(0, 70);
    case 'task': return t.slice(0, 90);
    default: return t.slice(0, 60) || capitalize(analysis.cleanText.slice(0, 40));
  }
}

export const _internal = { strip, wordsToNumbers };
