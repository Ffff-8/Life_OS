/* ==========================================================================
   LifeOS — views/inbox.js
   Inbox: raccolta veloce di pensieri, poi smistamento in idea / nota /
   attività / evento / diario.
   ========================================================================== */

import { list, byId, save, remove, init } from '../store.js';
import { esc, relTime, titleFrom, nowISO, dayKey } from '../utils.js';
import { qs, onClick, emptyState, toast, actionSheet, confirmDialog, sheet, node } from '../ui.js';
import { openEditor } from '../editors.js';
import { attachMics, dictation, speechStatus } from '../voice.js';
import { analyze } from '../ai/parser.js';

let showProcessed = false;

export function render() {
  const all = list('inbox').filter((i) => (showProcessed ? i.processed : !i.processed));
  const pending = list('inbox').filter((i) => !i.processed);

  const html = `
    <div class="page-head">
      <div class="h1">Inbox</div>
      <div class="muted">${pending.length} ${pending.length === 1 ? 'elemento da smistare' : 'elementi da smistare'}${showProcessed ? ' · vista archivio' : ''}</div>
    </div>

    <div class="card" style="border:1.5px dashed var(--border-strong);background:var(--card-2)">
      <div class="input-voice">
        <textarea class="textarea" id="inbox-text" placeholder="Scrivi o detta quello che ti passa in testa…" style="min-height:92px"></textarea>
        <button class="mic-btn" data-mic="inbox-text" aria-label="Dettà un pensiero">🎤</button>
      </div>
      <div class="btn-row" style="margin-top:10px">
        <button class="btn primary sm" data-save>📥 Salva in Inbox</button>
        <button class="btn sm" data-analyze>✨ Analizza e proponi</button>
      </div>
      <p class="mic-hint">L'Inbox serve a non decidere subito: catturi e smisti dopo.</p>
    </div>

    <div class="filter-bar">
      <div class="chips">
        <button class="chip ${!showProcessed ? 'on' : ''}" data-view="pending">📥 Da smistare ${pending.length ? `(${pending.length})` : ''}</button>
        <button class="chip ${showProcessed ? 'on' : ''}" data-view="done">✅ Smistati</button>
      </div>
    </div>

    ${all.length ? all.map(inboxCard).join('') : emptyState('📥', showProcessed ? 'Nessun elemento smistato' : 'Inbox vuota', showProcessed ? 'Qui finiscono gli elementi trasformati in note, attività, eventi o idee.' : 'Ottimo lavoro: non c\'è nulla da smistare.')}
  `;

  return { title: 'Inbox', sub: `${pending.length} da smistare`, html, mount: (ctx) => bind(ctx) };
}

function inboxCard(i) {
  return `<div class="card" data-inbox="${esc(i.id)}">
    <div style="display:flex;gap:10px">
      <div style="flex:1;min-width:0">
        <p style="font-size:15px;line-height:1.5;white-space:pre-wrap">${esc(i.text)}</p>
        <div class="row-sub" style="margin-top:7px">
          <span>${esc(relTime(i.createdAt))}</span>
          <span>${i.source === 'voice' ? '🎙️ voce' : '⌨️ testo'}</span>
          ${i.processed ? `<span>→ ${esc(i.convertedTo || 'convertito')}</span>` : ''}
        </div>
      </div>
      <button class="icon-btn" data-menu="${esc(i.id)}" aria-label="Azioni">⋯</button>
    </div>
    ${!i.processed ? `<div class="btn-row" style="margin-top:11px">
      <button class="btn xs" data-conv="idea" data-id="${esc(i.id)}">💡 Idea</button>
      <button class="btn xs" data-conv="note" data-id="${esc(i.id)}">📝 Nota</button>
      <button class="btn xs" data-conv="task" data-id="${esc(i.id)}">✅ Attività</button>
      <button class="btn xs" data-conv="event" data-id="${esc(i.id)}">📅 Evento</button>
      <button class="btn xs ghost" data-conv="journal" data-id="${esc(i.id)}">📖 Diario</button>
    </div>` : ''}
  </div>`;
}

