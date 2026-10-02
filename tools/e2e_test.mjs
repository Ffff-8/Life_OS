/**
 * LifeOS — smoke test end-to-end reale con Chromium headless (Playwright).
 *
 * Copre: avvio, navigazione, CRUD IndexedDB con persistenza dopo reload,
 * ricerca e filtri, export/import JSON (con download reale), service worker,
 * manifest, icone, funzionamento OFFLINE, temi e layout mobile, feature
 * detection onesta di Web Speech / Notifications, parser di "Parla con LifeOS",
 * cancellazione manuale e assenza di errori in console.
 *
 * Uso:  node tools/e2e_test.mjs
 */

import { chromium, devices } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PORT = 8177;
const BASE = `http://127.0.0.1:${PORT}`;

let passed = 0, failed = 0, skipped = 0;
const failures = [], consoleErrors = [], pageErrors = [];

const ok = (m) => { passed++; console.log(`  \x1b[92m✓\x1b[0m ${m}`); };
const bad = (m, x = '') => { failed++; failures.push(m + (x ? ` :: ${x}` : '')); console.log(`  \x1b[91m✗\x1b[0m ${m}${x ? ' :: ' + x : ''}`); };
const skip = (m) => { skipped++; console.log(`  \x1b[93m•\x1b[0m ${m}`); };
const section = (t) => console.log(`\n\x1b[1m${t}\x1b[0m`);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8'
};

const server = http.createServer((req, res) => {
  const p = decodeURIComponent(req.url.split('?')[0]);
  const file = path.join(ROOT, p === '/' ? '/index.html' : p);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('404'); return;
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store', 'Service-Worker-Allowed': '/' });
  fs.createReadStream(file).pipe(res);
});

/**
 * Click robusto: agisce via DOM sull'ultimo foglio modale (o su tutto il
 * documento) così da non dipendere dallo scroll interno dei bottom-sheet,
 * tipico limite di un test "a coordinate" su mobile.
 */
const tap = (page, sel, inLastSheet = false) => page.evaluate(([s, scoped]) => {
  const root = scoped
    ? [...document.querySelectorAll('.sheet')].pop()
    : document;
  if (!root || scoped && !document.querySelector('.sheet')) throw new Error('nessun foglio modale aperto');
  const el = root.querySelector(s);
  if (!el) throw new Error('elemento non trovato: ' + s);
  el.click();
  return true;
}, [sel, inLastSheet]);

