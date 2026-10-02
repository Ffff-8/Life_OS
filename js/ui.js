/* ==========================================================================
   LifeOS — ui.js
   Componenti di interfaccia riutilizzabili: toast, bottom sheet, modali,
   dialoghi di conferma/prompt, action sheet. Tutto ottimizzato per il pollice.
   ========================================================================== */

import { esc, capitalize } from './utils.js';

export const qs = (sel, root = document) => root.querySelector(sel);
export const qsa = (sel, root = document) => [...root.querySelectorAll(sel)];

/** Crea un nodo da HTML stringa (singolo elemento radice). */
export function node(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

/** Event delegation pratica. */
export function onClick(root, selector, handler) {
  root.addEventListener('click', (e) => {
    const target = e.target.closest(selector);
    if (target && root.contains(target)) { e.preventDefault(); handler(target, e); }
  });
}

/* ------------------------------- TOAST ---------------------------------- */
export function toast(msg, ms = 2200, kind = '') {
  const root = qs('#toast-root');
  if (!root) return;
  const el = node(`<div class="toast ${kind}">${esc(msg)}</div>`);
  root.appendChild(el);
  setTimeout(() => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 220);
  }, ms);
  return el;
}

/* --------------------------- BOTTOM SHEET ------------------------------- */
let openCount = 0;

/**
 * Apre un pannello dal basso (foglio modale).
 * @param {{title?:string, body?:string|Node, foot?:string|Node, onMount?:(api:any)=>void, size?:string}} opts
 * @returns {{root:HTMLElement, sheet:HTMLElement, close:(v?:any)=>void, promise:Promise<any>}}
 */
export function sheet(opts = {}) {
  const scrim = node('<div class="scrim"></div>');
  const el = node('<section class="sheet" role="dialog" aria-modal="true"></section>');
  if (opts.size === 'tall') el.style.maxHeight = '96dvh';

  el.innerHTML = `
    <div class="sheet-grip"></div>
    <header class="sheet-head">
      <span class="sh-title">${esc(opts.title || '')}</span>
      <button class="icon-btn" data-close aria-label="Chiudi">✕</button>
    </header>
    <div class="sheet-body"></div>
    <footer class="sheet-foot hidden"></footer>
  `;

  const body = qs('.sheet-body', el);
  const foot = qs('.sheet-foot', el);

  if (typeof opts.body === 'string') body.innerHTML = opts.body;
  else if (opts.body) body.appendChild(opts.body);
  if (opts.foot) {
    foot.classList.remove('hidden');
    if (typeof opts.foot === 'string') foot.innerHTML = opts.foot;
    else foot.appendChild(opts.foot);
  }

  const root = qs('#sheet-root');
  root.appendChild(scrim); root.appendChild(el);
  openCount++;
  document.body.style.overflow = 'hidden';

  let resolveFn;
  const promise = new Promise((r) => { resolveFn = r; });

  requestAnimationFrame(() => { scrim.classList.add('in'); el.classList.add('in'); });

  let closed = false;
  function close(value) {
    if (closed) return;
    closed = true;
    scrim.classList.remove('in'); el.classList.remove('in');
    setTimeout(() => {
      el.remove(); scrim.remove();
      openCount = Math.max(0, openCount - 1);
      if (openCount === 0) document.body.style.overflow = '';
    }, 260);
    opts.onClose?.(value);
    resolveFn?.(value);
  }

  scrim.addEventListener('click', () => close(undefined));
  qs('[data-close]', el).addEventListener('click', () => close(undefined));
  document.addEventListener('keydown', function onKey(e) {
    if (e.key === 'Escape') { close(undefined); document.removeEventListener('keydown', onKey); }
  });

  const api = { root, sheet: el, body, foot, close, promise };
  opts.onMount?.(api);
  return api;
}

