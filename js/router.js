/* ==========================================================================
   LifeOS — router.js
   Router a hash (funziona perfettamente nelle PWA installate e offline).
   Formato:  #/nome-route?param=valore  ·  #/tasks?new=task
   Ogni vista esporta render(ctx) -> { title, sub, html, mount? }
   ========================================================================== */

import { qs } from './ui.js';

const registry = new Map();
let current = { name: null, params: {} };
let viewRoot = null;
let notFoundHandler = null;

/** Registra una vista. Il primo name è la rotta di default. */
export function register(name, def) {
  registry.set(name, def);
}

export function setNotFound(fn) { notFoundHandler = fn; }

/** Parsing dell'hash corrente. */
export function parseHash(hash = location.hash) {
  const raw = String(hash || '').replace(/^#\/?/, '');
  const [path, query] = raw.split('?');
  const name = (path || 'home').split('/')[0] || 'home';
  const params = {};
  if (query) {
    new URLSearchParams(query).forEach((v, k) => { params[k] = v; });
  }
  // secondo segmento: #/more/settings -> params._sub
  const segs = path.split('/').filter(Boolean);
  if (segs.length > 1) params._sub = segs.slice(1).join('/');
  return { name, params };
}

export const currentRoute = () => ({ ...current });

/** Cambia rotta (aggiunge la voce alla cronologia). */
export function navigate(to, { replace = false } = {}) {
  const target = to.startsWith('#') ? to : `#/${String(to).replace(/^\//, '')}`;
  if (location.hash === target) return render();
  if (replace) history.replaceState(null, '', target);
  else location.hash = target;
  if (replace) return render();
}

/** Naviga mantenendo l'oggetto parametri. */
export function go(name, params = {}, opts = {}) {
  const qs_ = new URLSearchParams(params).toString();
  navigate(`#/${name}${qs_ ? '?' + qs_ : ''}`, opts);
}

export function back() {
  if (history.length > 1) history.back();
  else navigate('#/home');
}

/** Indietro "logico": se c'è una sottopagina torna alla lista. */
export function backTo(fallback = 'home') { navigate(`#/${fallback}`, { replace: true }); }

/** Renderizza la rotta corrente dentro #view. */
export async function render() {
  const { name, params } = parseHash();
  const def = registry.get(name) || registry.get('home');
  current = { name, params };

  if (!viewRoot) viewRoot = qs('#view');
  if (!viewRoot) return;

  // aggiorna stato attivo nella navigazione inferiore
  document.querySelectorAll('.nav-slot[data-route]').forEach((el) => {
    const targets = el.dataset.route.split(' ');
    el.classList.toggle('active', targets.includes(name));
  });

  try {
    const result = await def.render({ params, name, root: viewRoot });
    const out = result || {};
    setTitle(out.title, out.sub);
    viewRoot.innerHTML = out.html || '';
    viewRoot.scrollTop = 0;
    window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
    // animazione leggera ad ogni cambio vista
    viewRoot.style.animation = 'none';
    void viewRoot.offsetWidth;
    viewRoot.style.animation = '';
    out.mount?.({ ...(out.ctx || {}), params, name, root: viewRoot, refresh: render });
  } catch (err) {
    console.error('[router] errore vista', name, err);
    viewRoot.innerHTML = `<div class="empty">
      <div class="e-ico">😵</div>
      <div class="e-title">Qualcosa è andato storto</div>
      <div class="e-desc">${String(err?.message || err)}</div>
      <button class="btn primary" onclick="location.hash='#/home'">Torna alla Home</button>
    </div>`;
    if (notFoundHandler) notFoundHandler(err);
  }
}

export function setTitle(title, sub) {
  const t = qs('#bar-title'); const s = qs('#bar-sub');
  if (t) t.textContent = title || 'LifeOS';
  if (s) s.textContent = sub || '';
  document.title = title ? `${title} · LifeOS` : 'LifeOS';
}

/** Rilegge la rotta corrente (usato dopo salvataggi/eliminazioni). */
export const refresh = () => render();

export function start(root) {
  if (root) viewRoot = root;
  window.addEventListener('hashchange', render);
  if (!location.hash) history.replaceState(null, '', '#/home');
  return render();
}

export const routeNames = () => [...registry.keys()];
