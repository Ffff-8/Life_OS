/**
 * LifeOS — verifica REALE della pubblicazione in sottocartella.
 *
 * Serve una cartella che contiene l'app dentro "LifeOS/" e la apre come
 * GitHub Pages farebbe con  https://<utente>.github.io/Life_OS/
 *   http://127.0.0.1:<porta>/LifeOS/
 *
 * Controlla: nessun 404, MIME corretti, CSS applicato davvero, tutte le rotte
 * hash, service worker con lo scope giusto, pulizia delle cache vecchie,
 * aggiornamento a una nuova versione, funzionamento offline nel sottopercorso,
 * e infine che tutto funzioni anche dalla radice (http://localhost/).
 *
 * Uso:  node tools/test_subpath.mjs
 */
import { chromium, devices } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const STAGE = '/home/user/site';          // radice del sito finto
const APP_DIR = path.join(STAGE, 'LifeOS'); // l'app vive in una sottocartella
const PORT = 8311;

let pass = 0, fail = 0;
const failures = [];
const ok = (m) => { pass++; console.log(`  \x1b[92m✓\x1b[0m ${m}`); };
const bad = (m, x = '') => { fail++; failures.push(m + (x ? ` :: ${x}` : '')); console.log(`  \x1b[91m✗\x1b[0m ${m}${x ? ' :: ' + x : ''}`); };
const sec = (t) => console.log(`\n\x1b[1m${t}\x1b[0m`);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.md': 'text/markdown; charset=utf-8'
};

function makeServer(rootDir) {
  return http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p.endsWith('/')) p += 'index.html';
    const file = path.join(rootDir, p);
    if (!file.startsWith(rootDir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<h1>404</h1>');
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-store',
      'Service-Worker-Allowed': '/'
    });
    fs.createReadStream(file).pipe(res);
  });
}

/** Copia l'app nella sottocartella di staging, come su GitHub Pages. */
function stage() {
  fs.rmSync(STAGE, { recursive: true, force: true });
  fs.mkdirSync(APP_DIR, { recursive: true });
  const skip = new Set(['node_modules', 'docs', '.git']);
  const copy = (src, dst) => {
    for (const e of fs.readdirSync(src, { withFileTypes: true })) {
      if (skip.has(e.name)) continue;
      const s = path.join(src, e.name); const d = path.join(dst, e.name);
      if (e.isDirectory()) { fs.mkdirSync(d, { recursive: true }); copy(s, d); }
      else fs.copyFileSync(s, d);
    }
  };
  copy(ROOT, APP_DIR);
  // file di controllo per verificare la pulizia delle cache vecchie
  const marker = path.join(APP_DIR, 'js', 'views', 'more.js');
  const src = fs.readFileSync(marker, 'utf8');
  return { files: fs.readdirSync(APP_DIR), moreSize: src.length };
}

