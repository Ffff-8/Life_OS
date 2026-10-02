/* ==========================================================================
   LifeOS — views/calendar.js
   Calendario mensile con griglia tattile, elenco eventi del giorno,
   navigazione tra i mesi e creazione rapida di eventi.
   ========================================================================== */

import { eventsOnDay, eventsBetween, byId, categoryById, save, list, remove } from '../store.js';
import {
  esc, fmtDate, monthMatrix, DOW_IT, dayKey, dateFromDayKey, addDays, addMinutes,
  startOfDay, endOfDay, minToLabel, isToday, isSameDay, humanWhen, capitalize
} from '../utils.js';
import { qs, onClick, emptyState, toast, confirmDialog, actionSheet, priorityBadge } from '../ui.js';
import { openEditor } from '../editors.js';
import { occurrencesBetween, recurrenceLabel, nextOccurrence } from '../recur.js';

let viewMonth = null; // Date al primo giorno del mese mostrato
let selectedDay = null;

export function render({ params }) {
  const now = new Date();
  if (params.d) {
    const d = dateFromDayKey(params.d);
    if (!isNaN(d)) { selectedDay = d; if (!viewMonth || new Date(viewMonth).getMonth() !== d.getMonth()) viewMonth = new Date(d.getFullYear(), d.getMonth(), 1); }
  }
  if (!viewMonth) viewMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  if (!selectedDay) selectedDay = startOfDay(now);

  const monthLabel = capitalize(fmtDate(viewMonth, 'month'));
  const weeks = monthMatrix(viewMonth.getFullYear(), viewMonth.getMonth());
  const monthStart = new Date(viewMonth.getFullYear(), viewMonth.getMonth(), 1);
  const monthEnd = endOfDay(new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 0));

  // mappa giorno -> numero di eventi (incluse le ricorrenze)
  const counts = new Map();
  list('events').forEach((e) => {
    if (e.recurrence?.freq && e.recurrence.freq !== 'none') {
      occurrencesBetween(e, monthStart, monthEnd).forEach((o) => {
        counts.set(o.key, (counts.get(o.key) || 0) + 1);
      });
    } else {
      const k = dayKey(new Date(e.start));
      counts.set(k, (counts.get(k) || 0) + 1);
    }
  });

  const dayEvents = eventsForDay(selectedDay);
  const body = weeks.map((week) => week.map((d) => {
    const k = dayKey(d);
    const outside = d.getMonth() !== viewMonth.getMonth();
    const sel = isSameDay(d, selectedDay);
    const n = counts.get(k) || 0;
    return `<button class="cal-day ${outside ? 'out' : ''} ${isToday(d) ? 'today' : ''} ${sel ? 'sel' : ''}" data-day="${k}">
      <span>${d.getDate()}</span>
      ${n ? `<span class="dots">${'<i></i>'.repeat(Math.min(n, 3))}</span>` : ''}
    </button>`;
  }).join('')).join('');

  const html = `
    <div class="cal-head">
      <button class="icon-btn" data-nav="prev" aria-label="Mese precedente">‹</button>
      <button class="btn sm" data-nav="today">${esc(monthLabel)}</button>
      <button class="icon-btn" data-nav="next" aria-label="Mese successivo">›</button>
    </div>

    <div class="cal-grid" style="margin-bottom:4px">
      ${DOW_IT.map((d) => `<div class="cal-dow">${d}</div>`).join('')}
    </div>
    <div class="cal-grid">${body}</div>

    <div class="btn-row" style="margin-top:14px">
      <button class="btn primary" data-new-event style="flex:1">➕ Nuovo evento</button>
      <button class="btn" data-jump-today style="flex:0 0 auto">Oggi</button>
    </div>

    <section class="section">
      <div class="section-head">
        <div class="h3">📅 ${esc(capitalize(fmtDate(selectedDay, 'full')))} <span class="count">${dayEvents.length}</span></div>
      </div>
      ${dayEvents.length ? dayEvents.map(eventCard).join('') : emptyState('🗓️', 'Nessun evento in questo giorno', 'Tocca "Nuovo evento" per aggiungerne uno.')}
    </section>

    ${upcomingSection()}
  `;

  return {
    title: 'Calendario', sub: monthLabel,
    html,
    mount: (ctx) => bind(ctx)
  };
}

/* ------------------------ eventi del giorno ----------------------------- */
function eventsForDay(day) {
  const out = [];
  const t0 = startOfDay(day); const t1 = endOfDay(day);
  list('events').forEach((e) => {
    if (e.recurrence?.freq && e.recurrence.freq !== 'none') {
      occurrencesBetween(e, t0, t1).forEach((o) => out.push({ ...e, __occ: o }));
    } else {
      const s = new Date(e.start);
      const en = new Date(e.end || addMinutes(s, Number(e.durationMin) || 60));
      if ((s >= t0 && s <= t1) || (s <= t0 && en >= t0)) out.push({ ...e, __occ: { start: s, end: en } });
    }
  });
  return out.sort((a, b) => a.__occ.start - b.__occ.start);
}

