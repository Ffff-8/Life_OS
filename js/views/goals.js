/* ==========================================================================
   LifeOS — views/goals.js
   Obiettivi con barra di avanzamento, sotto-attività e categorie.
   ========================================================================== */

import { list, byId, save, remove, categoryById } from '../store.js';
import { esc, fmtDate, relDay, clamp, pct } from '../utils.js';
import { qs, onClick, emptyState, toast, actionSheet, confirmDialog, priorityBadge } from '../ui.js';
import { openEditor } from '../editors.js';

export function render() {
  const all = list('goals');
  const active = all.filter((g) => (Number(g.progress) || 0) < 100);
  const done = all.filter((g) => (Number(g.progress) || 0) >= 100);
  const avg = all.length ? Math.round(all.reduce((a, g) => a + (Number(g.progress) || 0), 0) / all.length) : 0;

  const html = `
    <div class="page-head">
      <div class="h1">Obiettivi</div>
      <div class="muted">${active.length} attivi · ${done.length} completati · avanzamento medio ${avg}%</div>
    </div>

    <div class="btn-row" style="margin-bottom:14px">
      <button class="btn sm primary" data-new>➕ Nuovo obiettivo</button>
    </div>

    ${all.length ? `
      ${active.length ? `<section class="section"><div class="section-head"><div class="h3">🎯 In corso <span class="count">${active.length}</span></div></div>${active.map(goalCard).join('')}</section>` : ''}
      ${done.length ? `<section class="section"><div class="section-head"><div class="h3">🏆 Completati <span class="count">${done.length}</span></div></div>${done.map(goalCard).join('')}</section>` : ''}
    ` : emptyState('🎯', 'Nessun obiettivo', 'Un obiettivo è un traguardo con una data e una percentuale: qui vedi a colpo d\'occhio quanto manca.', `<button class="btn primary" data-new>Crea obiettivo</button>`)}
  `;

  return { title: 'Obiettivi', sub: `${all.length} totali`, html, mount: (ctx) => bind(ctx) };
}

function goalCard(g) {
  const p = clamp(Number(g.progress) || 0, 0, 100);
  const cat = categoryById(g.categoryId);
  const subs = g.subtasks || [];
  const doneSubs = subs.filter((s) => s.done).length;
  const overdue = g.due && new Date(g.due) < new Date() && p < 100;
  return `<div class="card" data-goal="${esc(g.id)}">
    <div style="display:flex;gap:10px;align-items:flex-start">
      <div style="flex:1;min-width:0">
        <div class="row-title">${esc(g.name)}</div>
        <div class="row-sub" style="margin-top:4px">
          ${priorityBadge(g.priority)}
          ${cat ? `<span>${cat.icon} ${esc(cat.name)}</span>` : ''}
          ${g.due ? `<span style="${overdue ? 'color:var(--danger)' : ''}">🗓️ ${esc(overdue ? 'scaduto ' + relDay(g.due).toLowerCase() : relDay(g.due))}</span>` : ''}
          ${g.startDate ? `<span>dal ${esc(fmtDate(g.startDate, 'medium'))}</span>` : ''}
        </div>
      </div>
      <button class="icon-btn" data-menu="${esc(g.id)}" aria-label="Azioni">⋯</button>
    </div>

    ${g.description ? `<p class="muted" style="margin-top:9px;font-size:13.5px">${esc(g.description)}</p>` : ''}

    <div class="progress-wrap" style="margin-top:12px">
      <div class="progress-top" style="color:var(--text-2)">
        <span>Completamento</span><span style="font-weight:800;color:var(--text)">${p}%</span>
      </div>
      <div class="progress-line"><i style="width:${p}%"></i></div>
    </div>

    ${subs.length ? `<div class="checklist" style="margin-top:12px">
      ${subs.map((s) => `<div class="check-item ${s.done ? 'done' : ''}">
        <button class="check ${s.done ? 'on' : ''}" data-sub="${esc(g.id)}|${esc(s.id)}">✓</button>
        <span class="ci-text">${esc(s.text)}</span>
      </div>`).join('')}
      <div class="dim" style="margin-top:4px">☑ ${doneSubs}/${subs.length} sotto-attività completate</div>
    </div>` : ''}

    <div class="btn-row" style="margin-top:11px">
      <button class="btn xs" data-edit="${esc(g.id)}">✏️ Modifica</button>
      <button class="btn xs" data-quick="${esc(g.id)}|25">+25%</button>
      <button class="btn xs" data-quick="${esc(g.id)}|100">Completa</button>
    </div>
  </div>`;
}

function bind(ctx) {
  const root = ctx.root;

  onClick(root, '[data-new]', () => openEditor('goal', null, () => ctx.refresh()));
  onClick(root, '[data-edit]', (el, e) => { e.stopPropagation(); openEditor('goal', el.dataset.edit, () => ctx.refresh()); });
  onClick(root, '[data-goal]', (el, e) => {
    if (e.target.closest('button')) return;
    openEditor('goal', el.dataset.goal, () => ctx.refresh());
  });

  onClick(root, '[data-quick]', async (el, e) => {
    e.stopPropagation();
    const [id, val] = el.dataset.quick.split('|');
    const g = byId('goals', id); if (!g) return;
    const next = val === '100' ? 100 : clamp((Number(g.progress) || 0) + 25, 0, 100);
    await save('goals', { id, progress: next });
    toast(next === 100 ? 'Obiettivo completato 🏆' : `Avanzamento: ${next}%`);
    ctx.refresh();
  });

  // sotto-attività: spunta + ricalcolo automatico della percentuale
  onClick(root, '[data-sub]', async (el, e) => {
    e.stopPropagation();
    const [gid, sid] = el.dataset.sub.split('|');
    const g = byId('goals', gid); if (!g) return;
    const subs = (g.subtasks || []).map((s) => (s.id === sid ? { ...s, done: !s.done } : s));
    const progress = subs.length ? Math.round((subs.filter((s) => s.done).length / subs.length) * 100) : (Number(g.progress) || 0);
    await save('goals', { id: gid, subtasks: subs, progress });
    ctx.refresh();
  });

  onClick(root, '[data-menu]', async (el, e) => {
    e.stopPropagation();
    const g = byId('goals', el.dataset.menu);
    if (!g) return;
    const choice = await actionSheet(g.name, [
      { label: 'Modifica', icon: '✏️', value: 'edit' },
      { label: 'Imposta 0%', icon: '↩️', value: 'zero' },
      { label: 'Imposta 100%', icon: '🏆', value: 'full' },
      { label: 'Duplica', icon: '📄', value: 'dup' },
      { label: 'Elimina', icon: '🗑️', value: 'del', danger: true }
    ]);
    if (choice === 'edit') return openEditor('goal', g.id, () => ctx.refresh());
    if (choice === 'zero') { await save('goals', { id: g.id, progress: 0 }); return ctx.refresh(); }
    if (choice === 'full') { await save('goals', { id: g.id, progress: 100 }); return ctx.refresh(); }
    if (choice === 'dup') { const s = await import('../store.js'); await s.duplicate('goals', g.id); toast('Obiettivo duplicato'); return ctx.refresh(); }
    if (choice === 'del') {
      const ok = await confirmDialog({ title: 'Eliminare l\'obiettivo?', message: `"${g.name}" verrà rimosso.`, confirmText: 'Elimina', danger: true });
      if (ok) { await remove('goals', g.id); toast('Obiettivo eliminato'); ctx.refresh(); }
    }
  });
}
