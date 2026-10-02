/* ==========================================================================
   LifeOS — views/ideas.js
   Sezione idee: stato, importanza, fattibilità, valutazione a stelle.
   ========================================================================== */

import { list, byId, save, remove, categoryById, ideasRecent } from '../store.js';
import { esc, fmtDate, relTime, norm } from '../utils.js';
import { qs, onClick, emptyState, toast, actionSheet, confirmDialog, starsReadonly } from '../ui.js';
import { openEditor, IDEA_STATUS } from '../editors.js';
import { attachMics } from '../voice.js';

let statusFilter = '';
let sortMode = 'recent';
let query = '';

export function render({ params }) {
  if (params.filter) statusFilter = params.filter === 'all' ? '' : params.filter;
  const all = list('ideas');
  const items = applyFilter(all);

  const byStatus = {};
  all.forEach((i) => { byStatus[i.status || 'idea'] = (byStatus[i.status || 'idea'] || 0) + 1; });

  const html = `
    <div class="page-head">
      <div class="h1">Idee</div>
      <div class="muted">${items.length} di ${all.length} idee · 💭 ${byStatus.idea || 0} grezze · 🔧 ${byStatus.developing || 0} in sviluppo · ✅ ${byStatus.done || 0} realizzate</div>
    </div>

    <div class="field">
      <div class="input-voice">
        <input class="input" id="idea-q" value="${esc(query)}" placeholder="Cerca tra le idee…" />
        <button class="mic-btn" data-mic="idea-q" aria-label="Cerca con la voce">🎤</button>
      </div>
    </div>

    <div class="filter-bar">
      <div class="chips">
        <button class="chip ${!statusFilter ? 'on' : ''}" data-status="">Tutte</button>
        ${IDEA_STATUS.map((s) => `<button class="chip ${statusFilter === s.value ? 'on' : ''}" data-status="${s.value}">${s.label}</button>`).join('')}
      </div>
    </div>

    <div class="btn-row" style="margin:4px 0 12px">
      <button class="btn sm primary" data-new>➕ Nuova idea</button>
      <button class="btn sm" data-sort>⇅ ${esc(sortLabel())}</button>
      <button class="btn sm" data-voice>🎙️</button>
    </div>

    ${items.length ? items.map(ideaCard).join('') : emptyState('💡', 'Nessuna idea salvata', 'Le idee migliori arrivano nei momenti peggiori: dettale subito e ritrovale qui.', `<button class="btn primary" data-new>Annota un\'idea</button>`)}
  `;

  return { title: 'Idee', sub: `${items.length} idee`, html, mount: (ctx) => bind(ctx) };
}

function sortLabel() {
  return { recent: 'Più recenti', importance: 'Importanza', feasibility: 'Fattibilità', rating: 'Valutazione', title: 'Titolo' }[sortMode];
}

function applyFilter(all) {
  let items = [...all];
  if (statusFilter) items = items.filter((i) => (i.status || 'idea') === statusFilter);
  if (query.trim()) {
    const q = norm(query);
    items = items.filter((i) => norm(`${i.title} ${i.description} ${i.notes} ${(i.tags || []).join(' ')}`).includes(q));
  }
  const s = { recent: (i) => new Date(i.createdAt).getTime(), importance: (i) => Number(i.importance) || 0, feasibility: (i) => Number(i.feasibility) || 0, rating: (i) => Number(i.rating) || 0, title: (i) => String(i.title || '').toLowerCase() };
  const dir = sortMode === 'title' ? 1 : -1;
  return items.sort((a, b) => {
    const av = s[sortMode](a); const bv = s[sortMode](b);
    return av > bv ? dir : av < bv ? -dir : 0;
  });
}

function ideaCard(i) {
  const cat = categoryById(i.categoryId);
  const st = IDEA_STATUS.find((s) => s.value === (i.status || 'idea'));
  return `<div class="card tap" data-idea="${esc(i.id)}">
    <div style="display:flex;gap:10px;align-items:flex-start">
      <div style="flex:1;min-width:0">
        <div class="row-title">${esc(i.title || 'Idea')}</div>
        <div class="row-sub" style="margin-top:4px">
          <span class="badge">${esc(st?.label || '💭 Idea')}</span>
          ${cat ? `<span>${cat.icon} ${esc(cat.name)}</span>` : ''}
          <span>${esc(relTime(i.createdAt))}</span>
        </div>
      </div>
      <button class="icon-btn" data-menu="${esc(i.id)}" aria-label="Azioni">⋯</button>
    </div>
    ${i.description ? `<p class="muted" style="margin-top:9px;font-size:13.5px;white-space:pre-wrap">${esc(String(i.description).slice(0, 220))}${String(i.description).length > 220 ? '…' : ''}</p>` : ''}
    <div class="stat-grid" style="margin-top:11px;grid-template-columns:repeat(3,1fr)">
      <div style="text-align:center">
        <div class="dim">Importanza</div>
        <div style="color:#f5a524;font-size:16px">${starsReadonly(i.importance)}</div>
      </div>
      <div style="text-align:center">
        <div class="dim">Fattibilità</div>
        <div style="color:#f5a524;font-size:16px">${starsReadonly(i.feasibility)}</div>
      </div>
      <div style="text-align:center">
        <div class="dim">Voto</div>
        <div style="font-weight:700">${Number(i.rating) || 0}/10</div>
      </div>
    </div>
    ${(i.tags || []).length ? `<div class="chips" style="margin-top:10px">${(i.tags || []).map((t) => `<span class="tag">#${esc(t)}</span>`).join('')}</div>` : ''}
    ${i.notes ? `<p class="dim" style="margin-top:9px">📌 ${esc(String(i.notes).slice(0, 160))}</p>` : ''}
  </div>`;
}

function bind(ctx) {
  const root = ctx.root;
  attachMics(root);

  let tmr = null;
  qs('#idea-q', root)?.addEventListener('input', (e) => { query = e.target.value; clearTimeout(tmr); tmr = setTimeout(() => ctx.refresh(), 420); });

  onClick(root, '[data-status]', (el) => { statusFilter = el.dataset.status; ctx.refresh(); });
  onClick(root, '[data-new]', () => openEditor('idea', null, () => ctx.refresh()));
  onClick(root, '[data-voice]', () => { location.hash = '#/voice?target=idea'; });

  onClick(root, '[data-sort]', async () => {
    const c = await actionSheet('Ordina per', [
      { label: 'Più recenti', icon: '🆕', value: 'recent' },
      { label: 'Importanza', icon: '⭐', value: 'importance' },
      { label: 'Fattibilità', icon: '🛠️', value: 'feasibility' },
      { label: 'Valutazione', icon: '🔢', value: 'rating' },
      { label: 'Titolo', icon: '🔤', value: 'title' }
    ]);
    if (c) { sortMode = c; ctx.refresh(); }
  });

  onClick(root, '[data-idea]', (el, e) => {
    if (e.target.closest('[data-menu]')) return;
    openEditor('idea', el.dataset.idea, () => ctx.refresh());
  });

  onClick(root, '[data-menu]', async (el, e) => {
    e.stopPropagation();
    const i = byId('ideas', el.dataset.menu);
    if (!i) return;
    const nextStatus = IDEA_STATUS.find((s) => s.value !== (i.status || 'idea'));
    const choice = await actionSheet(i.title || 'Idea', [
      { label: 'Modifica', icon: '✏️', value: 'edit' },
      { label: 'Segna "in sviluppo"', icon: '🔧', value: 'dev' },
      { label: 'Segna "realizzata"', icon: '✅', value: 'done' },
      { label: 'Duplica', icon: '📄', value: 'dup' },
      { label: 'Elimina', icon: '🗑️', value: 'del', danger: true }
    ]);
    if (choice === 'edit') return openEditor('idea', i.id, () => ctx.refresh());
    if (choice === 'dev') { await save('ideas', { id: i.id, status: 'developing' }); toast('Segnata in sviluppo'); return ctx.refresh(); }
    if (choice === 'done') { await save('ideas', { id: i.id, status: 'done' }); toast('Idea realizzata 🎉'); return ctx.refresh(); }
    if (choice === 'dup') { const s = await import('../store.js'); await s.duplicate('ideas', i.id); toast('Idea duplicata'); return ctx.refresh(); }
    if (choice === 'del') {
      const ok = await confirmDialog({ title: 'Eliminare l\'idea?', message: `"${i.title}" verrà rimossa.`, confirmText: 'Elimina', danger: true });
      if (ok) { await remove('ideas', i.id); toast('Idea eliminata'); ctx.refresh(); }
    }
  });
}
