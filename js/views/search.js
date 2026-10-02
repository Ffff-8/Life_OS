/* ==========================================================================
   LifeOS — views/search.js
   Ricerca globale con filtri per tipo, categoria, stato, priorità e periodo.
   ========================================================================== */

import { list, byId, categoryById, effectiveStatus, remove, save } from '../store.js';
import { esc, fmtDate, relDay, norm, minToLabel, debounce, clamp } from '../utils.js';
import { qs, qsa, onClick, emptyState, toast, actionSheet, confirmDialog, sheet, node } from '../ui.js';
import { search, TYPE_META, RANGE_OPTIONS, STATUS_OPTIONS, highlight, filtersSummary } from '../search.js';
import { openEditor } from '../editors.js';
import { attachMics, speak, synthSupported } from '../voice.js';
import { answer, capabilities } from '../ai/adapter.js';

const state = {
  query: '',
  types: [],
  categoryId: '',
  status: '',
  priority: '',
  range: 'all'
};

export function render({ params }) {
  if (params.q) state.query = params.q;
  const res = search({ ...state, limit: 120 });
  const summary = filtersSummary(state);
  const ai = capabilities();

  const html = `
    <div class="page-head">
      <div class="h1">Ricerca</div>
      <div class="muted">Cerca in eventi, attività, note, idee, obiettivi, diario e inbox.</div>
    </div>

    <div class="field">
      <div class="input-voice">
        <input class="input" id="q" value="${esc(state.query)}" placeholder="Cerca ovunque…" autocomplete="off" />
        <button class="mic-btn" data-mic="q" aria-label="Cerca con la voce">🎤</button>
      </div>
    </div>

    <div class="chips" style="margin-bottom:10px">
      ${Object.entries(TYPE_META).map(([k, v]) => `<button class="chip ${state.types.includes(k) ? 'on' : ''}" data-type="${k}">${v.icon} ${esc(v.label)}</button>`).join('')}
    </div>

    <div class="filter-bar">
      <div class="chips">
        <button class="chip ${!state.categoryId ? 'on' : ''}" data-cat="">📁 Tutte</button>
        ${list('categories').map((c) => `<button class="chip ${state.categoryId === c.id ? 'on' : ''}" data-cat="${esc(c.id)}">${c.icon || '📁'} ${esc(c.name)}</button>`).join('')}
      </div>
      <div class="chips" style="margin-top:7px">
        ${RANGE_OPTIONS.map((r) => `<button class="chip sm ${state.range === r.value ? 'on' : ''}" data-range="${r.value}">${esc(r.label)}</button>`).join('')}
      </div>
      <div class="chips" style="margin-top:7px">
        ${STATUS_OPTIONS.map((s) => `<button class="chip sm ${state.status === s.value ? 'on' : ''}" data-status="${esc(s.value)}">${esc(s.label)}</button>`).join('')}
        <button class="chip sm ${state.priority === 'urgent' ? 'on' : ''}" data-prio="urgent">🔴 Urgenti</button>
        <button class="chip sm ${state.priority === 'normal' ? 'on' : ''}" data-prio="normal">🟡 Normali</button>
        <button class="chip sm ${state.priority === 'low' ? 'on' : ''}" data-prio="low">🔵 Bassa</button>
      </div>
    </div>

    <div class="btn-row" style="margin:6px 0 12px">
      <button class="btn sm" data-ask>🤖 Chiedi a LifeOS</button>
      <button class="btn sm ghost" data-reset>↺ Azzera filtri</button>
    </div>

    <div id="results">
      <div class="section-head">
        <div class="h3">${res.total} risultati ${summary ? `<span class="count">${esc(summary)}</span>` : ''}</div>
      </div>
      ${res.items.length ? res.items.map((r) => resultCard(r, state.query)).join('')
        : emptyState('🔍', 'Nessun risultato', state.query ? `Niente per "${state.query}". Prova con meno parole o azzera i filtri.` : 'Inizia a digitare o usa il microfono per cercare a voce.')}
    </div>

    <p class="mic-hint" style="margin-top:16px">
      Motore: <b>${esc(ai.provider === 'remote' ? 'AI collegata' : 'ricerca locale + parser a regole')}</b>.
      La ricerca funziona completamente offline.
    </p>
  `;

  return { title: 'Ricerca', sub: `${res.total} risultati`, html, mount: (ctx) => bind(ctx) };
}

