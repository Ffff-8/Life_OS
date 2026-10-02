/* ==========================================================================
   LifeOS — views/tasks.js
   Elenco attività con filtri, raggruppamento, completamento rapido,
   posticipo e gestione del ciclo di vita (da fare / in corso / completata).
   ========================================================================== */

import {
  list, byId, save, remove, effectiveStatus, categoryById, getSetting, setSetting,
  tasksOverdue, tasksToday
} from '../store.js';
import { esc, humanWhen, minToLabel, fmtDate, relDay, addDays, sortBy, clamp } from '../utils.js';
import { qs, qsa, onClick, emptyState, toast, actionSheet, confirmDialog, priorityBadge, statusBadge } from '../ui.js';
import { openEditor, TASK_STATUS } from '../editors.js';
import { attachMics } from '../voice.js';

const FILTERS = [
  { id: 'all', label: 'Tutte' },
  { id: 'today', label: 'Oggi' },
  { id: 'week', label: '7 giorni' },
  { id: 'open', label: 'Da fare' },
  { id: 'doing', label: 'In corso' },
  { id: 'expired', label: 'Scadute' },
  { id: 'done', label: 'Completate' },
  { id: 'nodue', label: 'Senza data' }
];

let filter = 'all';
let sortMode = 'due';
let query = '';

export function render({ params }) {
  if (params.filter) filter = params.filter;
  if (params.q) query = params.q;
  if (params.new === 'task') {
    setTimeout(() => openEditor('task', null, () => location.reload()), 60);
  }

  const items = applyFilter();
  const groups = { todo: [], doing: [], done: [], expired: [] };
  items.forEach((t) => { groups[effectiveStatus(t)].push(t); });

  const overdueCount = tasksOverdue().length;
  const doneToday = list('tasks').filter((t) => t.status === 'done' && t.completedAt && new Date(t.completedAt).toDateString() === new Date().toDateString()).length;

  const html = `
    <div class="page-head">
      <div class="h1">Attività</div>
      <div class="muted">${items.length} ${items.length === 1 ? 'elemento' : 'elementi'}${overdueCount ? ` · 🔴 ${overdueCount} scadut${overdueCount === 1 ? 'a' : 'e'}` : ''}${doneToday ? ` · 🟢 ${doneToday} completate oggi` : ''}</div>
    </div>

    <div class="field">
      <div class="input-voice">
        <input class="input" id="task-q" value="${esc(query)}" placeholder="Filtra per titolo, tag, categoria…" />
        <button class="mic-btn" data-mic="task-q" aria-label="Cerca con la voce">🎤</button>
      </div>
    </div>

    <div class="filter-bar">
      <div class="chips">
        ${FILTERS.map((f) => `<button class="chip ${filter === f.id ? 'on' : ''}" data-filter="${f.id}">${esc(f.label)}${f.id === 'expired' && overdueCount ? ` (${overdueCount})` : ''}</button>`).join('')}
      </div>
    </div>

    <div class="btn-row" style="margin:4px 0 12px">
      <button class="btn sm primary" data-new>➕ Nuova attività</button>
      <button class="btn sm" data-sort>⇅ ${esc(sortLabel())}</button>
    </div>

    ${items.length ? `
      ${groups.todo.length ? groupBlock('⚪ Da fare', groups.todo, 'todo') : ''}
      ${groups.doing.length ? groupBlock('🔵 In corso', groups.doing, 'doing') : ''}
      ${groups.expired.length ? groupBlock('🔴 Scadute', groups.expired, 'expired') : ''}
      ${groups.done.length ? groupBlock('🟢 Completate', groups.done, 'done') : ''}
    ` : emptyState('🎉', 'Nessuna attività in questa vista', 'Cambia filtro oppure crea una nuova attività. Il pulsante + in basso è sempre disponibile.',
        `<button class="btn primary" data-new>Crea attività</button>`)}
  `;

  return {
    title: 'Attività', sub: `${items.length} elementi`,
    html,
    mount: (ctx) => bind(ctx)
  };
}

function sortLabel() {
  return { due: 'Scadenza', priority: 'Priorità', created: 'Creazione', title: 'Titolo', estimate: 'Stima' }[sortMode] || 'Scadenza';
}

