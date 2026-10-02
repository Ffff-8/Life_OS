/* ==========================================================================
   LifeOS — utils.js
   Funzioni di utilità senza dipendenze: date, formattazione, DOM, id.
   Tutto in italiano, tutto locale.
   ========================================================================== */

/* ------------------------------- ID / TEMPO ----------------------------- */

/** Genera un id univoco "leggibile": prefisso + timestamp base36 + casuale. */
export function uid(prefix = 'id') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export const nowISO = () => new Date().toISOString();

export function startOfDay(d = new Date()) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
export function endOfDay(d = new Date()) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}
export function addMinutes(d, min) { return new Date(new Date(d).getTime() + min * 60000); }
export function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }

/** Chiave giorno locale "YYYY-MM-DD" (NON usa UTC per evitare sfasamenti). */
export function dayKey(d = new Date()) {
  const x = new Date(d);
  const p = (n) => String(n).padStart(2, '0');
  return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}`;
}
export function dateFromDayKey(key) {
  const [y, m, d] = String(key).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1, 0, 0, 0, 0);
}
export function isSameDay(a, b) { return dayKey(a) === dayKey(b); }
export function isToday(d) { return isSameDay(d, new Date()); }

/** "YYYY-MM-DDTHH:mm" per gli input datetime-local (ora locale). */
export function toLocalInput(d = new Date()) {
  const x = new Date(d);
  const p = (n) => String(n).padStart(2, '0');
  return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}T${p(x.getHours())}:${p(x.getMinutes())}`;
}
export function fromLocalInput(v) { return v ? new Date(v) : null; }

/* --------------------------------- DATES -------------------------------- */