/** Sheet con una lista di voci (usato dal pulsante + e da Altro). */
export function menuSheet(title, items) {
  const html = `<div class="menu-list">${items.map((it, i) => `
    <button class="menu-item" data-idx="${i}">
      <span class="mi-ico">${it.icon || '•'}</span>
      <span class="mi-body">
        <span>${esc(it.label)}</span>
        ${it.desc ? `<span class="mi-desc">${esc(it.desc)}</span>` : ''}
      </span>
      <span class="dim">›</span>
    </button>`).join('')}</div>`;
  const s = sheet({ title, body: html });
  onClick(s.body, '[data-idx]', (btn) => {
    const it = items[Number(btn.dataset.idx)];
    s.close(it.value);
  });
  return s.promise;
}

/* ---------------------------- DIALOGHI ---------------------------------- */

/** Conferma con messaggio. Ritorna true/false. */
export function confirmDialog({ title = 'Confermi?', message = '', confirmText = 'Conferma', cancelText = 'Annulla', danger = false } = {}) {
  const foot = node(`<div class="btn-row" style="width:100%">
    <button class="btn" data-no>${esc(cancelText)}</button>
    <button class="btn ${danger ? 'danger' : 'primary'}" data-yes>${esc(confirmText)}</button>
  </div>`);
  const s = sheet({ title, body: `<p class="muted" style="line-height:1.6">${esc(message)}</p>`, foot });
  onClick(foot, '[data-no]', () => s.close(false));
  onClick(foot, '[data-yes]', () => s.close(true));
  return s.promise.then((v) => v === true);
}

/** Richiesta di testo. Ritorna la stringa o null. */
export function promptDialog({ title = 'Scrivi', label = '', value = '', placeholder = '', multiline = false, confirmText = 'Salva' } = {}) {
  const body = node(`<div>
    ${label ? `<label class="label">${esc(label)}</label>` : ''}
    ${multiline
      ? `<textarea class="textarea" data-input placeholder="${esc(placeholder)}">${esc(value)}</textarea>`
      : `<input class="input" data-input value="${esc(value)}" placeholder="${esc(placeholder)}" />`}
  </div>`);
  const foot = node(`<div class="btn-row" style="width:100%">
    <button class="btn" data-no>Annulla</button>
    <button class="btn primary" data-yes>${esc(confirmText)}</button>
  </div>`);
  const s = sheet({ title, body, foot });
  const input = qs('[data-input]', body);
  setTimeout(() => input.focus(), 280);
  onClick(foot, '[data-no]', () => s.close(null));
  onClick(foot, '[data-yes]', () => s.close(input.value.trim() || null));
  return s.promise;
}

/** Action sheet: ritorna il valore della voce scelta o undefined. */
export function actionSheet(title, actions) {
  const html = `<div class="menu-list">${actions.map((a, i) => `
    <button class="menu-item" data-idx="${i}" ${a.disabled ? 'disabled' : ''}>
      <span class="mi-ico" ${a.danger ? 'style="background:var(--danger-soft);color:var(--danger)"' : ''}>${a.icon || '•'}</span>
      <span class="mi-body"><span ${a.danger ? 'style="color:var(--danger)"' : ''}>${esc(a.label)}</span>
      ${a.desc ? `<span class="mi-desc">${esc(a.desc)}</span>` : ''}</span>
    </button>`).join('')}</div>`;
  const s = sheet({ title, body: html });
  onClick(s.body, '[data-idx]', (btn) => {
    const a = actions[Number(btn.dataset.idx)];
    s.close(a.value === undefined ? a.label : a.value);
  });
  return s.promise;
}

/* --------------------------- COMPONENTI --------------------------------- */

/** Badge priorità. */
export function priorityBadge(p) {
  const map = {
    urgent: { cls: 'urgent', label: '🔴 Urgente' },
    normal: { cls: 'normal', label: '🟡 Normale' },
    low: { cls: 'low', label: '🔵 Bassa' }
  };
  const x = map[p] || map.normal;
  return `<span class="badge ${x.cls}">${x.label}</span>`;
}

/** Badge stato attività. */
export function statusBadge(status) {
  const map = {
    todo: { cls: 'todo', label: '⚪ Da fare' },
    doing: { cls: 'doing', label: '🔵 In corso' },
    done: { cls: 'done', label: '🟢 Completata' },
    expired: { cls: 'expired', label: '🔴 Scaduta' }
  };
  const x = map[status] || map.todo;
  return `<span class="badge ${x.cls}">${x.label}</span>`;
}

