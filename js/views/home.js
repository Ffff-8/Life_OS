/* ==========================================================================
   LifeOS — views/home.js
   Dashboard: saluto, data, attività di oggi, eventi, promemoria, obiettivi,
   note e idee recenti, percentuale di completamento della giornata.
   ========================================================================== */

import {
  dayStats, upcomingEvents, notesRecent, ideasRecent, goalsActive,
  categoryById, categoryStyle, pendingReminders, effectiveStatus, init
} from '../store.js';
import {
  esc, fmtDate, relDay, relTime, humanWhen, minToLabel, offsetLabel,
  pct, capitalize, clamp
} from '../utils.js';
import { qs, onClick, priorityBadge, statusBadge, emptyState, section, toast, sheet } from '../ui.js';
import { suggestions } from '../search.js';
import { openEditor } from '../editors.js';
import { parseHash } from '../router.js';
import { nextOccurrence } from '../recur.js';
import { startEngine } from '../reminders.js';

export function render({ params }) {
  const s = dayStats();
  const now = new Date();
  const hour = now.getHours();
  const greet = hour < 6 ? 'Buonanotte' : hour < 13 ? 'Buongiorno' : hour < 18 ? 'Buon pomeriggio' : 'Buonasera';

  const upcoming = upcomingEvents(4);
  const goals = goalsActive().slice(0, 3);
  const notes = notesRecent(3);
  const ideas = ideasRecent(3);
  const reminders = pendingReminders(new Date()).slice(0, 4);
  const sugg = suggestions();

  const html = `
    <section class="hero">
      <div class="hero-greet">${esc(greet)} 👋</div>
      <div class="hero-date">Oggi — ${esc(fmtDate(now, 'long'))}</div>
      <div class="hero-stats">
        <span>🔴 ${s.urgent.length} urgenti</span>
        <span>🟡 ${s.normal.length} normali</span>
        <span>📅 ${s.events.length} ${s.events.length === 1 ? 'evento' : 'eventi'}</span>
        <span>✅ ${s.dueToday.length} per oggi</span>
        ${s.overdue.length ? `<span>⏰ ${s.overdue.length} scadute</span>` : ''}
        <span>💡 ${s.newIdeas.length} nuove idee</span>
      </div>
      <div class="progress-wrap">
        <div class="progress-top">
          <span>Completamento giornata</span>
          <span>${s.progress}%</span>
        </div>
        <div class="progress-bar"><i style="width:${clamp(s.progress, 0, 100)}%"></i></div>
      </div>
    </section>

    <div class="quick-grid">
      <button class="quick" data-new="event"><span class="q-ico">📅</span>Evento</button>
      <button class="quick" data-new="task"><span class="q-ico">✅</span>Attività</button>
      <button class="quick" data-new="note"><span class="q-ico">📝</span>Nota</button>
      <button class="quick" data-new="idea"><span class="q-ico">💡</span>Idea</button>
    </div>

    <div class="card accent" style="margin-top:14px;display:flex;align-items:center;gap:12px" data-action="voice">
      <span style="font-size:30px">🎙️</span>
      <div style="flex:1">
        <div style="font-weight:750;font-size:15.5px">Parla con LifeOS</div>
        <div class="dim">Dettà un pensiero: capisco cosa farne</div>
      </div>
      <span style="font-size:20px">›</span>
    </div>

    ${s.overdue.length ? section('⏰ Attività scadute', s.overdue.length, s.overdue.slice(0, 3).map(taskRow).join(''), `<button class="link-btn" data-nav="tasks?filter=expired">Tutte ›</button>`) : ''}

    ${section('✅ Oggi', s.dueToday.length || null,
      s.dueToday.length ? s.dueToday.map(taskRow).join('')
        : emptyState('🌤️', 'Nessuna attività per oggi', 'Goditi la giornata o pianifica qualcosa di nuovo.'),
      `<button class="link-btn" data-nav="tasks">Tutte ›</button>`)}

    ${uptoEvts(upcoming)}

    ${reminders.length ? section('🔔 Promemoria imminenti', reminders.length, reminders.map(reminderRow).join(''), `<button class="link-btn" data-nav="reminders">Tutti ›</button>`) : ''}

    ${goals.length ? section('🎯 Obiettivi attivi', goals.length, goals.map(goalRow).join(''), `<button class="link-btn" data-nav="goals">Tutti ›</button>`) : ''}

    ${notes.length ? section('📝 Note recenti', notes.length, notes.map(noteRow).join(''), `<button class="link-btn" data-nav="notes">Tutte ›</button>`) : ''}

    ${ideas.length ? section('💡 Idee recenti', ideas.length, ideas.map(ideaRow).join(''), `<button class="link-btn" data-nav="ideas">Tutte ›</button>`) : ''}

    ${sugg.length ? section('✨ Suggerimenti', null, sugg.map((x) => `
      <div class="row" data-nav="${esc(x.route)}" style="align-items:center">
        <div class="row-body"><div class="row-title" style="font-weight:600;font-size:14.5px">${esc(x.icon)} ${esc(x.text)}</div></div>
        <div class="row-right"><span class="dim">›</span></div>
      </div>`).join('')) : ''}

    <p class="dim" style="text-align:center;margin:26px 0 10px">
      LifeOS · dati solo sul tuo dispositivo · ${fmtDate(now, 'medium')}
    </p>
  `;

  return {
    title: getSettingName(), sub: fmtDate(now, 'day'),
    html,
    mount: (ctx) => bind(ctx, s)
  };
}