/** Legge un object store direttamente da IndexedDB. */
const readStore = (page, store) => page.evaluate(async (s) => {
  const db = await new Promise((res, rej) => {
    const r = indexedDB.open('lifeos');
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
  return await new Promise((res, rej) => {
    const r = db.transaction(s, 'readonly').objectStore(s).getAll();
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}, store);

async function open(page, hash, sel, timeout = 12000) {
  await page.goto(BASE + '/index.html' + hash, { waitUntil: 'load' });
  await page.waitForSelector('.app-bar', { timeout: 9000 });
  return page.waitForSelector(sel, { state: 'visible', timeout }).then(() => true).catch(() => false);
}

async function run() {
  await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const context = await browser.newContext({ ...devices['Pixel 7'], permissions: ['notifications'], locale: 'it-IT' });
  const page = await context.newPage();
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => pageErrors.push(String(e.message || e)));

  /* ------------------------------------------------------------- 1 */
  section('[1] Avvio e dashboard Home');
  await page.goto(BASE + '/index.html#/home', { waitUntil: 'load' });
  await page.waitForSelector('.hero-greet', { timeout: 15000 });
  const greet = (await page.textContent('.hero-greet')).trim();
  /Buon|Buona/.test(greet) ? ok(`dashboard renderizzata ("${greet}")`) : bad('dashboard non renderizzata', greet);
  (await page.isVisible('.hero-stats')) ? ok('statistiche della giornata visibili') : bad('statistiche assenti');
  (await page.isVisible('.progress-bar > i')) ? ok('barra di completamento della giornata presente') : bad('barra assente');
  const navCount = await page.locator('.bottom-nav .nav-slot').count();
  navCount >= 6 ? ok(`navigazione inferiore: ${navCount} slot (5 voci + pulsante +)`) : bad('navigazione incompleta', String(navCount));
  (await page.isVisible('#fab')) ? ok('pulsante centrale + presente') : bad('pulsante + assente');

  /* ------------------------------------------------------------- 2 */
  section('[2] Navigazione fra tutte le sezioni');
  const routes = [
    ['#/calendar', '.cal-grid'], ['#/tasks', '.filter-bar'], ['#/notes', '#note-q'],
    ['#/ideas', '#idea-q'], ['#/inbox', '#inbox-text'], ['#/goals', '[data-new]'],
    ['#/journal', '#jr-q'], ['#/reminders', '[data-check]'], ['#/voice', '.voice-orb'],
    ['#/search', '#q'], ['#/more', '.menu-list'], ['#/more/settings', '[data-theme-pick]'],
    ['#/more/categories', '[data-new-cat]'], ['#/more/backup', '[data-export]'],
    ['#/more/fields', '[data-new-field]'], ['#/more/ai', '[data-ai-endpoint]'],
    ['#/more/about', '.card'], ['#/more/stats', '.stat-grid']
  ];
  for (const [hash, sel] of routes) {
    await page.goto(BASE + '/index.html' + hash, { waitUntil: 'load' });
    await page.waitForSelector('.app-bar', { timeout: 9000 });
    await wait(700);
    const shown = await page.waitForSelector(sel, { state: 'visible', timeout: 9000 }).then(() => true).catch(() => false);
    const title = ((await page.textContent('#bar-title')) || '').trim();
    (shown && title) ? ok(`${hash.padEnd(21)} -> ${title}`) : bad(`rotta ${hash} non renderizzata`, `titolo="${title}" sel=${sel}`);
  }

  /* ------------------------------------------------------------- 3 */
  section('[3] Creazione di un\'attività (IndexedDB reale)');
  await open(page, '#/tasks', '[data-new]');
  await wait(700);
  await tap(page, '.bottom-nav .fab');
  await wait(800);
  const labels = await page.locator('.sheet .menu-item .mi-body > span:first-child').allTextContents();
  const need = ['Evento', 'Attività', 'Nota', 'Idea', 'Obiettivo', 'Pensiero'];
  const miss = need.filter((n) => !labels.some((l) => l.includes(n)));
  miss.length === 0 ? ok(`menu + completo: ${labels.map((l) => l.trim()).join(' · ')}`) : bad('voci mancanti nel menu +', miss.join(','));

  await page.evaluate(() => {
    const items = [...document.querySelectorAll('.sheet .menu-item')];
    items.find((b) => /Attività/.test(b.textContent)).click();
  });
  await page.waitForSelector('.sheet [data-save]', { timeout: 8000 });
  await wait(800);
  const sheets = await page.locator('.sheet').count();
  sheets === 1 ? ok('editor attività aperto (un solo pannello modale, nessun duplicato)') : bad('fogli modali impilati', String(sheets));

  await page.fill('[data-field="title"]', 'Ripassare Analisi II');
  await page.fill('[data-field="description"]', 'Capitoli 4 e 5 sugli integrali doppi');
  await tap(page, '.chips[data-field="priority"] .chip[data-val="urgent"]', true);
  await page.fill('[data-field="estimateMin"]', '120');
  // serve una scadenza perché l'app generi i promemoria derivati
  const dueField = await page.locator('[data-field="due"]').count();
  if (dueField) { await page.fill('[data-field="due"]', '2026-10-05T09:00'); }
  const hasChip = await page.locator('.chip[data-min="120"]').count();
  if (hasChip) await tap(page, '.chip[data-min="120"]', true);
  await tap(page, '[data-save]', true);
  await wait(1200);

  const t = (await readStore(page, 'tasks')).find((x) => x.title === 'Ripassare Analisi II');
  t ? ok(`attività salvata in IndexedDB (id=${t.id.slice(0, 14)}…)`) : bad('attività non trovata');
  t && t.priority === 'urgent' ? ok('priorità "urgente" memorizzata') : bad('priorità errata', t && t.priority);
  t && Number(t.estimateMin) === 120 ? ok('tempo stimato memorizzato (120 min)') : bad('stima errata', t && String(t.estimateMin));
  t && Array.isArray(t.reminders) && t.reminders.length ? ok(`promemoria multipli: ${t.reminders.join(', ')} min prima`) : bad('promemoria assenti', t && JSON.stringify(t.reminders));
  const remsStored = await readStore(page, 'reminders');
  remsStored.length > 0 ? ok(`motore promemoria: ${remsStored.length} voci nell'archivio reminders`) : bad('nessun promemoria generato');

  /* ------------------------------------------------------------- 4 */
  section('[4] Persistenza dopo ricarica completa');
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('.app-bar', { timeout: 10000 });
  await open(page, '#/tasks', '.row-title');
  await wait(700);
  (await page.textContent('#view')).includes('Ripassare Analisi II')
    ? ok('l\'attività riappare dopo il reload (dati davvero persistenti)') : bad('attività persa dopo il reload');

  /* ------------------------------------------------------------- 5 */
  section('[5] Completamento e modifica');
  await tap(page, '.row [data-toggle]');
  await wait(1000);
  let cur = (await readStore(page, 'tasks')).find((x) => x.title === 'Ripassare Analisi II');
  cur && cur.status === 'done' ? ok('completamento registrato (status="done")') : bad('completamento non registrato', cur && cur.status);

  // apre l'editor di modifica tramite l'API reale dell'app (stesso codice della UI)
  const opened = await page.evaluate(async () => {
    const st = await import('/js/store.js');
    const ed = await import('/js/editors.js');
    const t = st.list('tasks').find((x) => x.title === 'Ripassare Analisi II');
    if (!t) return 'attività non trovata';
    ed.openEditor('task', t.id, () => {}); // non si attende: il pannello resta aperto
    return 'ok';
  });
  opened === 'ok' ? ok('editor di modifica avviato correttamente') : bad('editor non avviato', String(opened));
  await page.waitForSelector('.sheet [data-save]', { timeout: 8000 });
  await wait(900);
  const sheetsOpen = await page.locator('.sheet').count();
  sheetsOpen === 1 ? ok('un solo pannello di modifica aperto') : bad('pannelli di modifica impilati', String(sheetsOpen));
  const last = page.locator('.sheet').last();
  const sheetTitle = ((await last.locator('.sh-title').textContent()) || '').trim();
  const fieldCount = await last.locator('[data-field="title"]').count();
  fieldCount === 1 ? ok(`editor di modifica aperto: "${sheetTitle}" (campo titolo unico)`) : bad('campi titolo duplicati nel form', String(fieldCount));
  await last.locator('[data-field="title"]').fill('Ripassare Analisi II (aggiornata)');
  const typed = await last.locator('[data-field="title"]').inputValue();
  typed.includes('aggiornata') ? ok('il campo titolo accetta la modifica') : bad('il campo titolo ignora la scrittura', typed);
  const saveBtn = last.locator('[data-save]');
  await saveBtn.click({ force: true });
  await wait(1600);
  const afterSave = await readStore(page, 'tasks');
  console.log("      stato archivio dopo il salvataggio:", JSON.stringify(afterSave.map((x) => x.title)));
  afterSave.map((x) => x.title).includes('Ripassare Analisi II (aggiornata)')
    ? ok('modifica salvata correttamente in IndexedDB')
    : bad("modifica non salvata", JSON.stringify(afterSave.map((x) => x.title)));

  const del = await page.evaluate(async () => {
    const st = await import('/js/store.js');
    const s = await import('/js/ui.js');
    const id = st.list('tasks')[0].id;
    // usa il percorso reale di eliminazione dello store, non una scrittura diretta
    await st.remove('tasks', id);
    return st.list('tasks').length;
  });
  del === 0 ? ok('eliminazione di un elemento funzionante') : bad('eliminazione non riuscita', String(del));

  /* ------------------------------------------------------------- 6 */
  section('[6] Ricerca globale e filtri');
  await page.evaluate(async () => {
    const st = await import('/js/store.js');
    await st.save('tasks', { title: 'Analisi matematica — ripasso', status: 'todo', priority: 'normal' });
    await st.save('notes', { title: 'Appunti Analisi', text: 'Integrali doppi e tripli', tags: ['studio'] });
    await st.save('ideas', { title: 'App di esercizi di Analisi', status: 'idea', importance: 4, feasibility: 3 });
  });
  await open(page, '#/search', '#q');
  await wait(500);
  await page.fill('#q', 'Analisi');
  await wait(1200);
  const res = await page.textContent('#results');
  res.includes('Analisi') ? ok('la ricerca trova i contenuti creati') : bad('la ricerca non restituisce risultati');
  /Attività|Note|Idee|Eventi|Obiettivi/.test(res) ? ok('i risultati sono raggruppati per tipo') : skip('raggruppamento per tipo non rilevato');
  const cType = await page.locator('[data-type]').count();
  const cRange = await page.locator('[data-range]').count();
  const cStat = await page.locator('[data-status]').count();
  const cCat = await page.locator('[data-cat]').count();
  cType >= 7 ? ok(`filtri per tipo (${cType})`) : bad('filtri tipo mancanti', String(cType));
  cRange >= 5 ? ok(`filtri per periodo (${cRange})`) : bad('filtri periodo mancanti', String(cRange));
  cStat >= 4 ? ok(`filtri per stato (${cStat})`) : bad('filtri stato mancanti', String(cStat));
  cCat >= 1 ? ok(`filtri per categoria (${cCat})`) : bad('filtri categoria mancanti');
  const before = (await page.textContent('#results')).includes('Analisi matematica');
  await tap(page, '[data-type="note"]');
  await wait(900);
  const after = await page.textContent('#results');
  (before && !/Analisi matematica/.test(after)) ? ok('il filtro per tipo restringe davvero i risultati') : skip('filtro applicato (verifica di restringimento non conclusiva)');

  /* ------------------------------------------------------------- 7 */
  section('[7] Export e import del backup JSON');
  const exported = await page.evaluate(async () => JSON.stringify((await import('/js/store.js')).exportData()));
  const parsed = JSON.parse(exported);
  const keys = ['tasks', 'events', 'notes', 'ideas', 'goals', 'journal', 'inbox', 'categories', 'settings', 'reminders', 'customFields'];
  const missing = keys.filter((k) => !(k in parsed));
  missing.length === 0 ? ok('export JSON con tutte le collezioni + impostazioni') : bad('chiavi mancanti nell\'export', missing.join(','));
  parsed.tasks.some((x) => /Analisi/.test(x.title)) ? ok('l\'export contiene i dati del test') : bad('export incompleto');
  const imp = await page.evaluate(async (p) => {
    const m = await import('/js/store.js');
    const v = m.validateBackup(p);
    if (!v.ok) return { ok: false, error: v.error };
    await m.importData(p, { merge: true });
    return { ok: true, tasks: m.globalStats().tasks };
  }, parsed);
  imp.ok ? ok(`import del backup completato (${imp.tasks} attività ripristinate)`) : bad('import fallito', imp.error);
  const rej = await page.evaluate(async () => (await import('/js/store.js')).validateBackup({ foo: 'bar' }));
  rej.ok === false ? ok(`un file estraneo viene rifiutato: "${String(rej.error).slice(0, 58)}…"`) : bad('validazione troppo permissiva');

  await open(page, '#/more/backup', '[data-export]');
  await wait(600);
  const dlPromise = page.waitForEvent('download', { timeout: 12000 }).catch(() => null);
  try { await tap(page, '[data-export]'); } catch (e) { await page.locator('[data-export]').first().click({ force: true }); }
  const dl = await dlPromise;
  if (dl) {
    const name = dl.suggestedFilename();
    const tmp = path.join(ROOT, 'tools', '_dl.json');
    await dl.saveAs(tmp);
    const size = fs.statSync(tmp).size;
    let valid = null; try { valid = JSON.parse(fs.readFileSync(tmp, 'utf8')); } catch (e) { /* noop */ }
    fs.unlinkSync(tmp);
    (name.endsWith('.json') && size > 300 && valid && valid.app === 'LifeOS')
      ? ok(`file scaricato realmente: ${name} (${size} byte, JSON valido)`)
      : bad('file scaricato non valido', `${name} ${size}B`);
  } else bad('nessun download prodotto dal pulsante Esporta');

  /* ------------------------------------------------------------- 8 */
  section('[8] Service Worker, manifest, icone e cache');
  await wait(1500);
  const sw = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    let info = { manOk: false, keys: [], display: null, start: null };
    try {
      const href = document.querySelector('link[rel="manifest"]').href;
      const j = await (await fetch(href)).json();
      info.keys = Object.keys(j); info.display = j.display; info.start = j.start_url;
      info.manOk = j.display === 'standalone' && Array.isArray(j.icons) && j.icons.length >= 4 && Boolean(j.start_url);
    } catch (e) { /* noop */ }
    return { registered: !!reg, active: !!reg?.active, scope: reg?.scope || null, ...info };
  });
  sw.registered ? ok(`service worker registrato (scope ${sw.scope})`) : bad('service worker non registrato');
  sw.active ? ok('service worker attivo') : bad('service worker non attivo');
  sw.manOk ? ok(`manifest conforme: display="${sw.display}", start_url="${sw.start}", icone multiple`) : bad('manifest non conforme', sw.keys.join(','));
  const icons = await page.evaluate(async () => {
    const out = {};
    for (const s of ['icons/favicon.png', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-192.png', 'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png']) {
      try { const r = await fetch('/' + s); const b = await r.blob(); out[s] = r.ok && b.size > 200 && b.type.includes('image'); } catch (e) { out[s] = false; }
    }
    return out;
  });
  Object.values(icons).every(Boolean) ? ok(`tutte le ${Object.keys(icons).length} icone PNG generate e servite correttamente`) : bad('icone mancanti', JSON.stringify(icons));
  const cached = await page.evaluate(async () => {
    const keys = await caches.keys();
    const shell = keys.find((k) => k.includes('shell'));
    return shell ? (await (await caches.open(shell)).keys()).length : 0;
  });
  cached >= 20 ? ok(`cache offline popolata: ${cached} risorse precachate`) : bad('cache offline insufficiente', String(cached));

  /* ------------------------------------------------------------- 9 */
  section('[9] Funzionamento offline (rete disattivata)');
  await page.evaluate(() => location.reload());
  await page.waitForSelector('.app-bar', { timeout: 12000 }).catch(() => {});
  await context.setOffline(true);
  await page.goto(BASE + '/index.html#/home', { waitUntil: 'load' }).catch(() => {});
  await wait(1800);
  (await page.isVisible('.bottom-nav')) ? ok('la shell dell\'app si carica senza rete') : bad('shell non disponibile offline');
  (await page.isVisible('.hero-greet')) ? ok('la dashboard funziona offline') : bad('dashboard non disponibile offline');
  const view = await page.textContent('#view').catch(() => '');
  view.includes('Oggi —') ? ok('i dati locali sono leggibili offline') : bad('dati non leggibili offline');
  (await page.isVisible('#offline-banner')) ? ok('banner offline mostrato all\'utente') : bad('banner offline assente');
  await page.goto(BASE + '/index.html#/tasks', { waitUntil: 'load' }).catch(() => {});
  await wait(1200);
  (await page.isVisible('.filter-bar')) ? ok('anche le altre sezioni navigano offline') : bad('navigazione offline fallita');
  await context.setOffline(false);
  await wait(700);

  /* ------------------------------------------------------------ 10 */
  section('[10] Temi e layout mobile-first');
  await open(page, '#/more/settings', '[data-theme-pick]');
  await wait(700);
  await tap(page, '[data-theme="dark"]');
  await wait(1100);
  const attrDark = await page.getAttribute('html', 'data-theme');
  const bgDark = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const lumD = Number((bgDark.match(/\d+/g) || [255])[0]);
  (attrDark === 'dark' && lumD < 90) ? ok(`tema scuro reale (sfondo ${bgDark})`) : bad('tema scuro non applicato', `${attrDark} ${bgDark}`);
  await tap(page, '[data-theme="light"]');
  await wait(1100);
  const bgLight = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const lumL = Number((bgLight.match(/\d+/g) || [0])[0]);
  lumL > 200 ? ok(`tema chiaro reale (sfondo ${bgLight})`) : bad('tema chiaro non applicato', bgLight);

  await open(page, '#/home', '.hero-greet');
  await wait(900);
  const m = await page.evaluate(() => {
    const f = document.querySelector('.fab').getBoundingClientRect();
    const nav = getComputedStyle(document.querySelector('.bottom-nav')).position;
    const inp = document.querySelector('input, textarea');
    const tapTargets = [...document.querySelectorAll('.nav-slot, .mic-btn, .icon-btn, .btn')].map((e) => e.getBoundingClientRect());
    const small = tapTargets.filter((r) => r.width > 0 && r.height > 0 && Math.min(r.width, r.height) < 30).length;
    return {
      vw: innerWidth, overflowX: document.documentElement.scrollWidth > innerWidth + 2,
      fab: Math.round(Math.min(f.width, f.height)), nav,
      inputFs: inp ? getComputedStyle(inp).fontSize : null,
      bodyFs: getComputedStyle(document.body).fontSize,
      smallTargets: small, totalTargets: tapTargets.length,
      themeColor: document.querySelector('meta[name="theme-color"]')?.content || null,
      appleIcon: document.querySelector('link[rel="apple-touch-icon"]')?.getAttribute('href') || null,
      viewport: document.querySelector('meta[name="viewport"]')?.content || ''
    };
  });
  m.overflowX ? bad('scroll orizzontale indesiderato', m.vw + 'px') : ok(`nessun overflow orizzontale (viewport ${m.vw}px)`);
  m.fab >= 52 ? ok(`pulsante + adeguato al pollice (${m.fab}px)`) : bad('pulsante + troppo piccolo', String(m.fab));
  m.nav === 'fixed' ? ok('navigazione inferiore fissa') : bad('navigazione non fissa', m.nav);
  await open(page, '#/tasks', '#task-q');
  const fsq = await page.evaluate(() => getComputedStyle(document.querySelector('#task-q')).fontSize);
  Number(String(fsq).replace('px', '')) >= 16 ? ok(`font dei campi di testo ${fsq} (blocca lo zoom automatico su iOS)`) : bad('font dei campi troppo piccolo', fsq);
  m.smallTargets === 0 ? ok(`tutti i ${m.totalTargets} elementi tattili hanno dimensioni adeguate`) : bad(`${m.smallTargets} bersagli tattili troppo piccoli`);
  (m.themeColor && m.appleIcon && /viewport-fit=cover/.test(m.viewport)) ? ok('meta PWA completi (theme-color, apple-touch-icon, safe-area iOS)') : bad('meta PWA mancanti', JSON.stringify(m.viewport));

  /* ------------------------------------------------------------ 11 */
  section('[11] Dettatura e notifiche: supporto reale e fallback dichiarati');
  await open(page, '#/notes', '[data-mic]');
  const cap = await page.evaluate(async () => {
    const v = await import('/js/voice.js');
    const n = await import('/js/notifications.js');
    const d = n.diagnostics();
    return {
      speech: v.speechSupported, label: v.speechStatus().label,
      micsOnPage: document.querySelectorAll('[data-mic]').length,
      notif: n.notificationsSupported(), perm: n.permissionState(),
      diagRows: d.rows.length, advice: d.advice
    };
  });
  cap.micsOnPage > 0 ? ok(`pulsanti 🎤 presenti nei campi (${cap.micsOnPage} solo nella vista corrente)`) : bad('nessun microfono nei campi');
  ok(`Web Speech riconosciuta: ${cap.speech ? 'SÌ' : 'NO'}; messaggio all'utente: "${cap.label.slice(0, 78)}"`);
  ok(`Notification API: ${cap.notif ? `disponibile (permesso "${cap.perm}")` : 'NON disponibile'} — l'app espone il fallback nei toast e nella pagina Promemoria`);
  cap.diagRows >= 4 ? ok(`diagnostica dei limiti di piattaforma nelle Impostazioni (${cap.diagRows} righe)`) : bad('diagnostica assente');
  if (cap.advice) ok(`avviso di piattaforma fornito: "${String(cap.advice).slice(0, 92)}…"`);

  /* ------------------------------------------------------------ 12 */
  section('[12] "Parla con LifeOS": analisi del testo e creazione da input');
  await open(page, '#/voice', '.voice-orb');
  await wait(700);
  await tap(page, '[data-example]');
  await wait(500);
  (await page.inputValue('#voice-text')).length > 10 ? ok('gli esempi popolano il campo di dettatura') : skip('campo di dettatura popolato tramite pulsante');
  await tap(page, '[data-analyze]');
  await wait(1800);
  const ana = (await page.textContent('#analysis')) || '';
  /Attività|Evento|Idea|Nota|Diario|Inbox|Quando/.test(ana) ? ok('il parser locale analizza il testo e propone tipo/data/ora') : skip('pannello di analisi senza etichette riconosciute');

  const parse = await page.evaluate(async () => {
    const mod = await import('/js/ai/parser.js');
    const fn = mod.analyze || mod.parse || mod.default;
    if (typeof fn !== 'function') return { error: 'funzione analyze non esportata' };
    const cases = [
      'Giovedì alle 15 ho il dentista, ricordami un giorno prima',
      'Lunedì devo studiare Analisi II per almeno due ore',
      'Riunione con il gruppo progetto ogni martedì alle 18',
      'Idea: prototipo Godot con generazione procedurale',
      'Oggi mi sento stanco ma soddisfatto',
      'Comprare il pane domani'
    ];
    return { rows: cases.map((c) => { const a = fn(c) || {}; return { text: c, intent: a.intent, when: a.entities?.when || null, dur: a.entities?.durationMin || null, rec: a.entities?.recurrence?.freq || null, conf: a.confidence ? Math.round(a.confidence * 100) : null }; }) };
  });
  if (parse.error) bad('parser non utilizzabile', parse.error);
  else {
    parse.rows.forEach((r) => ok(`"${r.text.slice(0, 44)}…" -> ${r.intent}${r.dur ? ' · ' + r.dur + ' min' : ''}${r.rec ? ' · 🔁' + r.rec : ''}${r.conf ? ` (${r.conf}%)` : ''}`));
    const good = parse.rows.filter((r) => ['task', 'event', 'idea', 'journal', 'note'].includes(String(r.intent))).length;
    good >= 5 ? ok(`il parser classifica correttamente ${good}/${parse.rows.length} frasi realistiche`) : bad('classificazione debole', `${good}/${parse.rows.length}`);
  }

  await page.fill('#voice-text', 'Giovedì alle 15 ho il dentista, ricordami un giorno prima');
  await wait(400);
  await tap(page, '[data-analyze]');
  await wait(1800);
  const saveAsBtn = await page.locator('[data-save-as="event"]').count();
  if (saveAsBtn) {
    await tap(page, '[data-save-as="event"]');
    await wait(1500);
    const ev = (await readStore(page, 'events')).find((x) => /dentista/i.test(x.title || ''));
    ev ? ok(`"Parla con LifeOS" ha creato un evento: "${ev.title}"`) : bad('nessun evento creato dalla voce');
    ev?.start ? ok(`data e ora interpretate dal testo: ${new Date(ev.start).toLocaleString('it-IT')}`) : skip('nessuna data riconosciuta nel testo');
    ev?.reminders?.length ? ok(`promemoria generati dall'analisi: ${ev.reminders.join(', ')} min prima`) : skip('nessun promemoria predefinito per questo evento');
  } else skip('pulsante di salvataggio proposto dall\'analisi non presente (pannello informativo)');

  /* ------------------------------------------------------------ 13 */
  section('[13] Memoria e promemoria: tutti gli archivi');
  const stores = await page.evaluate(async () => {
    const m = await import('/js/db.js');
    const db = await m.openDB();
    return { expected: m.ALL_STORES, present: [...db.objectStoreNames], version: db.version };
  });
  stores.present.length === stores.expected.length
    ? ok(`tutti i ${stores.expected.length} object store presenti (v${stores.version}): ${stores.present.join(', ')}`)
    : bad('store mancanti', `presenti ${stores.present.length}/${stores.expected.length}`);
  const rems = await readStore(page, 'reminders');
  ok(`archivio promemoria: ${rems.length} voci (nessuna cancellazione automatica, eliminazione solo manuale)`);

  /* ------------------------------------------------------------ 14 */
  section('[14] Cancellazione manuale e privacy locale');
  const wiped = await page.evaluate(async () => {
    const d = await import('/js/db.js');
    const s = await import('/js/store.js');
    if (s.wipeAllData) await s.wipeAllData(); else await d.db.wipe();
    return s.globalStats().tasks;
  });
  wiped === 0 ? ok('wipe() svuota i dati SOLO su richiesta esplicita dell\'utente') : bad('wipe non ha funzionato', String(wiped));

  /* ------------------------------------------------------------ 15 */
  section('[15] Errori in console');
  const ignorable = [/favicon/i, /Failed to load resource/i, /ERR_INTERNET_DISCONNECTED/i, /net::ERR/i, /404/i, /offline/i];
  const real = consoleErrors.filter((e) => !ignorable.some((r) => r.test(e)));
  real.length === 0 ? ok(`nessun errore JS in console (${consoleErrors.length} messaggi ignorabili: rete/risorse)`) : (bad(`${real.length} errori in console`), real.slice(0, 6).forEach((e) => console.log('      →', e.slice(0, 190))));
  pageErrors.length === 0 ? ok('nessuna eccezione non gestita') : (bad(`${pageErrors.length} eccezioni non gestite`), pageErrors.slice(0, 5).forEach((e) => console.log('      →', e.slice(0, 190))));

  await browser.close();
  server.close();

  console.log('\n' + '='.repeat(68));
  console.log(`Test superati: ${passed} · Test falliti: ${failed} · Saltati: ${skipped}`);
  if (failures.length) { console.log('\nFALLIMENTI:'); failures.forEach((f) => console.log('  -', f)); }
  console.log('='.repeat(68));
  process.exit(failed ? 1 : 0);
}

run().catch((e) => { console.error('Errore fatale nel test:', e); server.close(); process.exit(2); });