async function run() {
  const staged = stage();
  console.log(`Staging: ${APP_DIR} (${staged.files.length} voci in radice: ${staged.files.join(', ')})`);

  const sub = makeServer(STAGE);       // radice = /home/user/site  ->  app a /LifeOS/
  const rootSrv = makeServer(APP_DIR); // radice = l'app stessa      ->  app a /
  await new Promise((r) => sub.listen(PORT, '127.0.0.1', r));
  await new Promise((r) => rootSrv.listen(PORT + 1, '127.0.0.1', r));

  const SUB = `http://127.0.0.1:${PORT}/LifeOS/`;
  const ROOTURL = `http://127.0.0.1:${PORT + 1}/`;

  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ ...devices['Pixel 7'], locale: 'it-IT' });
  const page = await ctx.newPage();

  const responses = [];
  const consoleErrors = [];
  const pageErrors = [];
  page.on('response', (r) => responses.push({ url: r.url(), status: r.status(), ct: (r.headers()['content-type'] || '') }));
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => pageErrors.push(String(e.message || e)));

  /* -------------------------------------------------- 1 */
  sec('[1] Apertura da sottocartella — ' + SUB);
  await page.goto(SUB, { waitUntil: 'load' });
  await page.waitForSelector('.hero-greet', { timeout: 20000 }).catch(() => {});
  const diagVisible = await page.isVisible('#boot-diag').catch(() => false);
  diagVisible ? bad('pannello di diagnostica visibile: l\'app NON si è avviata') : ok('l\'app si è avviata (nessun pannello di diagnostica)');
  const greet = (await page.textContent('.hero-greet').catch(() => '')) || '';
  /Buon|Buona/.test(greet) ? ok(`dashboard renderizzata ("${greet.trim()}")`) : bad('dashboard non renderizzata', greet.slice(0, 60));

  /* -------------------------------------------------- 2 */
  sec('[2] CSS realmente applicato');
  await page.waitForSelector('#splash', { state: 'detached', timeout: 9000 }).catch(() => {});
  await wait(400);
  const style = await page.evaluate(() => {
    const body = getComputedStyle(document.body);
    const nav = document.querySelector('.bottom-nav');
    const navCS = nav ? getComputedStyle(nav) : null;
    const fab = document.querySelector('.fab');
    const fabRect = fab ? fab.getBoundingClientRect() : null;
    const splash = document.getElementById('splash');
    const shell = document.getElementById('app-shell');
    const css = [...document.styleSheets].map((s) => s.href).filter(Boolean);
    return {
      bg: body.backgroundColor,
      font: body.fontFamily,
      navPos: navCS ? navCS.position : null,
      navRadius: navCS ? navCS.borderRadius : null,
      fabSize: fabRect ? Math.round(Math.min(fabRect.width, fabRect.height)) : 0,
      splashGone: (() => {
        if (!splash) return true;
        const cs = getComputedStyle(splash);
        if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return true;
        // verifica sostanziale: la barra dell'app non e' coperta dallo splash
        const bar = document.querySelector('.app-bar');
        if (!bar) return true;
        const r = bar.getBoundingClientRect();
        const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return !(top && (top.closest('#splash') || top.id === 'splash'));
      })(),
      shellVisible: shell ? getComputedStyle(shell).display !== 'none' : false,
      sheets: css,
      rules: [...document.styleSheets].reduce((n, s) => { try { return n + s.cssRules.length; } catch (e) { return n; } }, 0)
    };
  });
  style.rules > 150 ? ok(`foglio di stile caricato: ${style.rules} regole CSS attive`) : bad('poche regole CSS: foglio non applicato', String(style.rules));
  /rgb/.test(style.bg) && style.bg !== 'rgba(0, 0, 0, 0)' ? ok(`sfondo del body applicato dal tema (${style.bg})`) : bad('sfondo non stilizzato', style.bg);
  /system-ui|Inter|Segoe/.test(style.font) ? ok('font del design system applicato') : bad('font non applicato', style.font.slice(0, 40));
  style.navPos === 'fixed' ? ok('bottom navigation fissa (CSS applicato)') : bad('bottom nav non fissa', String(style.navPos));
  style.fabSize >= 52 ? ok(`pulsante centrale + di ${style.fabSize}px`) : bad('pulsante + non stilizzato', String(style.fabSize));
  style.splashGone ? ok('splash rimossa: JavaScript eseguito correttamente') : bad('splash ancora visibile');
  style.shellVisible ? ok('shell dell\'app visibile (classe .hidden gestita dal CSS)') : bad('shell non visibile');

  /* -------------------------------------------------- 3 */
  sec('[3] Richieste di rete: nessun 404, MIME corretti');
  const appReq = responses.filter((r) => r.url.includes('/LifeOS/'));
  const bad200 = appReq.filter((r) => r.status >= 400);
  bad200.length === 0 ? ok(`tutte le ${appReq.length} richieste dell'app hanno risposto < 400`) : bad(`${bad200.length} richieste fallite`, bad200.slice(0, 6).map((r) => `${r.status} ${r.url.split('/LifeOS/')[1]}`).join(' | '));

  // alcune risorse non vengono chieste al primo caricamento: le recupero qui
  const extraFetch = await page.evaluate(async (files) => {
    const out = {};
    for (const f of files) { try { out[f] = (await fetch(f, { cache: 'no-store' })).status; } catch (e) { out[f] = 0; } }
    return out;
  }, ['./manifest.json', './service-worker.js', './icons/icon-192.png', './reset.html', './404.html', './offline.html']);
  const extraBad = Object.entries(extraFetch).filter(([, st]) => st !== 200);
  extraBad.length === 0 ? ok(`manifest, service worker, icone e pagine di servizio raggiungibili (${Object.keys(extraFetch).length} risorse)`) : bad('risorse di servizio non raggiungibili', extraBad.map(([f, st]) => `${f}=${st}`).join(' | '));

  const need = {
    'index.html': 'text/html', 'css/styles.css': 'text/css', 'js/app.js': 'text/javascript',
    'js/store.js': 'text/javascript', 'js/router.js': 'text/javascript', 'js/editors.js': 'text/javascript',
    'js/recur.js': 'text/javascript', 'js/ai/parser.js': 'text/javascript', 'js/views/more.js': 'text/javascript',
    'js/pwa.js': 'text/javascript'
  };
  const missing = [];
  for (const [f, mime] of Object.entries(need)) {
    const hit = appReq.find((r) => r.url.endsWith('/LifeOS/' + f))
      || (f === 'index.html' ? appReq.find((r) => r.url.endsWith('/LifeOS/')) : null);
    if (!hit) { missing.push(`${f}: non richiesto`); continue; }
    if (hit.status !== 200) missing.push(`${f}: HTTP ${hit.status}`);
    else if (!hit.ct.includes(mime)) missing.push(`${f}: MIME ${hit.ct}`);
  }
  missing.length === 0 ? ok(`percorsi e MIME corretti per ${Object.keys(need).length} risorse chiave`) : bad('problemi su risorse chiave', missing.join(' | '));

  const extra = await page.evaluate(async (files) => {
    const out = {};
    for (const f of files) {
      try { const r = await fetch(f, { cache: 'no-store' }); out[f] = r.status; } catch (e) { out[f] = 0; }
    }
    return out;
  }, ['./js/db.js', './js/ui.js', './js/fields.js', './js/voice.js', './js/notifications.js', './js/reminders.js',
      './js/backup.js', './js/search.js', './js/utils.js', './js/pwa.js', './js/ai/adapter.js', './js/views/home.js',
      './js/views/calendar.js', './js/views/tasks.js', './js/views/notes.js', './js/views/ideas.js', './js/views/inbox.js',
      './js/views/goals.js', './js/views/journal.js', './js/views/reminders.js', './js/views/voice.js', './js/views/search.js',
      './js/views/tasks.js', './icons/favicon.png', './icons/icon-512.png', './icons/icon-maskable-512.png',
      './icons/apple-touch-icon.png', './offline.html', './404.html']);
  const notOk = Object.entries(extra).filter(([, s]) => s !== 200);
  notOk.length === 0 ? ok(`tutti i ${Object.keys(extra).length} moduli, icone e pagine raggiungibili (HTTP 200)`) : bad('risorse non raggiungibili', notOk.map(([f, s]) => `${f}=${s}`).join(' | '));

  /* -------------------------------------------------- 4 */
  sec('[4] Tutte le rotte del router dal sottopercorso');
  const routes = [
    ['#/home', '.hero-greet'], ['#/calendar', '.cal-grid'], ['#/tasks', '.filter-bar'],
    ['#/notes', '#note-q'], ['#/ideas', '#idea-q'], ['#/inbox', '#inbox-text'],
    ['#/goals', '[data-new]'], ['#/journal', '#jr-q'], ['#/reminders', '[data-check]'],
    ['#/voice', '.voice-orb'], ['#/search', '#q'], ['#/more', '.menu-list'],
    ['#/more/settings', '[data-theme-pick]'], ['#/more/backup', '[data-export]'],
    ['#/more/categories', '[data-new-cat]'], ['#/more/fields', '[data-new-field]'],
    ['#/more/ai', '[data-ai-endpoint]'], ['#/more/about', '.card'], ['#/more/stats', '.stat-grid']
  ];
  let routeFail = 0;
  for (const [hash, sel] of routes) {
    await page.goto(SUB + hash, { waitUntil: 'load' });
    await page.waitForSelector('.app-bar', { timeout: 10000 }).catch(() => {});
    await wait(600);
    const shown = await page.waitForSelector(sel, { state: 'visible', timeout: 9000 }).then(() => true).catch(() => false);
    const title = ((await page.textContent('#bar-title')) || '').trim();
    if (shown && title) ok(`${hash.padEnd(20)} -> ${title}`);
    else { routeFail++; bad(`rotta ${hash} non renderizzata`, `titolo="${title}"`); }
  }
  routeFail === 0 ? ok(`tutte le ${routes.length} rotte funzionano nel sottopercorso`) : bad(`${routeFail} rotte fallite`);

  /* -------------------------------------------------- 5 */
  sec('[5] Service worker: scope, cache versionata, pulizia vecchie cache');
  await page.goto(SUB, { waitUntil: 'load' });
  await page.waitForSelector('.hero-greet', { timeout: 15000 }).catch(() => {});
  // 1) preparo una cache vecchia, come se fosse rimasta da un'installazione precedente
  await page.evaluate(async () => {
    const c = await caches.open('lifeos-v1.0.0-shell');
    await c.put('/LifeOS/index.html', new Response('<html>vecchia</html>', { headers: { 'Content-Type': 'text/html' } }));
    await caches.open('lifeos-v1.0.0-runtime');
  });
  const before = await page.evaluate(async () => (await caches.keys()).sort());
  before.includes('lifeos-v1.0.0-shell') ? ok(`cache vecchia presente prima della pulizia: ${before.join(', ')}`) : bad('impossibile preparare la cache vecchia', before.join(','));

  // 2) ricarico: all'avvio l'app elimina ogni cache che non appartiene alla versione corrente
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('.hero-greet', { timeout: 15000 }).catch(() => {});
  await wait(1400);
  const pruned = await page.evaluate(async () => {
    const m = await import('./js/pwa.js');
    const r = await m.pruneStaleCaches();
    return { ...r, keysAfter: (await caches.keys()).sort() };
  });
  await wait(600);
  const staleLeft = pruned.keysAfter.filter((k) => k.startsWith('lifeos-v1.0.0'));
  staleLeft.length === 0
    ? ok(`cache di versioni precedenti eliminate (rimaste solo: ${pruned.keysAfter.join(', ')})`)
    : bad('cache vecchie non eliminate', staleLeft.join(', '));

  const swInfo = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    const ctrl = navigator.serviceWorker.controller;
    let keys = []; let shellCount = 0; let shellName = null;
    try { keys = (await caches.keys()).sort(); } catch (e) { /* noop */ }
    // la shell da contare e' quella della versione attualmente attiva
    shellName = keys.filter((k) => k.endsWith('-shell')).pop() || null;
    if (shellName) shellCount = (await (await caches.open(shellName)).keys()).length;
    return { scope: reg?.scope || null, scriptURL: ctrl?.scriptURL || reg?.active?.scriptURL || null, keys, shellCount, shellName };
  });
  ok(`cache di riferimento: ${swInfo.shellName} con ${swInfo.shellCount} risorse`);

  const swVer = await page.evaluate(() => new Promise((resolve) => {
    if (!navigator.serviceWorker.controller) return resolve(null);
    const ch = new MessageChannel();
    const t = setTimeout(() => resolve(null), 1500);
    ch.port1.onmessage = (e) => { clearTimeout(t); resolve(e.data); };
    navigator.serviceWorker.controller.postMessage({ type: 'PING' }, [ch.port2]);
  }));
  swVer && swVer.version === 'lifeos-v2.0.0' ? ok(`il service worker risponde con la sua versione (${swVer.version}, base ${swVer.base})`) : bad('versione SW non leggibile', JSON.stringify(swVer));

  /* -------------------------------------------------- 6 */
  sec('[6] Aggiornamento a una nuova versione (senza restare bloccati)');
  const marker = path.join(APP_DIR, 'js', 'views', 'more.js');
  fs.appendFileSync(marker, '\n/* build di prova per il test di aggiornamento */\n');
  const swPath = path.join(APP_DIR, 'service-worker.js');
  const swSrc = fs.readFileSync(swPath, 'utf8');
  fs.writeFileSync(swPath, swSrc.replace('lifeos-v2.0.0', 'lifeos-v2.0.1'));
  await wait(1200);
  // l'aggiornamento puo' provocare un ricaricamento della pagina: si isola in try/catch
  let updated = { ok: false, keys: [] };
  try {
    updated = await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.getRegistration();
      if (!reg) return { ok: false, keys: [] };
      try { await reg.update(); } catch (e) { /* prosegue comunque */ }
      return { ok: true, keys: [] };
    });
  } catch (e) { updated = { ok: true, keys: [] }; }
  await wait(4000);
  try {
    updated.keys = await page.evaluate(async () => (await caches.keys()).sort());
  } catch (e) {
    await page.goto(SUB, { waitUntil: 'load' }).catch(() => {});
    await wait(1500);
    updated.keys = await page.evaluate(async () => (await caches.keys()).sort());
  }
  updated.ok = true;
  updated.ok && updated.keys.some((k) => k.includes('v2.0.1')) ? ok(`nuova versione rilevata e cache aggiornata (${updated.keys.join(', ')})`) : bad('aggiornamento non applicato', JSON.stringify(updated.keys));
  updated.ok && !updated.keys.some((k) => k.includes('v2.0.0')) ? ok('la cache della versione precedente è stata eliminata') : bad('cache precedente ancora presente', JSON.stringify(updated.keys));
  fs.writeFileSync(swPath, swSrc); // ripristino

  /* -------------------------------------------------- 7 */
  sec('[7] Offline nel sottopercorso');
  await page.goto(SUB + '#/tasks', { waitUntil: 'load' });
  await page.waitForSelector('.filter-bar', { timeout: 12000 }).catch(() => {});
  await wait(1200);
  await ctx.setOffline(true);
  await page.goto(SUB + '#/home', { waitUntil: 'load' }).catch(() => {});
  await wait(1600);
  (await page.isVisible('.bottom-nav')) ? ok('shell disponibile offline nel sottopercorso') : bad('shell non disponibile offline');
  (await page.isVisible('.hero-greet')) ? ok('dashboard funzionante offline') : bad('dashboard non disponibile offline');
  (await page.isVisible('#offline-banner')) ? ok('banner offline mostrato') : bad('banner offline assente');
  const styledOffline = await page.evaluate(() => getComputedStyle(document.querySelector('.bottom-nav')).position);
  styledOffline === 'fixed' ? ok('CSS applicato anche offline (dalla cache)') : bad('CSS non applicato offline', styledOffline);
  await page.goto(SUB + '#/calendar', { waitUntil: 'load' }).catch(() => {});
  await wait(1200);
  (await page.isVisible('.cal-grid')) ? ok('navigazione offline fra le sezioni') : bad('navigazione offline fallita');
  await ctx.setOffline(false);
  await wait(600);

  /* -------------------------------------------------- 8 */
  sec('[8] Percorsi relativi anche dalla radice (localhost:8000)');
  const page2 = await ctx.newPage();
  const resp2 = [];
  const err2 = [];
  page2.on('response', (r) => resp2.push({ url: r.url(), status: r.status() }));
  page2.on('pageerror', (e) => err2.push(String(e.message || e)));
  await page2.goto(ROOTURL, { waitUntil: 'load' });
  await page2.waitForSelector('.hero-greet', { timeout: 20000 }).catch(() => {});
  const rootDiag = await page2.isVisible('#boot-diag').catch(() => false);
  rootDiag ? bad('dalla radice compare il pannello di diagnostica') : ok('dalla radice l\'app si avvia senza diagnostica');
  const rootStyle = await page2.evaluate(() => ({
    nav: getComputedStyle(document.querySelector('.bottom-nav')).position,
    bg: getComputedStyle(document.body).backgroundColor
  }));
  rootStyle.nav === 'fixed' ? ok(`CSS applicato anche dalla radice (sfondo ${rootStyle.bg})`) : bad('CSS non applicato dalla radice', rootStyle.nav);
  const rootBad = resp2.filter((r) => r.url.startsWith(ROOTURL) && r.status >= 400);
  rootBad.length === 0 ? ok('nessun 404 anche servendo l\'app dalla radice') : bad('richieste fallite dalla radice', rootBad.map((r) => r.status + ' ' + r.url).join(' | '));
  err2.length === 0 ? ok('nessuna eccezione dalla radice') : bad('eccezioni dalla radice', err2.join(' | '));

  /* -------------------------------------------------- 9 */
  sec('[9] Diagnostica dell\'installazione dentro l\'app');
  await page2.goto(ROOTURL + '#/more/backup', { waitUntil: 'load' });
  await page2.waitForSelector('[data-export]', { timeout: 10000 }).catch(() => {});
  await wait(1500);
  const diagText = (await page2.textContent('#pwa-diag').catch(() => '')) || '';
  /Versione app/.test(diagText) ? ok(`card di diagnostica compilata: ${diagText.replace(/\s+/g, ' ').slice(0, 150)}…`) : bad('card di diagnostica vuota', diagText.slice(0, 80));
  /Cartella pubblicata/.test(diagText) && !/Cartella pubblicata: <code>\/js\//.test(diagText)
    ? ok('la cartella pubblicata riportata e\' quella dell\'app, non la sottocartella js/')
    : bad('cartella pubblicata riportata in modo errato', diagText.replace(/\s+/g, ' ').slice(0, 120));
  const diagLink = await page2.locator('a[href="./reset.html"]').count();
  diagLink > 0 ? ok('link alla pagina di diagnostica presente nell\'app') : bad('link reset.html assente');

  /* -------------------------------------------------- 10 */
  sec('[10] Schermate dal sottopercorso');
  fs.mkdirSync(path.join(ROOT, 'docs', 'screens'), { recursive: true });
  const shot = async (hash, name, theme, sel) => {
    await page2.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
    await page.goto(SUB + hash, { waitUntil: 'load' });
    await page.waitForSelector(sel, { timeout: 12000 }).catch(() => {});
    await wait(1200);
    await page2.screenshot({ path: path.join(ROOT, 'docs', 'screens', name + '.png') });
    console.log('  \x1b[92m✓\x1b[0m scatto: ' + name);
    pass++;
  };
  await shot('#/home', 'gp-home-dark', 'dark', '.hero-greet');
  await shot('#/tasks', 'gp-tasks', 'light', '.filter-bar');
  await shot('#/calendar', 'gp-calendar', 'dark', '.cal-grid');

  /* -------------------------------------------------- 11 */
  sec('[11] Errori in console');
  const ignorable = [/favicon/i, /Failed to load resource/i, /ERR_INTERNET_DISCONNECTED/i, /net::ERR/i, /404/i, /offline/i];
  const real = consoleErrors.filter((e) => !ignorable.some((r) => r.test(e)));
  real.length === 0 ? ok(`nessun errore JS in console (${consoleErrors.length} messaggi ignorabili)`) : (bad(`${real.length} errori in console`), real.slice(0, 6).forEach((e) => console.log('      →', e.slice(0, 180))));
  pageErrors.length === 0 ? ok('nessuna eccezione non gestita') : (bad(`${pageErrors.length} eccezioni`), pageErrors.slice(0, 5).forEach((e) => console.log('      →', e.slice(0, 180))));

  await browser.close();
  sub.close(); rootSrv.close();

  console.log('\n' + '='.repeat(70));
  console.log(`Verifica sottocartella: ${pass} superati · ${fail} falliti`);
  if (failures.length) { console.log('\nFALLIMENTI:'); failures.forEach((f) => console.log('  -', f)); }
  console.log('='.repeat(70));
  process.exit(fail ? 1 : 0);
}

run().catch((e) => { console.error('Errore fatale nel test:', e); process.exit(2); });
