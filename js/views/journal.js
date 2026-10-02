/* ==========================================================================
   LifeOS — views/journal.js
   Diario / pensieri: una voce per giorno (o più), con umore, tag e voce.
   ========================================================================== */

import { list, byId, save, remove } from '../store.js';
import { esc, fmtDate, dayKey, relTime, norm } from '../utils.js';
import { qs, onClick, emptyState, toast, actionSheet, confirmDialog, starsReadonly } from '../ui.js';
import { openEditor } from '../editors.js';
import { attachMics } from '../voice.js';

let query = '';
let onlyToday = false;

export function render() {
  const all = list('journal');
  const items = applyFilter(all);

  // statistiche di umore
  const withMood = all.filter((j) => Number(j.mood) > 0);
  const avgMood = withMood.length ? (withMood.reduce((a, j) => a + Number(j.mood), 0) / withMood.length) : 0;

  const grouped = new Map();
  items.forEach((j) => {
    const k = j.date || dayKey(new Date(j.createdAt));
    if (!grouped.has(k)) grouped.set(k, []);
    grouped.get(k).push(j);
  });
  const keys = [...grouped.keys()].sort((a, b) => String(b).localeCompare(String(a)));

  const html = `
    <div class="page-head">
      <div class="h1">Diario</div>
      <div class="muted">${all.length} ${all.length === 1 ? 'pensiero' : 'pensieri'} · umore medio ${avgMood ? avgMood.toFixed(1) + '/5' : '—'}</div>
    </div>

    <div class="card accent" style="display:flex;gap:12px;align-items:center" data-write>
      <span style="font-size:28px">📖</span>
      <div style="flex:1">
        <div style="font-weight:750">Scrivi un pensiero</div>
        <div class="dim">Anche solo una riga: tra un mese ti farà piacere rileggerla.</div>
      </div>
      <span style="font-size:20px">›</span>
    </div>

    <div class="field" style="margin-top:14px">
      <div class="input-voice">
        <input class="input" id="jr-q" value="${esc(query)}" placeholder="Cerca nei pensieri…" />
        <button class="mic-btn" data-mic="jr-q" aria-label="Cerca con la voce">🎤</button>
      </div>
    </div>

    <div class="filter-bar">
      <div class="chips">
        <button class="chip ${!onlyToday ? 'on' : ''}" data-today="0">Tutti</button>
        <button class="chip ${onlyToday ? 'on' : ''}" data-today="1">Solo oggi</button>
      </div>
    </div>

    <div class="btn-row" style="margin:4px 0 12px">
      <button class="btn sm primary" data-new>➕ Nuovo pensiero</button>
      <button class="btn sm" data-voice>🎙️ Dettà</button>
    </div>

    ${items.length ? keys.map((k) => {
      const list_ = grouped.get(k);
      return `<section class="section">
        <div class="section-head"><div class="h3">${esc(fmtDate(k, 'full'))} <span class="count">${list_.length}</span></div></div>
        ${list_.map(journalCard).join('')}
      </section>`;
    }).join('') : emptyState('📖', 'Nessun pensiero ancora', 'Il diario è privato e resta sul tuo dispositivo: nessuno lo legge, nessun server lo riceve.')}
  `;

  return { title: 'Diario', sub: `${items.length} voci`, html, mount: (ctx) => bind(ctx) };
}

function applyFilter(all) {
  let items = [...all];
  if (onlyToday) items = items.filter((j) => (j.date || '') === dayKey(new Date()));
  if (query.trim()) {
    const q = norm(query);
    items = items.filter((j) => norm(`${j.text} ${(j.tags || []).join(' ')}`).includes(q));
  }
  return items.sort((a, b) => new Date(b.time || b.createdAt) - new Date(a.time || a.createdAt));
}

function journalCard(j) {
  const mood = Math.round(Number(j.mood) || 0);
  return `<div class="card tap" data-jr="${esc(j.id)}">
    <div style="display:flex;gap:10px;align-items:flex-start">
      <div style="flex:1;min-width:0">
        <div class="row-sub">
          <span>🕒 ${esc(j.time ? fmtDate(j.time, 'time') : relTime(j.createdAt))}</span>
          ${mood ? `<span style="color:#f5a524">${starsReadonly(mood)}</span>` : ''}
        </div>
      </div>
      <button class="icon-btn" data-menu="${esc(j.id)}" aria-label="Azioni">⋯</button>
    </div>
    <p style="margin-top:9px;font-size:14.5px;line-height:1.6;white-space:pre-wrap">${esc(j.text)}</p>
    ${(j.tags || []).length ? `<div class="chips" style="margin-top:9px">${(j.tags || []).map((t) => `<span class="tag">#${esc(t)}</span>`).join('')}</div>` : ''}
  </div>`;
}

function bind(ctx) {
  const root = ctx.root;
  attachMics(root);

  let tmr = null;
  qs('#jr-q', root)?.addEventListener('input', (e) => { query = e.target.value; clearTimeout(tmr); tmr = setTimeout(() => ctx.refresh(), 420); });

  onClick(root, '[data-today]', (el) => { onlyToday = el.dataset.today === '1'; ctx.refresh(); });

  const newEntry = () => openEditor('journal', null, () => ctx.refresh(), { date: dayKey(new Date()), mood: 3 });
  onClick(root, '[data-new]', newEntry);
  onClick(root, '[data-write]', newEntry);
  onClick(root, '[data-voice]', () => { location.hash = '#/voice?target=journal'; });

  onClick(root, '[data-jr]', (el, e) => {
    if (e.target.closest('[data-menu]')) return;
    openEditor('journal', el.dataset.jr, () => ctx.refresh());
  });

  onClick(root, '[data-menu]', async (el, e) => {
    e.stopPropagation();
    const j = byId('journal', el.dataset.menu);
    if (!j) return;
    const choice = await actionSheet('Voce del diario', [
      { label: 'Modifica', icon: '✏️', value: 'edit' },
      { label: 'Copia testo', icon: '📋', value: 'copy' },
      { label: 'Trasforma in idea', icon: '💡', value: 'idea' },
      { label: 'Elimina', icon: '🗑️', value: 'del', danger: true }
    ]);
    if (choice === 'edit') return openEditor('journal', j.id, () => ctx.refresh());
    if (choice === 'copy') {
      const { copyText } = await import('../utils.js');
      const ok = await copyText(j.text); toast(ok ? 'Copiato' : 'Copia non disponibile'); return;
    }
    if (choice === 'idea') {
      await openEditor('idea', null, () => ctx.refresh(), { title: String(j.text).slice(0, 50), description: j.text, categoryId: '' });
      return;
    }
    if (choice === 'del') {
      const ok = await confirmDialog({ title: 'Eliminare il pensiero?', message: 'La voce verrà rimossa dal diario.', confirmText: 'Elimina', danger: true });
      if (ok) { await remove('journal', j.id); toast('Eliminato'); ctx.refresh(); }
    }
  });
}