function getSettingName() {
  try {
    const raw = localStorage.getItem('lifeos_name');
    return raw ? `Ciao, ${raw}` : 'LifeOS';
  } catch (e) { return 'LifeOS'; }
}

function uptoEvts(list) {
  if (!list.length) {
    return section('📅 Prossimi eventi', null,
      emptyState('📭', 'Nessun evento in programma', 'Aggiungi un evento per vederlo qui e ricevere i promemoria.'));
  }
  return section('📅 Prossimi eventi', list.length, list.map(eventRow).join(''), `<button class="link-btn" data-nav="calendar">Calendario ›</button>`);
}

/* ------------------------------ RIGHE ----------------------------------- */
function taskRow(t) {
  const st = effectiveStatus(t);
  const cat = categoryById(t.categoryId);
  const overdue = st === 'expired';
  const checklist = t.checklist || [];
  const doneChecks = checklist.filter((c) => c.done).length;
  return `<div class="row ${overdue ? 'overdue' : ''} ${t.status === 'done' ? 'done' : ''}" data-task="${t.id}">
    <button class="check ${t.status === 'done' ? 'on' : ''}" data-toggle="${t.id}" aria-label="Completa attività">✓</button>
    <span class="row-bar" style="background:${cat ? esc(cat.color) : 'var(--text-3)'}"></span>
    <div class="row-body">
      <div class="row-title">${esc(t.title)}</div>
      <div class="row-sub">
        ${priorityBadge(t.priority)}
        ${st !== 'todo' ? statusBadge(st) : ''}
        ${t.due ? `<span>🕒 ${esc(humanWhen(t.due))}</span>` : ''}
        ${cat ? `<span>${cat.icon} ${esc(cat.name)}</span>` : ''}
        ${checklist.length ? `<span>☑ ${doneChecks}/${checklist.length}</span>` : ''}
        ${t.estimateMin ? `<span>⏳ ${esc(minToLabel(t.estimateMin))}</span>` : ''}
      </div>
    </div>
    <div class="row-right"><span class="dim" data-menu="${t.id}">⋯</span></div>
  </div>`;
}

