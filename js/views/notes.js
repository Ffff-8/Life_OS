/* ==========================================================================
   LifeOS — views/notes.js
   Note con ricerca, categorie, tag, preferiti, archivio e dettatura.
   ========================================================================== */

import { list, byId, save, remove, categoryById, notesRecent } from '../store.js';
import { esc, relTime, titleFrom, fmtDate, norm } from '../utils.js';
import { qs, onClick, emptyState, toast, actionSheet, confirmDialog } from '../ui.js';
import { openEditor } from '../editors.js';
import { attachMics } from '../voice.js';

let mode = 'active';   // active | favorites | archived
let catFilter = '';
let query = '';

export function render({ params }) {
  if (params.filter) mode = params.filter;
  const items = applyFilter();

  const all = list('notes');
  const favCount = all.filter((n) => n.favorite && !n.archived).length;
  const archCount = all.filter((n) => n.archived).length;

  const html = `
    <div class="page-head">
      <div class="h1">Note</div>
      <div class="muted">${items.length} ${items.length === 1 ? 'nota' : 'note'}${archCount ? ` · ${archCount} in archivio` : ''}</div>
    </div>

    <div class="field">
      <div class="input-voice">
        <input class="input" id="note-q" value="${esc(query)}" placeholder="Cerca nelle note…" />
        <button class="mic-btn" data-mic="note-q" aria-label="Cerca con la voce">🎤</button>
      </div>
    </div>

    <div class="filter-bar">
      <div class="chips">
        <button class="chip ${mode === 'active' ? 'on' : ''}" data-mode="active">🗒️ Tutte</button>
        <button class="chip ${mode === 'favorites' ? 'on' : ''}" data-mode="favorites">⭐ Preferite ${favCount ? `(${favCount})` : ''}</button>
        <button class="chip ${mode === 'archived' ? 'on' : ''}" data-mode="archived">📦 Archivio ${archCount ? `(${archCount})` : ''}</button>
        <button class="chip ${!catFilter ? 'on' : ''}" data-cat="">Tutte le categorie</button>
        ${list('categories').map((c) => `<button class="chip ${catFilter === c.id ? 'on' : ''}" data-cat="${esc(c.id)}">${c.icon || '📁'} ${esc(c.name)}</button>`).join('')}
      </div>
    </div>

    <div class="btn-row" style="margin:4px 0 12px">
      <button class="btn sm primary" data-new>➕ Nuova nota</button>
      <button class="btn sm" data-voice>🎙️ Dettà una nota</button>
    </div>

    ${items.length ? items.map(noteCard).join('') : emptyState('📝', 'Nessuna nota qui', 'Scrivi o detta un appunto: resta sul tuo telefono e funziona anche offline.', `<button class="btn primary" data-new>Crea nota</button>`)}
  `;

  return { title: 'Note', sub: `${items.length} risultati`, html, mount: (ctx) => bind(ctx) };
}

function applyFilter() {
  let items = [...list('notes')];
  if (mode === 'archived') items = items.filter((n) => n.archived);
  else if (mode === 'favorites') items = items.filter((n) => n.favorite && !n.archived);
  else items = items.filter((n) => !n.archived);

  if (catFilter) items = items.filter((n) => n.categoryId === catFilter);

  if (query.trim()) {
    const q = norm(query);
    items = items.filter((n) => norm(`${n.title} ${n.text} ${(n.tags || []).join(' ')} ${categoryById(n.categoryId)?.name || ''}`).includes(q));
  }
  return items.sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt));
}

function noteCard(n) {
  const cat = categoryById(n.categoryId);
  const preview = String(n.text || '').replace(/\s+/g, ' ').slice(0, 170);
  return `<div class="card tap" data-note="${esc(n.id)}">
    <div style="display:flex;gap:10px;align-items:flex-start">
      <div style="flex:1;min-width:0">
        <div class="row-title">${n.favorite ? '⭐ ' : ''}${esc(n.title || 'Senza titolo')}</div>
        <div class="row-sub" style="margin-top:3px">
          <span>${esc(relTime(n.updatedAt || n.createdAt))}</span>
          ${cat ? `<span>${cat.icon} ${esc(cat.name)}</span>` : ''}
          ${(n.attachments || []).length ? `<span>📎 ${n.attachments.length}</span>` : ''}
        </div>
      </div>
      <button class="icon-btn" data-menu="${esc(n.id)}" aria-label="Azioni">⋯</button>
    </div>
    ${preview ? `<p class="muted" style="margin-top:9px;font-size:13.5px;white-space:pre-wrap">${esc(preview)}${String(n.text || '').length > 170 ? '…' : ''}</p>` : ''}
    ${(n.tags || []).length ? `<div class="chips" style="margin-top:9px">${(n.tags || []).map((t) => `<span class="tag">#${esc(t)}</span>`).join('')}</div>` : ''}
    ${n.archived ? '<div class="dim" style="margin-top:7px">📦 in archivio</div>' : ''}
  </div>`;
}

function bind(ctx) {
  const root = ctx.root;
  attachMics(root);

  let tmr = null;
  qs('#note-q', root)?.addEventListener('input', (e) => {
    query = e.target.value;
    clearTimeout(tmr);
    tmr = setTimeout(() => ctx.refresh(), 420);
  });

  onClick(root, '[data-mode]', (el) => { mode = el.dataset.mode; ctx.refresh(); });
  onClick(root, '[data-cat]', (el) => { catFilter = el.dataset.cat; ctx.refresh(); });

  onClick(root, '[data-new]', () => openEditor('note', null, () => ctx.refresh(), catFilter ? { categoryId: catFilter } : {}));
  onClick(root, '[data-voice]', () => { location.hash = '#/voice?target=note'; });

  onClick(root, '[data-note]', (el, e) => {
    if (e.target.closest('[data-menu]')) return;
    openEditor('note', el.dataset.note, () => ctx.refresh());
  });

  onClick(root, '[data-menu]', async (el, e) => {
    e.stopPropagation();
    const n = byId('notes', el.dataset.menu);
    if (!n) return;
    const choice = await actionSheet(n.title || 'Nota', [
      { label: 'Modifica', icon: '✏️', value: 'edit' },
      { label: n.favorite ? 'Togli dai preferiti' : 'Segna preferita', icon: '⭐', value: 'fav' },
      { label: n.archived ? 'Ripristina' : 'Archivia', icon: '📦', value: 'arch' },
      { label: 'Duplica', icon: '📄', value: 'dup' },
      { label: 'Elimina', icon: '🗑️', value: 'del', danger: true }
    ]);
    if (choice === 'edit') return openEditor('note', n.id, () => ctx.refresh());
    if (choice === 'fav') { await save('notes', { id: n.id, favorite: !n.favorite }); toast(n.favorite ? 'Rimossa dai preferiti' : 'Aggiunta ai preferiti'); return ctx.refresh(); }
    if (choice === 'arch') { await save('notes', { id: n.id, archived: !n.archived }); toast(n.archived ? 'Ripristinata' : 'Archiviata'); return ctx.refresh(); }
    if (choice === 'dup') { const s = await import('../store.js'); await s.duplicate('notes', n.id); toast('Nota duplicata'); return ctx.refresh(); }
    if (choice === 'del') {
      const ok = await confirmDialog({ title: 'Eliminare la nota?', message: `"${n.title || 'Senza titolo'}" verrà rimossa definitivamente.`, confirmText: 'Elimina', danger: true });
      if (ok) { await remove('notes', n.id); toast('Nota eliminata'); ctx.refresh(); }
    }
  });
}