function resultCard(r, q) {
  const { type, item } = r;
  const meta = TYPE_META[type];
  const cat = categoryById(item.categoryId);
  let title = item.title || item.name || String(item.text || '').slice(0, 60);
  let sub = [];
  let body = '';

  if (type === 'task') {
    sub = [effLabel(item), item.due ? `🕒 ${esc(relDay(item.due))}` : 'senza scadenza', item.estimateMin ? `⏳ ${esc(minToLabel(item.estimateMin))}` : ''];
    body = item.description || '';
  } else if (type === 'event') {
    sub = [`📅 ${esc(fmtDate(item.start, 'datetime'))}`, item.location ? `📍 ${esc(item.location)}` : ''];
    body = item.description || '';
  } else if (type === 'note') {
    sub = [`🕒 ${esc(fmtDate(item.updatedAt || item.createdAt, 'medium'))}`];
    body = item.text || '';
  } else if (type === 'idea') {
    sub = [`${'★'.repeat(Math.round(Number(item.importance) || 0))}`, `voto ${Number(item.rating) || 0}/10`];
    body = item.description || '';
  } else if (type === 'goal') {
    sub = [`avanzamento ${Number(item.progress) || 0}%`, item.due ? `🗓️ ${esc(relDay(item.due))}` : ''];
    body = item.description || '';
  } else if (type === 'journal') {
    sub = [`🕒 ${esc(fmtDate(item.time || item.createdAt, 'datetime'))}`];
    body = item.text || '';
  } else {
    sub = [`🕒 ${esc(fmtDate(item.createdAt, 'datetime'))}`];
    body = item.text || '';
  }

  return `<div class="card tap" data-result="${esc(type)}|${esc(item.id)}">
    <div style="display:flex;gap:10px;align-items:flex-start">
      <span style="font-size:20px">${meta.icon}</span>
      <div style="flex:1;min-width:0">
        <div class="row-title">${highlight(String(title).slice(0, 90), q)}</div>
        <div class="row-sub" style="margin-top:3px">
          <span class="badge">${esc(meta.label)}</span>
          ${cat ? `<span>${cat.icon} ${esc(cat.name)}</span>` : ''}
          ${sub.filter(Boolean).map((s) => `<span>${s}</span>`).join('')}
        </div>
        ${body ? `<p class="dim" style="margin-top:8px;font-size:13px">${highlight(String(body).replace(/\s+/g, ' ').slice(0, 180), q)}</p>` : ''}
      </div>
      <span class="dim">›</span>
    </div>
  </div>`;
}

function effLabel(item) {
  const st = effectiveStatus(item);
  return { todo: '⚪ da fare', doing: '🔵 in corso', done: '🟢 completata', expired: '🔴 scaduta' }[st] || '';
}

function bind(ctx) {
  const root = ctx.root;
  attachMics(root);

  const input = qs('#q', root);
  const doSearch = debounce(() => { ctx.refresh(); }, 380);
  input?.addEventListener('input', () => { state.query = input.value; doSearch(); });

  onClick(root, '[data-type]', (el) => {
    const t = el.dataset.type;
    state.types = state.types.includes(t) ? state.types.filter((x) => x !== t) : [...state.types, t];
    ctx.refresh();
  });
  onClick(root, '[data-cat]', (el) => { state.categoryId = el.dataset.cat; ctx.refresh(); });
  onClick(root, '[data-range]', (el) => { state.range = el.dataset.range; ctx.refresh(); });
  onClick(root, '[data-status]', (el) => { state.status = state.status === el.dataset.status ? '' : el.dataset.status; ctx.refresh(); });
  onClick(root, '[data-prio]', (el) => { state.priority = state.priority === el.dataset.prio ? '' : el.dataset.prio; ctx.refresh(); });
  onClick(root, '[data-reset]', () => {
    Object.assign(state, { query: '', types: [], categoryId: '', status: '', priority: '', range: 'all' });
    ctx.refresh();
  });

  onClick(root, '[data-ask]', async () => {
    const q = state.query.trim();
    if (!q) { toast('Scrivi prima una domanda'); input?.focus(); return; }
    const loading = node('<div class="card"><div class="muted">Sto cercando nei tuoi dati…</div></div>');
    const holder = qs('#results', root);
    holder.prepend(loading);
    const text = await answer(q);
    loading.remove();
    const body = node(`<div>
      <p class="muted">Domanda: <b>${esc(q)}</b></p>
      <div class="divider"></div>
      <p style="white-space:pre-wrap;line-height:1.6;font-size:14.5px">${esc(text)}</p>
      <p class="mic-hint">${capabilities().remote ? 'Risposta generata con il provider AI configurato.' : 'Risposta generata localmente con ricerca per parole chiave: nessun dato lascia il dispositivo.'}</p>
    </div>`);
    const foot = node(`<div class="btn-row" style="width:100%">
      ${synthSupported ? '<button class="btn sm" data-read>🔊 Leggi</button>' : ''}
      <button class="btn sm primary" data-close style="flex:1">Chiudi</button>
    </div>`);
    const s = sheet({ title: '🤖 Chiedi a LifeOS', body, foot });
    onClick(foot, '[data-close]', () => s.close());
    onClick(foot, '[data-read]', () => speak(text));
  });

  onClick(root, '[data-result]', async (el) => {
    const [type, id] = el.dataset.result.split('|');
    const storeOf = { task: 'tasks', event: 'events', note: 'notes', idea: 'ideas', goal: 'goals', journal: 'journal', inbox: 'inbox' };
    const item = byId(storeOf[type], id);
    if (!item) { toast('Elemento non trovato'); return; }
    const choice = await actionSheet(item.title || item.name || 'Elemento', [
      { label: 'Apri / modifica', icon: '📂', value: 'open' },
      { label: 'Vai alla sezione', icon: '➡️', value: 'go', desc: TYPE_META[type].label },
      { label: 'Elimina', icon: '🗑️', value: 'del', danger: true }
    ]);
    if (choice === 'open') openEditor(type, id, () => ctx.refresh());
    if (choice === 'go') location.hash = `#/${TYPE_META[type].route}`;
    if (choice === 'del') {
      const ok = await confirmDialog({ title: 'Eliminare?', message: 'L\'elemento verrà rimosso dal dispositivo.', confirmText: 'Elimina', danger: true });
      if (ok) { await remove(storeOf[type], id); toast('Eliminato'); ctx.refresh(); }
    }
  });
}