function eventRow(e) {
  const cat = categoryById(e.categoryId);
  const occ = e.recurrence?.freq && e.recurrence.freq !== 'none' ? nextOccurrence(e) : null;
  const when = occ ? occ.start : new Date(e.start);
  return `<div class="row" data-event="${e.id}">
    <span class="row-bar" style="background:${cat ? esc(cat.color) : 'var(--accent)'}"></span>
    <div class="row-body">
      <div class="row-title">${esc(e.title)}</div>
      <div class="row-sub">
        <span>📅 ${esc(relDay(when))} · ${esc(fmtDate(when, 'time'))}</span>
        ${e.durationMin ? `<span>⏱️ ${esc(minToLabel(e.durationMin))}</span>` : ''}
        ${e.location ? `<span>📍 ${esc(e.location)}</span>` : ''}
        ${occ ? '<span>🔁 ricorrente</span>' : ''}
        ${cat ? `<span>${cat.icon} ${esc(cat.name)}</span>` : ''}
      </div>
    </div>
    <div class="row-right"><span class="dim" data-menu="${e.id}">⋯</span></div>
  </div>`;
}

function reminderRow(r) {
  return `<div class="row" style="align-items:center">
    <div class="row-body">
      <div class="row-title" style="font-size:14.5px">${esc(r.title || 'Promemoria')}</div>
      <div class="row-sub">
        <span>🔔 ${esc(offsetLabel(r.offsetMin))}</span>
        <span>${esc(fmtDate(r.at, 'datetime'))}</span>
      </div>
    </div>
    <div class="row-right"><span class="dim">${esc(relTime(r.at))}</span></div>
  </div>`;
}

function goalRow(g) {
  const p = clamp(Number(g.progress) || 0, 0, 100);
  const subs = g.subtasks || [];
  const doneSubs = subs.filter((x) => x.done).length;
  return `<div class="card tap" data-goal="${g.id}">
    <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start">
      <div style="flex:1">
        <div class="row-title">${esc(g.name)}</div>
        ${g.due ? `<div class="dim" style="margin-top:2px">Scadenza ${esc(fmtDate(g.due, 'medium'))}</div>` : ''}
      </div>
      <span class="badge ${p >= 100 ? 'done' : 'doing'}">${p}%</span>
    </div>
    <div class="progress-line" style="margin-top:10px"><i style="width:${p}%"></i></div>
    ${subs.length ? `<div class="dim" style="margin-top:7px">☑ ${doneSubs}/${subs.length} sotto-attività</div>` : ''}
  </div>`;
}

function noteRow(n) {
  return `<div class="row" data-note="${n.id}">
    <span class="row-bar" style="background:var(--info)"></span>
    <div class="row-body">
      <div class="row-title">${esc(n.title || 'Senza titolo')} ${n.favorite ? '⭐' : ''}</div>
      <div class="row-sub">
        <span>${esc(relTime(n.updatedAt || n.createdAt))}</span>
        ${(n.tags || []).length ? `<span>${(n.tags || []).slice(0, 3).map((t) => `#${esc(t)}`).join(' ')}</span>` : ''}
      </div>
    </div>
    <div class="row-right"><span class="dim" data-menu="${n.id}">⋯</span></div>
  </div>`;
}

function ideaRow(i) {
  const stars = Math.round(Number(i.importance) || 0);
  return `<div class="row" data-idea="${i.id}">
    <span class="row-bar" style="background:var(--warn)"></span>
    <div class="row-body">
      <div class="row-title">${esc(i.title || 'Idea')}</div>
      <div class="row-sub">
        <span>${'★'.repeat(stars)}${'☆'.repeat(5 - stars)}</span>
        <span>${esc(i.status || 'idea')}</span>
        ${i.categoryId ? `<span>${esc(categoryStyle(i.categoryId).icon)}</span>` : ''}
      </div>
    </div>
    <div class="row-right"><span class="dim" data-menu="${i.id}">⋯</span></div>
  </div>`;
}