/** Badge categoria colorato. */
export function categoryBadge(cat) {
  if (!cat) return '';
  return `<span class="badge cat" style="background:${esc(cat.color)}">${cat.icon || '📁'} ${esc(cat.name)}</span>`;
}

/** Stelle in sola lettura. */
export function starsReadonly(n, max = 5) {
  const v = Math.round(Number(n) || 0);
  return `<span title="${v}/${max}">${'★'.repeat(v)}${'☆'.repeat(Math.max(0, max - v))}</span>`;
}

/** Stato vuoto. */
export function emptyState(icon, title, desc, actionHtml = '') {
  return `<div class="empty">
    <div class="e-ico">${icon}</div>
    <div class="e-title">${esc(title)}</div>
    ${desc ? `<div class="e-desc">${esc(desc)}</div>` : ''}
    ${actionHtml}
  </div>`;
}

/** Riga di card generica. */
export function row({ bar, title, sub, right, extraClass = '', attrs = '' }) {
  return `<div class="row ${extraClass}" ${attrs}>
    ${bar ? `<span class="row-bar" style="background:${bar}"></span>` : ''}
    <div class="row-body">
      <div class="row-title">${title}</div>
      ${sub ? `<div class="row-sub">${sub}</div>` : ''}
    </div>
    ${right ? `<div class="row-right">${right}</div>` : ''}
  </div>`;
}

/** Sezione con titolo + contatore + eventuale azione. */
export function section(title, count, bodyHtml, actionHtml = '') {
  return `<section class="section">
    <div class="section-head">
      <div class="h3">${title}${count != null ? ` <span class="count">${count}</span>` : ''}</div>
      ${actionHtml}
    </div>
    ${bodyHtml}
  </section>`;
}

/** Commuta un elemento in modalità "selezionato" in un gruppo di chip. */
export function setActiveChip(container, predicate) {
  qsa('.chip', container).forEach((c) => c.classList.toggle('on', predicate(c)));
}

/** Chiede una data con l'input nativo (ottimo su mobile). */
export function pickDate(currentISO, { withTime = false } = {}) {
  return new Promise((resolve) => {
    const type = withTime ? 'datetime-local' : 'date';
    const val = currentISO ? localValue(currentISO, withTime) : '';
    const body = node(`<div>
      <input class="input" type="${type}" value="${val}" data-d />
      <p class="mic-hint">Usa il selettore del sistema per scegliere rapidamente.</p>
    </div>`);
    const foot = node(`<div class="btn-row" style="width:100%">
      <button class="btn" data-clear>Cancella</button>
      <button class="btn primary" data-ok>Conferma</button>
    </div>`);
    const s = sheet({ title: withTime ? 'Data e ora' : 'Scegli data', body, foot });
    const input = qs('[data-d]', body);
    setTimeout(() => { try { input.showPicker?.(); } catch (e) {} }, 250);
    onClick(foot, '[data-clear]', () => s.close(null));
    onClick(foot, '[data-ok]', () => {
      const v = input.value;
      s.close(v ? new Date(v).toISOString() : null);
    });
  });
}

function localValue(iso, withTime) {
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, '0');
  const base = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  return withTime ? `${base}T${p(d.getHours())}:${p(d.getMinutes())}` : base;
}

/** Bottone "installa app" gestito da app.js; qui solo helper visivo. */
export function installHintHtml() {
  const ua = navigator.userAgent;
  const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (isIOS) {
    return `<div class="info-box">📲 <b>iPhone/iPad:</b> apri con Safari → tocca <b>Condividi</b> → <b>Aggiungi a Home</b>. Le notifiche e la dettatura richiedono iOS 16.4 o superiore e l'app installata nella schermata Home.</div>`;
  }
  if (/Android/i.test(ua)) {
    return `<div class="info-box">📲 <b>Android:</b> apri il menu del browser (⋮) → <b>Installa app</b> / <b>Aggiungi a schermata Home</b>.</div>`;
  }
  return `<div class="info-box">📲 Dal menu del browser scegli <b>Installa app</b> per usare LifeOS come una normale applicazione.</div>`;
}

export { capitalize };
