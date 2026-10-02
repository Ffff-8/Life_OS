import { chromium, devices } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const ROOT='/home/user/lifeos'; const PORT=8098;
const MIME={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png'};
const srv=http.createServer((q,r)=>{const p=decodeURIComponent(q.url.split('?')[0]);const f=path.join(ROOT,p==='/'?'/index.html':p);
 if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);r.end('404');return;}
 r.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream','Cache-Control':'no-store'});fs.createReadStream(f).pipe(r);});
await new Promise(r=>srv.listen(PORT,'127.0.0.1',r));
const b=await chromium.launch(); const c=await b.newContext({...devices['Pixel 7']}); const p=await c.newPage();
const errs=[]; p.on('console',m=>{if(m.type()==='error')errs.push(m.text());}); p.on('pageerror',e=>errs.push('PAGEERROR '+e.message));
await p.goto(`http://127.0.0.1:${PORT}/index.html#/calendar`,{waitUntil:'load'});
await p.waitForSelector('.cal-grid',{timeout:8000}); console.log('calendario ok:', (await p.textContent('#bar-title')).trim());
await p.goto(`http://127.0.0.1:${PORT}/index.html#/tasks`,{waitUntil:'load'});
await new Promise(r=>setTimeout(r,2500));
console.log('dopo #/tasks titolo:', (await p.textContent('#bar-title')).trim());
console.log('view inizio:', (await p.textContent('#view')).slice(0,240).replace(/\s+/g,' '));
console.log('errori:', JSON.stringify(errs.slice(0,5)));
// prova router diretto
const r2=await p.evaluate(async()=>{const r=await import('/js/router.js'); try{ return {t:JSON.stringify(await (await import('/js/views/tasks.js')).render({params:{},name:'tasks'})).slice(0,120)};}catch(e){return {err:String(e&&e.stack||e)};}});
console.log('render diretto tasks:', JSON.stringify(r2));
await b.close(); srv.close();
