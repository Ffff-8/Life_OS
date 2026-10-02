import { chromium, devices } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PORT = 8098;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png' };

const server = http.createServer((req, res) => {
  const p = decodeURIComponent(req.url.split('?')[0]);
  const file = path.join(ROOT, p === '/' ? '/index.html' : p);
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end('404'); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(file).pipe(res);
});

await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
const browser = await chromium.launch({ args: ['--no-sandbox'] });
const ctx = await browser.newContext({ ...devices['Pixel 7'], locale: 'it-IT' });
const page = await ctx.newPage();
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[PAGEERROR] ${e.stack || e.message}`));
page.on('requestfailed', (r) => logs.push(`[REQFAIL] ${r.url()} :: ${r.failure()?.errorText}`));

await page.goto(`http://127.0.0.1:${PORT}/index.html#/home`, { waitUntil: 'load' });
await page.waitForTimeout(4000);

const state = await page.evaluate(() => ({
  body: document.body.innerText.slice(0, 700),
  splash: !!document.querySelector('#splash'),
  splashHTML: document.querySelector('#splash')?.innerText?.slice(0, 500) || null,
  shellHidden: document.querySelector('#app-shell')?.className || null,
  viewLen: document.querySelector('#view')?.innerHTML.length || 0,
  hasHero: !!document.querySelector('.hero-greet'),
  barTitle: document.querySelector('#bar-title')?.textContent || null
}));

console.log('=== STATO ===');
console.log(JSON.stringify(state, null, 2));
console.log('\n=== LOG ===');
console.log(logs.slice(0, 40).join('\n'));

await browser.close(); server.close();