/* ------------------------------ EVENTI UI ------------------------------- */
function bind(ctx, stats) {
  const root = ctx.root;

  onClick(root, '[data-nav]', (el) => { location.hash = '#/' + el.dataset.nav; });
  onClick(root, '[data-new]', (el) => openEditor(el.dataset.new, null, () => ctx.refresh()));
  onClick(root, '[data-action="voice"]', () => { location.hash = '#/voice'; });

  // completare un'attività direttamente dalla Home
  onClick(root, '[data-toggle]', async (el, e) => {
    e.stopPropagation();
    const { byId, save } = await import('../store.js');
    const t = byId('tasks', el.dataset.toggle);
    if (!t) return;
    const done = t.status !== 'done';
    await save('tasks', { id: t.id, status: done ? 'done' : 'todo', completedAt: done ? new Date().toISOString() : null });
    toast(done ? 'Attività completata 🎉' : 'Attività riaperta');
    ctx.refresh();
  });

  // apri editor al tap sulla riga
  onClick(root, '[data-task]', (el, e) => {
    if (e.target.closest('[data-toggle]') || e.target.closest('[data-menu]')) return;
    openEditor('task', el.dataset.task, () => ctx.refresh());
  });
  onClick(root, '[data-event]', (el, e) => {
    if (e.target.closest('[data-menu]')) return;
    openEditor('event', el.dataset.event, () => ctx.refresh());
  });
  onClick(root, '[data-note]', (el, e) => {
    if (e.target.closest('[data-menu]')) return;
    openEditor('note', el.dataset.note, () => ctx.refresh());
  });
  onClick(root, '[data-idea]', (el, e) => {
    if (e.target.closest('[data-menu]')) return;
    openEditor('idea', el.dataset.idea, () => ctx.refresh());
  });
  onClick(root, '[data-goal]', (el) => openEditor('goal', el.dataset.goal, () => ctx.refresh()));

  // menu contestuale
  onClick(root, '[data-menu]', async (el, e) => {
    e.stopPropagation();
    const id = el.dataset.menu;
    const { actionSheet, confirmDialog } = await import('../ui.js');
    const store = await import('../store.js');
    const item = store.byId('tasks', id) || store.byId('events', id) || store.byId('notes', id) || store.byId('ideas', id);
    if (!item) return;
    const type = store.byId('tasks', id) ? 'task' : store.byId('events', id) ? 'event' : store.byId('notes', id) ? 'note' : 'idea';
    const choice = await actionSheet('Azioni', [
      { label: 'Modifica', icon: '✏️', value: 'edit' },
      { label: 'Duplica', icon: '📄', value: 'dup' },
      { label: 'Elimina', icon: '🗑️', value: 'del', danger: true }
    ]);
    if (choice === 'edit') openEditor(type, id, () => ctx.refresh());
    if (choice === 'dup') { await store.duplicate(type === 'task' ? 'tasks' : type === 'event' ? 'events' : type === 'note' ? 'notes' : 'ideas', id); toast('Elemento duplicato'); ctx.refresh(); }
    if (choice === 'del') {
      const ok = await confirmDialog({ title: 'Eliminare?', message: `"${item.title || item.name}" verrà rimosso definitivamente.`, confirmText: 'Elimina', danger: true });
      if (ok) {
        await store.remove(type === 'task' ? 'tasks' : type === 'event' ? 'events' : type === 'note' ? 'notes' : 'ideas', id);
        toast('Elemento eliminato');
        ctx.refresh();
      }
    }
  });

  // Il nome si imposta da Altro → Impostazioni (nessun prompt automatico
  // invasivo al primo avvio).
}

async function maybeAskName() {
  try {
    if (localStorage.getItem('lifeos_name_asked') === '1') return;
    localStorage.setItem('lifeos_name_asked', '1');
    const { promptDialog } = await import('../ui.js');
    const name = await promptDialog({ title: 'Come ti chiami?', label: 'Nome (facoltativo)', placeholder: 'es. Marco' });
    if (name) {
      localStorage.setItem('lifeos_name', name);
      const { setSetting } = await import('../store.js');
      await setSetting('displayName', name);
      location.reload();
    }
  } catch (e) { /* noop */ }
}