function eventCard(e) {
  const cat = categoryById(e.categoryId);
  const start = e.__occ?.start || new Date(e.start);
  const end = e.__occ?.end || addMinutes(start, Number(e.durationMin) || 60);
  const past = end < new Date();
  return `<div class="card tap" data-event="${esc(e.id)}" style="${past ? 'opacity:.6' : ''}">
    <div style="display:flex;gap:10px;align-items:flex-start">
      <span style="width:5px;align-self:stretch;border-radius:4px;background:${cat ? esc(cat.color) : 'var(--accent)'}"></span>
      <div style="flex:1;min-width:0">
        <div class="row-title">${esc(e.title)}</div>
        <div class="row-sub" style="margin-top:4px">
          <span>🕒 ${esc(fmtDate(start, 'time'))} – ${esc(fmtDate(end, 'time'))}</span>
          <span>⏱️ ${esc(minToLabel(Number(e.durationMin) || Math.round((end - start) / 60000)))}</span>
          ${e.location ? `<span>📍 ${esc(e.location)}</span>` : ''}
          ${cat ? `<span>${cat.icon} ${esc(cat.name)}</span>` : ''}
        </div>
        <div class="row-sub" style="margin-top:6px">
          ${priorityBadge(e.priority)}
          ${recurrenceLabel(e.recurrence) ? `<span class="badge">🔁 ${esc(recurrenceLabel(e.recurrence))}</span>` : ''}
          ${(e.reminders || []).length ? `<span class="badge">🔔 ${(e.reminders || []).length} promemoria</span>` : '<span class="badge">🔕 nessun promemoria</span>'}
        </div>
        ${e.description ? `<p class="muted" style="margin-top:8px;font-size:13.5px">${esc(e.description)}</p>` : ''}
        ${e.notes ? `<p class="dim" style="margin-top:6px">📌 ${esc(e.notes)}</p>` : ''}
      </div>
      <button class="icon-btn" data-menu="${esc(e.id)}" aria-label="Azioni">⋯</button>
    </div>
  </div>`;
}

function upcomingSection() {
  const from = new Date();
  const to = addDays(from, 60);
  const upcoming = [];
  list('events').forEach((e) => {
    if (e.recurrence?.freq && e.recurrence.freq !== 'none') {
      occurrencesBetween(e, from, to).slice(0, 3).forEach((o) => upcoming.push({ ...e, __when: o.start }));
    } else {
      const s = new Date(e.start);
      if (s >= startOfDay(from) && s <= to) upcoming.push({ ...e, __when: s });
    }
  });
  upcoming.sort((a, b) => a.__when - b.__when);
  const top = upcoming.slice(0, 5);
  if (!top.length) return '';
  return `<section class="section">
    <div class="section-head"><div class="h3">⏭️ Prossimi appuntamenti</div></div>
    ${top.map((e) => `<div class="row" data-event="${esc(e.id)}">
      <div class="row-body">
        <div class="row-title" style="font-size:14.5px">${esc(e.title)}</div>
        <div class="row-sub">
          <span>${esc(humanWhen(e.__when))}</span>
          <span>${esc(fmtDate(e.__when, 'datetime'))}</span>
        </div>
      </div>
    </div>`).join('')}
  </section>`;
}

/* ------------------------------ binding --------------------------------- */
function bind(ctx) {
  const root = ctx.root;

  onClick(root, '[data-nav]', (el) => {
    const dir = el.dataset.nav;
    if (dir === 'prev') viewMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth() - 1, 1);
    if (dir === 'next') viewMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 1);
    if (dir === 'today') { viewMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1); selectedDay = startOfDay(new Date()); }
    ctx.refresh();
  });

  onClick(root, '[data-day]', (el) => {
    selectedDay = dateFromDayKey(el.dataset.day);
    viewMonth = new Date(selectedDay.getFullYear(), selectedDay.getMonth(), 1);
    ctx.refresh();
  });

  onClick(root, '[data-jump-today]', () => {
    selectedDay = startOfDay(new Date());
    viewMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    ctx.refresh();
  });

  onClick(root, '[data-new-event]', () => {
    const day = selectedDay || new Date();
    const start = new Date(day);
    start.setHours(9, 0, 0, 0);
    if (!isSameDay(day, new Date()) || start < new Date()) start.setTime(Math.max(start.getTime(), Date.now() + 3600000));
    openEditor('event', null, () => ctx.refresh(), {
      start: start.toISOString(),
      durationMin: 60,
      reminders: [1440, 120, 30]
    });
  });

  onClick(root, '[data-event]', (el, e) => {
    if (e.target.closest('[data-menu]')) return;
    openEditor('event', el.dataset.event, () => ctx.refresh());
  });

  onClick(root, '[data-menu]', async (el, e) => {
    e.stopPropagation();
    const id = el.dataset.menu;
    const ev = byId('events', id);
    if (!ev) return;
    const choice = await actionSheet(ev.title, [
      { label: 'Modifica', icon: '✏️', value: 'edit' },
      { label: 'Duplica', icon: '📄', value: 'dup' },
      { label: 'Sposta a domani', icon: '➡️', value: 'tomorrow' },
      { label: 'Sposta a +1 settimana', icon: '⏭️', value: 'week' },
      { label: 'Elimina', icon: '🗑️', value: 'del', danger: true }
    ]);
    if (choice === 'edit') openEditor('event', id, () => ctx.refresh());
    if (choice === 'dup') {
      const copyV = { ...ev, id: undefined, title: `${ev.title} (copia)` };
      await save('events', copyV);
      toast('Evento duplicato'); ctx.refresh();
    }
    if (choice === 'tomorrow' || choice === 'week') {
      const shift = choice === 'tomorrow' ? 1 : 7;
      const s = addDays(new Date(ev.start), shift);
      await save('events', { id: ev.id, start: s.toISOString(), end: addMinutes(s, Number(ev.durationMin) || 60).toISOString() });
      toast('Evento spostato');
      ctx.refresh();
    }
    if (choice === 'del') {
      const ok = await confirmDialog({ title: 'Eliminare l\'evento?', message: `"${ev.title}" verrà rimosso insieme ai suoi promemoria.`, confirmText: 'Elimina', danger: true });
      if (ok) { await remove('events', id); toast('Evento eliminato'); ctx.refresh(); }
    }
  });
}