function applyFilter() {
  let items = [...list('tasks')];

  if (filter === 'today') {
    items = items.filter((t) => t.due && new Date(t.due).toDateString() === new Date().toDateString());
  } else if (filter === 'week') {
    const limit = addDays(new Date(), 7).getTime();
    items = items.filter((t) => t.due && new Date(t.due).getTime() <= limit && t.status !== 'done');
  } else if (filter === 'open') {
    items = items.filter((t) => t.status !== 'done');
  } else if (filter === 'doing') {
    items = items.filter((t) => t.status === 'doing');
  } else if (filter === 'expired') {
    items = items.filter((t) => effectiveStatus(t) === 'expired');
  } else if (filter === 'done') {
    items = items.filter((t) => t.status === 'done');
  } else if (filter === 'nodue') {
    items = items.filter((t) => !t.due && t.status !== 'done');
  }

  if (query.trim()) {
    const q = query.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    items = items.filter((t) => {
      const hay = `${t.title} ${t.description || ''} ${(t.tags || []).join(' ')} ${categoryById(t.categoryId)?.name || ''}`
        .toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      return hay.includes(q);
    });
  }

  const prioRank = { urgent: 0, normal: 1, low: 2 };
  if (sortMode === 'priority') items = sortBy(items, (t) => prioRank[t.priority] ?? 1);
  else if (sortMode === 'title') items = sortBy(items, (t) => (t.title || '').toLowerCase());
  else if (sortMode === 'created') items = sortBy(items, (t) => new Date(t.createdAt).getTime(), -1);
  else if (sortMode === 'estimate') items = sortBy(items, (t) => Number(t.estimateMin) || 9999);
  else items = sortBy(items, (t) => (t.due ? new Date(t.due).getTime() : Infinity));

  return items;
}

function groupBlock(title, items, kind) {
  return `<section class="section">
    <div class="section-head"><div class="h3">${title} <span class="count">${items.length}</span></div></div>
    ${items.map(taskRow).join('')}
  </section>`;
}