function bind(ctx) {
  const root = ctx.root;
  attachMics(root);

  const ta = qs('#inbox-text', root);

  onClick(root, '[data-view]', (el) => { showProcessed = el.dataset.view === 'done'; ctx.refresh(); });

  onClick(root, '[data-save]', async () => {
    const text = (ta.value || '').trim();
    if (!text) { toast('Scrivi prima qualcosa'); ta.focus(); return; }
    await save('inbox', { text, processed: false, source: 'manual', createdAt: nowISO() });
    ta.value = '';
    toast('Salvato in Inbox 📥');
    ctx.refresh();
  });

  onClick(root, '[data-analyze]', async () => {
    const text = (ta.value || '').trim();
    if (!text) { toast('Scrivi prima qualcosa'); return; }
    const a = analyze(text, { categories: list('categories') });
    const body = node(`<div>
      <p class="muted">${esc(a.suggestion)}</p>
      <div class="divider"></div>
      <p class="dim">Titolo proposto</p>
      <p style="font-weight:700;margin-bottom:10px">${esc(a.title)}</p>
      <p class="dim">Rilevato</p>
      <ul style="font-size:13.5px;line-height:1.7">
        <li>Intento: <b>${esc(a.intent)}</b> (confidenza ${Math.round(a.confidence * 100)}%)</li>
        ${a.entities.when ? `<li>Quando: <b>${esc(new Date(a.entities.when).toLocaleString('it-IT'))}</b></li>` : ''}
        ${a.entities.durationMin ? `<li>Durata: <b>${a.entities.durationMin} min</b></li>` : ''}
        ${a.entities.priority ? `<li>Priorità: <b>${esc(a.entities.priority)}</b></li>` : ''}
        ${a.entities.categoryId ? `<li>Categoria: <b>${esc(list('categories').find((c) => c.id === a.entities.categoryId)?.name || '')}</b></li>` : ''}
        ${(a.entities.tags || []).length ? `<li>Tag: ${a.entities.tags.map((t) => '#' + esc(t)).join(' ')}</li>` : ''}
      </ul>
      <p class="mic-hint">Analisi locale a regole: nessun dato esce dal dispositivo.</p>
    </div>`);
    const foot = node(`<div class="btn-row" style="width:100%">
      <button class="btn" data-keep>Salva in Inbox</button>
      <button class="btn primary" data-go>Converti in ${esc(a.intent)}</button>
    </div>`);
    const s = sheet({ title: '✨ Analisi del pensiero', body, foot });
    onClick(foot, '[data-keep]', async () => { await save('inbox', { text, processed: false, source: 'manual' }); ta.value = ''; s.close(); ctx.refresh(); });
    onClick(foot, '[data-go]', async () => {
      s.close();
      const preset = {
        title: a.title,
        text: a.raw,
        description: a.raw,
        due: a.entities.when,
        start: a.entities.when,
        priority: a.entities.priority || 'normal',
        categoryId: a.entities.categoryId || '',
        tags: a.entities.tags || [],
        estimateMin: a.entities.durationMin,
        mood: 3
      };
      const type = a.intent === 'inbox' ? 'note' : a.intent;
      ta.value = '';
      await openEditor(type, null, () => ctx.refresh(), preset);
    });
  });

  onClick(root, '[data-conv]', async (el) => {
    const item = byId('inbox', el.dataset.id);
    if (!item) return;
    const type = el.dataset.conv;
    const a = analyze(item.text, { categories: list('categories') });
    const preset = {
      title: a.title, text: item.text, description: item.text,
      due: a.entities.when, start: a.entities.when,
      priority: a.entities.priority || 'normal',
      categoryId: a.entities.categoryId || '',
      tags: a.entities.tags || [],
      estimateMin: a.entities.durationMin,
      mood: 3,
      name: titleFrom(item.text, 60)
    };
    await openEditor(type, null, async () => {
      await save('inbox', { id: item.id, processed: true, convertedTo: type, convertedAt: nowISO() });
      toast(`Convertito in ${type} ✅`);
      ctx.refresh();
    }, preset);
  });

  onClick(root, '[data-menu]', async (el, e) => {
    e.stopPropagation();
    const i = byId('inbox', el.dataset.menu);
    if (!i) return;
    const choice = await actionSheet('Elemento Inbox', [
      { label: 'Modifica testo', icon: '✏️', value: 'edit' },
      { label: 'Copia testo', icon: '📋', value: 'copy' },
      { label: i.processed ? 'Rimetti da smistare' : 'Segna come smistato', icon: '🔁', value: 'toggle' },
      { label: 'Elimina', icon: '🗑️', value: 'del', danger: true }
    ]);
    if (choice === 'edit') {
      const { promptDialog } = await import('../ui.js');
      const txt = await promptDialog({ title: 'Modifica', label: 'Testo', value: i.text, multiline: true });
      if (txt) { await save('inbox', { id: i.id, text: txt }); ctx.refresh(); }
    }
    if (choice === 'copy') {
      const { copyText } = await import('../utils.js');
      const ok = await copyText(i.text);
      toast(ok ? 'Copiato' : 'Copia non disponibile');
    }
    if (choice === 'toggle') { await save('inbox', { id: i.id, processed: !i.processed }); ctx.refresh(); }
    if (choice === 'del') {
      const ok = await confirmDialog({ title: 'Eliminare?', message: 'L\'elemento verrà rimosso dall\'Inbox.', confirmText: 'Elimina', danger: true });
      if (ok) { await remove('inbox', i.id); toast('Eliminato'); ctx.refresh(); }
    }
  });
}