const MESI = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
const MESI_SHORT = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];
const GIORNI = ['domenica', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato'];
export const MESI_IT = MESI;
export const GIORNI_IT = GIORNI;

/**
 * Formatta una data in italiano.
 * @param {Date|string|number} d
 * @param {'full'|'long'|'medium'|'short'|'day'|'month'|'time'|'datetime'|'rel'} style
 */
export function fmtDate(d, style = 'medium') {
  if (!d) return '';
  const x = d instanceof Date ? d : new Date(d);
  if (isNaN(x)) return '';
  const g = GIORNI[x.getDay()];
  const m = MESI[x.getMonth()];
  const ms = MESI_SHORT[x.getMonth()];
  const hh = String(x.getHours()).padStart(2, '0');
  const mm = String(x.getMinutes()).padStart(2, '0');
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

  switch (style) {
    case 'full': return `${g} ${x.getDate()} ${m} ${x.getFullYear()}`;
    case 'long': return `${cap(g)} ${x.getDate()} ${m} ${x.getFullYear()}`;
    case 'medium': return `${x.getDate()} ${ms} ${x.getFullYear()}`;
    case 'short': return `${x.getDate()}/${x.getMonth() + 1}/${String(x.getFullYear()).slice(2)}`;
    case 'day': return `${g} ${x.getDate()} ${m}`;
    case 'month': return `${cap(m)} ${x.getFullYear()}`;
    case 'time': return `${hh}:${mm}`;
    case 'datetime': return `${x.getDate()} ${ms} · ${hh}:${mm}`;
    default: return `${x.getDate()} ${ms} ${x.getFullYear()}`;
  }
}

/** Etichetta relativa: "Oggi", "Domani", "Ieri", "tra 3 giorni", "2 giorni fa". */
export function relDay(d) {
  if (!d) return '';
  const x = startOfDay(d);
  const diff = Math.round((x - startOfDay(new Date())) / 86400000);
  if (diff === 0) return 'Oggi';
  if (diff === 1) return 'Domani';
  if (diff === -1) return 'Ieri';
  if (diff > 1 && diff <= 7) return `Tra ${diff} giorni`;
  if (diff < -1 && diff >= -7) return `${Math.abs(diff)} giorni fa`;
  return fmtDate(d, 'medium');
}

/** Tempo relativo compatto per i timestamp di creazione. */
export function relTime(d) {
  if (!d) return '';
  const diff = Date.now() - new Date(d).getTime();
  const min = Math.round(diff / 60000);
  if (min < 1) return 'adesso';
  if (min < 60) return `${min} min fa`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} h fa`;
  const g = Math.round(h / 24);
  if (g < 30) return `${g} g fa`;
  return fmtDate(d, 'medium');
}

/** Descrizione di una data/ora rispetto ad adesso, in linguaggio naturale. */
export function humanWhen(d) {
  if (!d) return '';
  const x = new Date(d);
  const diffMs = x - Date.now();
  const abs = Math.abs(diffMs);
  const min = Math.round(abs / 60000);
  const past = diffMs < 0;
  if (min < 1) return 'adesso';
  if (isToday(x) && min < 60) return past ? `${min} min fa` : `tra ${min} min`;
  let part;
  if (min < 60) part = `${min} minuti`;
  else if (min < 60 * 24) part = `${Math.round(min / 60)} ore`;
  else if (min < 60 * 24 * 30) part = `${Math.round(min / 1440)} giorni`;
  else part = fmtDate(x, 'medium');
  if (isToday(x)) return past ? `${part} fa` : `tra ${part}`;
  return `${past ? 'scaduto' : 'previsto'} ${past ? '' : 'per '}${fmtDate(x, 'medium')}${min < 1440 ? ' · ' + fmtDate(x, 'time') : ''}`.trim();
}

/** Durata in minuti -> "2 ore", "45 min", "1 h 30". */
export function minToLabel(min) {
  const m = Number(min) || 0;
  if (m <= 0) return '—';
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h === 24) return '1 giorno';
  const hs = `${h} ${h === 1 ? 'ora' : 'ore'}`;
  return r ? `${hs} ${r} min` : hs;
}

/** Offset di promemoria (minuti prima) -> etichetta in italiano. */
export function offsetLabel(min) {
  const m = Number(min) || 0;
  if (m === 0) return "all'orario";
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  const mm = m % 60;
  const parts = [];
  if (d) parts.push(`${d} ${d === 1 ? 'giorno' : 'giorni'}`);
  if (h) parts.push(`${h} ${h === 1 ? 'ora' : 'ore'}`);
  if (mm) parts.push(`${mm} min`);
  return parts.join(' ') + ' prima';
}

/** Offset tipici offerti nell'interfaccia. */
export const REMINDER_PRESETS = [
  { min: 20160, label: '14 giorni prima' },
  { min: 10080, label: '7 giorni prima' },
  { min: 4320, label: '3 giorni prima' },
  { min: 1440, label: '1 giorno prima' },
  { min: 720, label: '12 ore prima' },
  { min: 120, label: '2 ore prima' },
  { min: 60, label: '1 ora prima' },
  { min: 30, label: '30 minuti prima' },
  { min: 10, label: '10 minuti prima' },
  { min: 0, label: "all'orario esatto" }
];

/* ------------------------------ STRINGHE -------------------------------- */

export const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

export const capitalize = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '');

/** Ricava un titolo breve da un testo lungo (per note/idee dettate). */
export function titleFrom(text, max = 60) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return '';
  const firstClause = clean.split(/[.!?;:\n]/)[0].trim() || clean;
  const t = firstClause.length > max ? firstClause.slice(0, max).trim() + '…' : firstClause;
  return capitalize(t);
}

/** Estrae le #hashtag dal testo e restituisce { text, tags }. */
export function extractHashtags(text) {
  const tags = [];
  const cleaned = String(text || '').replace(/#([\p{L}\p{N}_-]+)/gu, (_, t) => { tags.push(t.toLowerCase()); return ''; });
  return { text: cleaned.replace(/\s{2,}/g, ' ').trim(), tags };
}

/** Normalizza per la ricerca: minuscolo + rimozione accenti. */
export function norm(s) {
  return String(s == null ? '' : s)
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/* --------------------------------- UTILS -------------------------------- */

export function debounce(fn, ms = 260) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

export const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
export const range = (n) => Array.from({ length: n }, (_, i) => i);
export const sum = (arr, f = (x) => x) => arr.reduce((a, b) => a + (Number(f(b)) || 0), 0);
export const pct = (part, total) => (total > 0 ? Math.round((part / total) * 100) : 0);
export const uniq = (arr) => [...new Set(arr)];
export const sortBy = (arr, key, dir = 1) => [...arr].sort((a, b) => {
  const av = typeof key === 'function' ? key(a) : a[key];
  const bv = typeof key === 'function' ? key(b) : b[key];
  if (av == null && bv == null) return 0;
  if (av == null) return 1;
  if (bv == null) return -1;
  return av > bv ? dir : av < bv ? -dir : 0;
});

export function groupBy(arr, keyFn) {
  const map = new Map();
  for (const item of arr) {
    const k = keyFn(item);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(item);
  }
  return map;
}

/** Matrice 6x7 per il calendario mensile (settimana inizia lunedì). */
export function monthMatrix(year, month) {
  const first = new Date(year, month, 1);
  let offset = first.getDay() - 1; // lunedì = 0
  if (offset < 0) offset = 6;
  const start = addDays(first, -offset);
  const weeks = [];
  for (let w = 0; w < 6; w++) {
    const days = [];
    for (let d = 0; d < 7; d++) days.push(addDays(start, w * 7 + d));
    weeks.push(days);
  }
  return weeks;
}

export const DOW_IT = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'];

/* ------------------------------- FILE / DOM ----------------------------- */

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.style.display = 'none';
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1500);
}

export function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ''));
    r.onerror = () => reject(r.error || new Error('Lettura file non riuscita'));
    r.readAsText(file);
  });
}

export function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ''));
    r.onerror = () => reject(r.error || new Error('Lettura file non riuscita'));
    r.readAsDataURL(file);
  });
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Copia un testo negli appunti, con fallback se l'API non è disponibile. */
export async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (e) { /* fallback sotto */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch (e) { return false; }
}