function taskRow(t) {
  const st = effectiveStatus(t);
  const cat = categoryById(t.categoryId);
  const checks = t.checklist || [];
  const doneChecks = checks.filter((c) => c.done).length;
  return `<div class="row swipeable ${st === 'expired' ? 'overdue' : ''} ${t.status === 'done' ? 'done' : ''}" data-task="${esc(t.id)}">
    <button class="check ${t.status === 'done' ? 'on' : ''}" data-toggle="${esc(t.id)}" aria-label="Completa">✓</button>
    <span class="row-bar" style="background:${cat ? esc(cat.color) : 'var(--text-3)'}"></span>
    <div class="row-body">
      <div class="row-title">${esc(t.title)}</div>
      <div class="row-sub">
        ${priorityBadge(t.priority)}
        ${st !== 'todo' ? statusBadge(st) : ''}
        ${t.due ? `<span>🕒 ${esc(humanWhen(t.due))}</span>` : '<span class="dim">senza scadenza</span>'}
        ${cat ? `<span>${cat.icon} ${esc(cat.name)}</span>` : ''}
        ${checks.length ? `<span>☑ ${doneChecks}/${checks.length}</span>` : ''}
        ${t.estimateMin ? `<span>⏳ ${esc(minToLabel(t.estimateMin))}</span>` : ''}
        ${(t.tags || []).slice(0, 3).map((x) => `<span class="tag">#${esc(x)}</span>`).join('')}
      </div>
      ${checks.length ? `<div class="progress-line" style="margin-top:8px"><i style="width:${Math.round((doneChecks / checks.length) * 100)}%"></i></div>` : ''}
    </div>
    <button class="icon-btn" data-menu="${esc(t.id)}" aria-label="Azioni">⋯</button>
  </div>`;
}

/* -------------------------------- binding ------------------------------- */
function bind(ctx) {
  const root = ctx.root;
  attachMics(root);

  const searchInput = qs('#task-q', root);
  // debounce: rimandiamo il refresh della vista per non perdere il focus del campo
  let tmr = null;
  searchInput?.addEventListener('input', () => {
    query = searchInput.value;
    clearTimeout(tmr);
    tmr = setTimeout(() => { persistFilters(); ctx.refresh(); }, 420);
  });

  onClick(root, '[data-filter]', (el) => { filter = el.dataset.filter; persistFilters(); ctx.refresh(); });

  onClick(root, '[data-sort]', async () => {
    const choice = await actionSheet('Ordina per', [
      { label: 'Scadenza', icon: '🕒', value: 'due' },
      { label: 'Priorità', icon: '🔴', value: 'priority' },
      { label: 'Titolo', icon: '🔤', value: 'title' },
      { label: 'Creazione', icon: '🆕', value: 'created' },
      { label: 'Tempo stimato', icon: '⏳', value: 'estimate' }
    ]);
    if (choice) { sortMode = choice; ctx.refresh(); }
  });

  onClick(root, '[data-new]', () => openEditor('task', null, () => ctx.refresh(), {
    due: defaultDue(), reminders: getSetting('defaultRemindersTask', [60])
  }));

  onClick(root, '[data-toggle]', async (el, e) => {
    e.stopPropagation();
    const t = byId('tasks', el.dataset.toggle);
    if (!t) return;
    const done = t.status !== 'done';
    await save('tasks', { id: t.id, status: done ? 'done' : 'todo', completedAt: done ? new Date().toISOString() : null });
    toast(done ? 'Completata 🎉' : 'Riaperta');
    ctx.refresh();
  });

  onClick(root, '[data-task]', (el, e) => {
    if (e.target.closest('[data-toggle]') || e.target.closest('[data-menu]')) return;
    openEditor('task', el.dataset.task, () => ctx.refresh());
  });

  onClick(root, '[data-menu]', async (el, e) => {
    e.stopPropagation();
    const t = byId('tasks', el.dataset.menu);
    if (!t) return;
    const choice = await actionSheet(t.title, [
      { label: 'Modifica', icon: '✏️', value: 'edit' },
      { label: 'Posticipa a domani', icon: '➡️', value: 'p1' },
      { label: 'Posticipa di 7 giorni', icon: '⏭️', value: 'p7' },
      { label: 'Posticipa di 1 mese', icon: '📅', value: 'p30' },
      { label: 'Segna "in corso"', icon: '🔵', value: 'doing' },
      { label: 'Togli scadenza', icon: '🚫', value: 'nodue' },
      { label: 'Duplica', icon: '📄', value: 'dup' },
      { label: 'Elimina', icon: '🗑️', value: 'del', danger: true }
    ]);

    if (choice === 'edit') return openEditor('task', t.id, () => ctx.refresh());
    if (choice === 'doing') { await save('tasks', { id: t.id, status: 'doing' }); toast('In corso'); return ctx.refresh(); }
    if (choice === 'nodue') { await save('tasks', { id: t.id, due: null }); toast('Scadenza rimossa'); return ctx.refresh(); }
    if (choice === 'dup') { await import('../store.js').then((s) => s.duplicate('tasks', t.id)); toast('Duplicata'); return ctx.refresh(); }
    if (choice === 'del') {
      const ok = await confirmDialog({ title: 'Eliminare l\'attività?', message: `"${t.title}" verrà rimossa dal dispositivo.`, confirmText: 'Elimina', danger: true });
      if (ok) { await remove('tasks', t.id); toast('Eliminata'); ctx.refresh(); }
      return;
    }
    // posticipi
    const map = { p1: 1, p7: 7, p30: 30 };
    if (map[choice]) {
      const base = t.due ? new Date(t.due) : new Date();
      const shifted = addDays(base, map[choice]);
      await save('tasks', { id: t.id, due: shifted.toISOString(), status: t.status === 'done' ? 'todo' : t.status });
      toast(`Posticipata al ${fmtDate(shifted, 'medium')}`);
      ctx.refresh();
    }
  });

  attachSwipe(root, '[data-task]', {
    right: async (el) => {
      const t = byId('tasks', el.dataset.task); if (!t) return;
      const done = t.status !== 'done';
      await save('tasks', { id: t.id, status: done ? 'done' : 'todo', completedAt: done ? new Date().toISOString() : null });
      toast(done ? 'Completata 🎉' : 'Riaperta'); ctx.refresh();
    },
    left: async (el) => {
      const t = byId('tasks', el.dataset.task); if (!t) return;
      const base = t.due ? new Date(t.due) : new Date();
      const shifted = addDays(base, 1);
      await save('tasks', { id: t.id, due: shifted.toISOString() });
      toast(`Posticipata a ${relDay(shifted)}`); ctx.refresh();
    }
  });
}

function defaultDue() {
  const d = new Date();
  d.setHours(Math.min(23, new Date().getHours() + 3), 0, 0, 0);
  return d.toISOString();
}

function persistFilters() {
  setSetting('taskView', filter).catch(() => {});
}

/** Gesti tattili: swipe a destra = completa, a sinistra = posticipa. */
export function attachSwipe(root, selector, { right, left, threshold = 72 } = {}) {
  let startX = 0, startY = 0, el = null, dx = 0, dy = 0, tracking = false;

  root.addEventListener('touchstart', (e) => {
    const t = e.target.closest(selector);
    if (!t || e.target.closest('button') && !e.target.closest('[data-task]') === false && e.target.closest('.check')) return;
    el = t; startX = e.touches[0].clientX; startY = e.touches[0].clientY;
    dx = 0; dy = 0; tracking = true;
    el.style.transition = 'none';
  }, { passive: true });

  root.addEventListener('touchmove', (e) => {
    if (!tracking || !el) return;
    dx = e.touches[0].clientX - startX;
    dy = e.touches[0].clientY - startY;
    if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 12) { // scroll verticale: annulla
      el.style.transform = ''; tracking = false; el.style.transition = ''; return;
    }
    el.style.transform = `translateX(${clamp(dx, -110, 110)}px)`;
  }, { passive: true });

  root.addEventListener('touchend', () => {
    if (!tracking || !el) return;
    const node = el;
    node.style.transition = 'transform 200ms cubic-bezier(.4,0,.2,1)';
    node.style.transform = '';
    if (Math.abs(dy) < 48) {
      if (dx > threshold && right) right(node);
      else if (dx < -threshold && left) left(node);
    }
    tracking = false; el = null; dx = 0; dy = 0;
  }, { passive: true });
}
