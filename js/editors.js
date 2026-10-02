/* ==========================================================================
   LifeOS — editors.js
   Editor completo per ogni tipo di elemento (evento, attività, nota, idea,
   obiettivo, pensiero, inbox). Ogni editor è un bottom-sheet ottimizzato
   per il pollice, con dettatura vocale su tutti i campi testuali.
   ========================================================================== */

import { save, byId, list, categoryById, remove, rebuildReminders } from './store.js';
import {
  uid, esc, toLocalInput, humanWhen, minToLabel, offsetLabel, REMINDER_PRESETS,
  nowISO, fmtDate, dayKey, titleFrom, clamp
} from './utils.js';
import {
  sheet, qs, qsa, onClick, toast, confirmDialog, actionSheet, node
} from './ui.js';
import { renderFields, bindFields, customFieldDefs, pickCustomValues } from './fields.js';
import { attachMics, speechStatus } from './voice.js';
import { FREQ_OPTIONS } from './recur.js';

/* ---------------------------- OPZIONI BASE ------------------------------ */
const PRIORITIES = [
  { value: 'urgent', label: '🔴 Urgente' },
  { value: 'normal', label: '🟡 Normale' },
  { value: 'low', label: '🔵 Bassa' }
];
const TASK_STATUS = [
  { value: 'todo', label: '⚪ Da fare' },
  { value: 'doing', label: '🔵 In corso' },
  { value: 'done', label: '🟢 Completata' }
];
const IDEA_STATUS = [
  { value: 'idea', label: '💭 Idea' },
  { value: 'developing', label: '🔧 In sviluppo' },
  { value: 'parked', label: '⏸️ Parcheggiata' },
  { value: 'done', label: '✅ Realizzata' },
  { value: 'discarded', label: '🗑️ Scartata' }
];

const TYPE_LABEL = {
  event: 'Evento', task: 'Attività', note: 'Nota', idea: 'Idea',
  goal: 'Obiettivo', journal: 'Pensiero', inbox: 'Inbox'
};
const TYPE_ICON = {
  event: '📅', task: '✅', note: '📝', idea: '💡', goal: '🎯',
  journal: '📖', inbox: '📥'
};
const STORE_OF = {
  event: 'events', task: 'tasks', note: 'notes', idea: 'ideas',
  goal: 'goals', journal: 'journal', inbox: 'inbox'
};

export function categoryOptions(selected, includeNone = true) {
  const cats = list('categories');
  return `<select class="select" data-field="categoryId">
    ${includeNone ? `<option value="" ${!selected ? 'selected' : ''}>— Nessuna categoria —</option>` : ''}
    ${cats.map((c) => `<option value="${esc(c.id)}" ${selected === c.id ? 'selected' : ''}>${c.icon || '📁'} ${esc(c.name)}</option>`).join('')}
  </select>`;
}

/** Blocco promemoria riutilizzabile: chip multipli + selettore personalizzato. */
export function remindersBlock(selected = [], defaults = []) {
  const sel = Array.isArray(selected) && selected.length ? selected : (defaults || []);
  return `<div class="field">
    <label class="label">Promemoria (più di uno è possibile)</label>
    <div class="chips" data-reminders>
      ${REMINDER_PRESETS.map((p) => `<button type="button" class="chip sm ${sel.includes(p.min) ? 'on' : ''}" data-min="${p.min}">🔔 ${esc(p.label)}</button>`).join('')}
    </div>
    <div class="btn-row" style="margin-top:9px">
      <button type="button" class="btn xs" data-rem-custom>➕ Personalizzato</button>
      <button type="button" class="btn xs ghost" data-rem-none">✕ Nessuno</button>
    </div>
    <p class="mic-hint" data-rem-summary>${sel.length ? sel.map(offsetLabel).join(' · ') : 'Nessun promemoria'}</p>
  </div>`;
}

/** Collega i chip dei promemoria e mantiene un riepilogo testuale. */
function bindReminders(root, initial = []) {
  const wrap = root.querySelector('[data-reminders]')?.closest('.field');
  if (!wrap) return { get: () => [...initial] };
  const summary = wrap.querySelector('[data-rem-summary]');
  let current = [...initial];

  function refresh() {
    qsa('.chip', wrap).forEach((c) => c.classList.toggle('on', current.includes(Number(c.dataset.min))));
    summary.textContent = current.length ? current.map(offsetLabel).join(' · ') : 'Nessun promemoria';
  }

  onClick(wrap, '.chip[data-min]', (chip) => {
    const min = Number(chip.dataset.min);
    current = current.includes(min) ? current.filter((m) => m !== min) : [...current, min];
    refresh();
  });

  onClick(wrap, '[data-rem-none]', () => { current = []; refresh(); });

  wrap.querySelector('[data-rem-custom]')?.addEventListener('click', async () => {
    const days = await promptNumber('Giorni prima', 0);
    if (days === null) return;
    const hours = await promptNumber('Ore prima', 0);
    if (hours === null) return;
    const mins = await promptNumber('Minuti prima', 0);
    if (mins === null) return;
    const total = (Number(days) || 0) * 1440 + (Number(hours) || 0) * 60 + (Number(mins) || 0);
    if (!current.includes(total)) current.push(total);
    current.sort((a, b) => b - a);
    refresh();
    toast(`Promemoria: ${offsetLabel(total)}`);
  });

  refresh();
  return { get: () => [...current] };
}

function promptNumber(label, dflt = 0) {
  return new Promise((resolve) => {
    const body = document.createElement('div');
    body.innerHTML = `<label class="label">${esc(label)}</label>
      <input class="input" type="number" inputmode="numeric" min="0" value="${dflt}" data-num />`;
    const foot = document.createElement('div');
    foot.className = 'btn-row'; foot.style.width = '100%';
    foot.innerHTML = `<button class="btn" data-c>Annulla</button><button class="btn primary" data-o>OK</button>`;
    const s = sheet({ title: label, body, foot });
    const input = qs('[data-num]', body);
    setTimeout(() => input.focus(), 250);
    onClick(foot, '[data-c]', () => s.close(null));
    onClick(foot, '[data-o]', () => s.close(Number(input.value) || 0));
  });
}

/* ------------------------------- CHECKLIST ------------------------------ */
function checklistBlock(items = []) {
  return `<div class="field">
    <label class="label">Checklist</label>
    <div class="checklist" data-checklist>
      ${items.map(checklistItemHtml).join('')}
    </div>
    <div class="add-inline">
      <input class="input" data-new-check placeholder="Nuovo passo…" />
      <button type="button" class="btn sm" data-add-check>+</button>
    </div>
  </div>`;
}
function checklistItemHtml(it) {
  return `<div class="check-item ${it.done ? 'done' : ''}" data-check-id="${esc(it.id)}">
    <button type="button" class="check ${it.done ? 'on' : ''}" data-check-toggle>✓</button>
    <span class="ci-text">${esc(it.text)}</span>
    <button type="button" class="ci-del" data-check-del aria-label="Rimuovi">✕</button>
  </div>`;
}

function bindChecklist(root, initial = []) {
  const wrap = root.querySelector('[data-checklist]');
  if (!wrap) return { get: () => [...initial] };
  let items = initial.map((i) => ({ ...i, id: i.id || uid('chk') }));

  function sync() {
    wrap.innerHTML = items.map(checklistItemHtml).join('');
  }

  wrap.addEventListener('click', (e) => {
    const item = e.target.closest('[data-check-id]');
    if (!item) return;
    const id = item.dataset.checkId;
    if (e.target.closest('[data-check-toggle]')) {
      const it = items.find((x) => x.id === id);
      if (it) it.done = !it.done;
      sync();
    } else if (e.target.closest('[data-check-del]')) {
      items = items.filter((x) => x.id !== id);
      sync();
    }
  });

  const input = root.querySelector('[data-new-check]');
  const addBtn = root.querySelector('[data-add-check]');
  function add() {
    const text = (input?.value || '').trim();
    if (!text) return;
    items.push({ id: uid('chk'), text, done: false });
    input.value = '';
    sync();
  }
  addBtn?.addEventListener('click', add);
  input?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } });

  sync();
  return { get: () => items.map((i) => ({ ...i })) };
}

/* =============================== EDITOR ================================= */
/**
 * Apre l'editor di un elemento.
 * @param {'event'|'task'|'note'|'idea'|'goal'|'journal'|'inbox'} type
 * @param {string|null} id  se presente: modifica
 * @param {Function} [after] callback dopo il salvataggio
 * @param {object} [preset] valori precompilati per la creazione
 */
export async function openEditor(type, id = null, after = null, preset = {}) {
  const storeName = STORE_OF[type];
  if (!storeName) { toast('Tipo non riconosciuto'); return; }
  const existing = id ? byId(storeName, id) : null;
  const data = { ...defaults(type), ...(existing || {}), ...preset };

  const bodyHtml = renderForm(type, data, existing);
  const body = node(`<div>${bodyHtml}</div>`);

  const foot = node(`<div class="btn-row" style="width:100%">
    ${existing ? '<button class="btn danger sm" data-del style="flex:0 0 auto">🗑️</button>' : ''}
    <button class="btn" data-cancel>Annulla</button>
    <button class="btn primary" data-save>${existing ? 'Salva' : 'Crea'}</button>
  </div>`);

  const s = sheet({
    title: `${TYPE_ICON[type]} ${existing ? 'Modifica' : 'Nuovo'} ${TYPE_LABEL[type].toLowerCase()}`,
    body,
    foot,
    size: 'tall'
  });

  attachMics(s.body);

  const bind = bindFields(s.body, collectDefs(type, data));
  const remApi = bindReminders(s.body, data.reminders || []);
  const chkApi = type === 'task'
    ? bindChecklist(s.body, data.checklist || [])
    : { get: () => data.checklist || [] };
  const attApi = type === 'note'
    ? bindAttachments(s.body, data.attachments || [])
    : { get: () => data.attachments || [] };
  // le sotto-attività di un obiettivo aggiornano in tempo reale la % di completamento
  const subApi = type === 'goal'
    ? bindSubtasks(s.body, data.subtasks || [], (p) => {
        if (p === null) return;
        const slider = s.body.querySelector('[data-field="progress"]');
        if (slider) { slider.value = p; slider.dispatchEvent(new Event('input', { bubbles: true })); }
      })
    : { get: () => data.subtasks || [] };

  // pulsanti secondari specifici
  wireFormExtras(s, type, data, chkApi);

  onClick(foot, '[data-cancel]', () => s.close(null));

  onClick(foot, '[data-del]', async () => {
    const ok = await confirmDialog({
      title: 'Eliminare?',
      message: 'L\'elemento verrà rimosso dal dispositivo. I dati non vengono mai cancellati automaticamente: questa azione è tua.',
      confirmText: 'Elimina', danger: true
    });
    if (!ok) return;
    await remove(storeName, existing.id);
    toast('Eliminato');
    s.close(null);
    after?.();
  });

  onClick(foot, '[data-save]', async () => {
    try {
      const values = bind.sync();
      if (type === 'note') data.attachments = attApi.get();
      if (type === 'goal') data.subtasks = subApi.get();
      const payload = buildPayload(type, values, data, remApi.get(), chkApi.get(), existing);

      if (type === 'task' && !payload.title?.trim()) { toast('Serve un titolo'); focusFirst(s.body); return; }
      if (type === 'event' && !payload.title?.trim()) { toast('Serve un titolo'); focusFirst(s.body); return; }

      await save(storeName, payload);
      toast(existing ? 'Salvato ✅' : 'Creato ✅');
      s.close(payload);
      after?.(payload);
    } catch (err) {
      console.error('[editor] salvataggio fallito', err);
      toast('Salvataggio non riuscito: ' + (err.message || err), 3600);
    }
  });

  const supported = speechStatus();
  if (!supported.ok) {
    const note = node(`<p class="mic-hint" style="color:var(--warn)">🎤 ${esc(supported.label)}</p>`);
    s.body.insertBefore(note, s.body.firstChild);
  }

  return s.promise;
}

function focusFirst(root) {
  const el = root.querySelector('input[data-field="title"], textarea[data-field="text"], input[data-field="name"]');
  el?.focus();
}

/* ------------------------------ DEFAULTS -------------------------------- */
function defaults(type) {
  const base = { createdAt: nowISO(), tags: [], reminders: [] };
  switch (type) {
    case 'task': return { ...base, title: '', description: '', due: null, priority: 'normal', status: 'todo', categoryId: '', estimateMin: null, checklist: [], rating: 0 };
    case 'event': return { ...base, title: '', description: '', start: null, end: null, durationMin: 60, allDay: false, location: '', notes: '', priority: 'normal', categoryId: '', recurrence: null };
    case 'note': return { ...base, title: '', text: '', categoryId: '', archived: false, favorite: false, attachments: [] };
    case 'idea': return { ...base, title: '', description: '', categoryId: '', status: 'idea', importance: 3, feasibility: 3, rating: 3, notes: '', tags: [] };
    case 'goal': return { ...base, name: '', description: '', startDate: dayKey(), due: null, progress: 0, subtasks: [], categoryId: '', priority: 'normal', notes: '' };
    case 'journal': return { ...base, text: '', mood: 3, date: dayKey(), time: null };
    case 'inbox': return { ...base, text: '', processed: false, source: 'manual' };
    default: return base;
  }
}

/* ---------------------------- DEFINIZIONI ------------------------------- */
function collectDefs(type, data) {
  const custom = customFieldDefs(list('customFields'), type, data);
  const extras = data.__custom || {};
  return buildDefs(type, data).concat(custom).concat(extras);
}

function buildDefs(type, d) {
  const cats = list('categories');
  const catOpts = [{ value: '', label: '— Nessuna —' }, ...cats.map((c) => ({ value: c.id, label: `${c.icon || '📁'} ${c.name}` }))];

  switch (type) {
    case 'task':
      return [
        { key: 'title', label: 'Titolo', type: 'text', value: d.title, placeholder: 'es. Studiare Analisi II', required: true },
        { key: 'description', label: 'Descrizione', type: 'textarea', value: d.description, placeholder: 'Dettagli, link, riferimenti…' },
        { key: 'due', label: 'Scadenza', type: 'datetime', value: d.due },
        { key: 'priority', label: 'Priorità', type: 'select', value: d.priority || 'normal', options: PRIORITIES },
        { key: 'status', label: 'Stato', type: 'select', value: d.status || 'todo', options: TASK_STATUS },
        { key: 'categoryId', label: 'Categoria', type: 'dropdown', value: d.categoryId || '', options: catOpts },
        { key: 'estimateMin', label: 'Tempo stimato (minuti)', type: 'number', value: d.estimateMin, placeholder: 'es. 120', min: 0, step: 5 },
        { key: 'recurrenceFreq', label: 'Ripeti', type: 'dropdown', value: d.recurrence?.freq || 'none', options: FREQ_OPTIONS },
        { key: 'rating', label: 'Valutazione (0–10)', type: 'rating10', value: d.rating || 0 },
        { key: 'tags', label: 'Tag', type: 'tags', value: d.tags || [] }
      ];
    case 'event':
      return [
        { key: 'title', label: 'Titolo', type: 'text', value: d.title, placeholder: 'es. Esame Analisi II', required: true },
        { key: 'description', label: 'Descrizione', type: 'textarea', value: d.description, placeholder: 'Note sull\'evento…' },
        { key: 'start', label: 'Inizio', type: 'datetime', value: d.start },
        { key: 'durationMin', label: 'Durata (minuti)', type: 'number', value: d.durationMin ?? 60, min: 0, step: 15 },
        { key: 'location', label: 'Luogo', type: 'text', value: d.location, placeholder: 'es. Aula 3, via Roma 5' },
        { key: 'categoryId', label: 'Categoria', type: 'dropdown', value: d.categoryId || '', options: catOpts },
        { key: 'priority', label: 'Priorità', type: 'select', value: d.priority || 'normal', options: PRIORITIES },
        { key: 'recurrenceFreq', label: 'Ripeti', type: 'dropdown', value: d.recurrence?.freq || 'none', options: FREQ_OPTIONS },
        { key: 'recurrenceInterval', label: 'Ogni N volte', type: 'number', value: d.recurrence?.interval || 1, min: 1, step: 1 },
        { key: 'recurrenceUntil', label: 'Ripeti fino al', type: 'date', value: d.recurrence?.until || null },
        { key: 'notes', label: 'Note', type: 'textarea', value: d.notes, placeholder: 'Partecipanti, cose da portare…' },
        { key: 'tags', label: 'Tag', type: 'tags', value: d.tags || [] }
      ];
    case 'note':
      return [
        { key: 'title', label: 'Titolo', type: 'text', value: d.title, placeholder: 'Titolo della nota' },
        { key: 'text', label: 'Testo', type: 'textarea', value: d.text, placeholder: 'Scrivi o detta…' },
        { key: 'categoryId', label: 'Categoria', type: 'dropdown', value: d.categoryId || '', options: catOpts },
        { key: 'tags', label: 'Tag', type: 'tags', value: d.tags || [] },
        { key: 'favorite', label: 'Preferita', type: 'checkbox', checkLabel: 'Segna come preferita', value: d.favorite },
        { key: 'archived', label: 'Archiviata', type: 'checkbox', checkLabel: 'Sposta in archivio', value: d.archived }
      ];
    case 'idea':
      return [
        { key: 'title', label: 'Titolo', type: 'text', value: d.title, placeholder: 'es. Nuovo progetto Godot', required: true },
        { key: 'description', label: 'Descrizione', type: 'textarea', value: d.description, placeholder: 'In cosa consiste l\'idea?' },
        { key: 'categoryId', label: 'Categoria', type: 'dropdown', value: d.categoryId || '', options: catOpts },
        { key: 'status', label: 'Stato', type: 'select', value: d.status || 'idea', options: IDEA_STATUS },
        { key: 'importance', label: 'Importanza', type: 'stars', value: d.importance || 3 },
        { key: 'feasibility', label: 'Fattibilità', type: 'stars', value: d.feasibility || 3 },
        { key: 'rating', label: 'Valutazione generale (0–10)', type: 'rating10', value: d.rating || 0 },
        { key: 'notes', label: 'Note', type: 'textarea', value: d.notes },
        { key: 'tags', label: 'Tag', type: 'tags', value: d.tags || [] }
      ];
    case 'goal':
      return [
        { key: 'name', label: 'Nome obiettivo', type: 'text', value: d.name, placeholder: 'es. Preparare l\'esame di Analisi II', required: true },
        { key: 'description', label: 'Descrizione', type: 'textarea', value: d.description },
        { key: 'startDate', label: 'Inizio', type: 'date', value: d.startDate || dayKey() },
        { key: 'due', label: 'Scadenza', type: 'date', value: d.due },
        { key: 'progress', label: 'Completamento', type: 'slider', value: clamp(Number(d.progress) || 0, 0, 100), min: 0, max: 100, step: 5, unit: '%' },
        { key: 'priority', label: 'Priorità', type: 'select', value: d.priority || 'normal', options: PRIORITIES },
        { key: 'categoryId', label: 'Categoria', type: 'dropdown', value: d.categoryId || '', options: catOpts },
        { key: 'notes', label: 'Note', type: 'textarea', value: d.notes }
      ];
    case 'journal':
      return [
        { key: 'text', label: 'Pensiero', type: 'textarea', value: d.text, placeholder: 'Come è andata oggi?', required: true },
        { key: 'mood', label: 'Umore / energia (1–5)', type: 'stars', value: d.mood || 3 },
        { key: 'date', label: 'Data', type: 'date', value: d.date || dayKey() },
        { key: 'tags', label: 'Tag', type: 'tags', value: d.tags || [] }
      ];
    case 'inbox':
      return [
        { key: 'text', label: 'Pensiero veloce', type: 'textarea', value: d.text, placeholder: 'Scrivi o detta quello che ti passa in testa…', required: true }
      ];
    default: return [];
  }
}

/* ------------------------------ FORM HTML ------------------------------- */
function renderForm(type, d, existing) {
  let html = renderFields(buildDefs(type, d));

  if (type === 'task') {
    html += checklistBlock(d.checklist || []);
    html += remindersBlock(d.reminders || [], []);
  }
  if (type === 'event') {
    html += remindersBlock(d.reminders || [], [1440, 120, 30]);
  }
  // campi personalizzati
  const custom = customFieldDefs(list('customFields'), type, d);
  if (custom.length) {
    html += `<div class="divider"></div><div class="h3" style="margin-bottom:10px">✨ Campi personalizzati</div>`;
    html += renderFields(custom);
  }

  if (type === 'goal') {
    html += goalSubtasksBlock(d.subtasks || []);
    html += remindersBlock(d.reminders || [], []);
  }

  if (type === 'note') {
    html += attachmentsBlock(d.attachments || []);
  }
  if (type === 'idea') {
    html += `<div class="info-box">💡 Importanza e fattibilità sono indipendenti: puoi avere un'idea importantissima ma poco realizzabile, e va benissimo.</div>`;
  }

  return html;
}

/* -------------------------- SOTTO-ATTIVITÀ ------------------------------ */
function goalSubtasksBlock(items = []) {
  return `<div class="field">
    <label class="label">Sotto-attività</label>
    <div class="checklist" data-subtasks>
      ${items.map(subtaskHtml).join('')}
    </div>
    <div class="add-inline">
      <input class="input" data-new-sub placeholder="Nuova sotto-attività…" />
      <button type="button" class="btn sm" data-add-sub>+</button>
    </div>
    <p class="mic-hint">La percentuale di completamento viene ricalcolata automaticamente quando spunti le voci.</p>
  </div>`;
}
function subtaskHtml(it) {
  return `<div class="check-item ${it.done ? 'done' : ''}" data-sub-id="${esc(it.id)}">
    <button type="button" class="check ${it.done ? 'on' : ''}" data-sub-toggle>✓</button>
    <span class="ci-text">${esc(it.text)}</span>
    <button type="button" class="ci-del" data-sub-del>✕</button>
  </div>`;
}

function bindSubtasks(root, initial = [], onProgress) {
  const wrap = root.querySelector('[data-subtasks]');
  if (!wrap) return { get: () => [...initial] };
  let items = initial.map((i) => ({ ...i, id: i.id || uid('sub') }));

  function sync() {
    wrap.innerHTML = items.map(subtaskHtml).join('');
    const p = items.length ? Math.round((items.filter((i) => i.done).length / items.length) * 100) : null;
    onProgress?.(p);
  }

  wrap.addEventListener('click', (e) => {
    const item = e.target.closest('[data-sub-id]');
    if (!item) return;
    const id = item.dataset.subId;
    if (e.target.closest('[data-sub-toggle]')) {
      const it = items.find((x) => x.id === id); if (it) it.done = !it.done; sync();
    } else if (e.target.closest('[data-sub-del]')) {
      items = items.filter((x) => x.id !== id); sync();
    }
  });

  const input = root.querySelector('[data-new-sub]');
  const add = () => {
    const text = (input?.value || '').trim(); if (!text) return;
    items.push({ id: uid('sub'), text, done: false }); input.value = ''; sync();
  };
  root.querySelector('[data-add-sub]')?.addEventListener('click', add);
  input?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } });

  sync();
  return { get: () => items.map((i) => ({ ...i })) };
}

/* ---------------------------- ALLEGATI ---------------------------------- */
function attachmentsBlock(items = []) {
  return `<div class="field">
    <label class="label">Allegati</label>
    <div data-attachments>${items.map(attachmentHtml).join('')}</div>
    <div class="add-inline" style="flex-direction:column;gap:8px">
      <input class="input" type="file" data-att-file accept="image/*,.pdf,.txt,.md,.json" style="padding:10px" />
      <input class="input" data-att-note placeholder="Nota opzionale sull'allegato" />
      <button type="button" class="btn sm" data-att-add>📎 Allega</button>
    </div>
    <p class="mic-hint">Gli allegati sono salvati come dati dentro IndexedDB (base64): restano sul dispositivo e offline. Per file molto grandi lo spazio disponibile dipende dal browser.</p>
  </div>`;
}
function attachmentHtml(a) {
  const icon = (a.type || '').startsWith('image/') ? '🖼️' : (a.name || '').endsWith('.pdf') ? '📄' : '📎';
  return `<div class="attach" data-att-id="${esc(a.id)}">
    <span class="a-ico">${icon}</span>
    <span class="a-name">${esc(a.name || 'allegato')}</span>
    <span class="dim">${a.size ? Math.round(a.size / 1024) + ' KB' : ''}</span>
    <button type="button" class="ci-del" data-att-del>✕</button>
  </div>`;
}

function bindAttachments(root, initial = []) {
  const wrap = root.querySelector('[data-attachments]');
  if (!wrap) return { get: () => [...initial] };
  let items = [...initial];
  const fileInput = root.querySelector('[data-att-file]');
  const noteInput = root.querySelector('[data-att-note]');

  function sync() { wrap.innerHTML = items.map(attachmentHtml).join(''); }

  wrap.addEventListener('click', (e) => {
    if (e.target.closest('[data-att-del]')) {
      const id = e.target.closest('[data-att-id]')?.dataset.attId;
      items = items.filter((x) => x.id !== id);
      sync();
    }
  });

  root.querySelector('[data-att-add]')?.addEventListener('click', async () => {
    const file = fileInput?.files?.[0];
    if (!file) { toast('Scegli prima un file'); return; }
    const MAX = 3 * 1024 * 1024;
    if (file.size > MAX) { toast('File troppo grande (max 3 MB)', 3200); return; }
    try {
      const { readFileAsDataURL } = await import('./utils.js');
      const dataUrl = await readFileAsDataURL(file);
      items.push({ id: uid('att'), name: file.name, type: file.type || 'application/octet-stream', size: file.size, dataUrl, note: noteInput?.value || '' });
      fileInput.value = ''; if (noteInput) noteInput.value = '';
      sync();
      toast('Allegato aggiunto');
    } catch (e) { toast('Impossibile leggere il file'); }
  });

  return { get: () => items.map((i) => ({ ...i })) };
}

/* ------------------------- COLLEGAMENTI EXTRA --------------------------- */
function wireFormExtras(s, type, data, chkApi) {
  return s;
}

/* -------------------------- COSTRUZIONE PAYLOAD ------------------------- */
function buildPayload(type, values, data, reminders, checklist, existing) {
  const base = {
    id: existing?.id,
    createdAt: existing?.createdAt,
    reminders: (reminders || []).slice().sort((a, b) => b - a)
  };
  const cf = pickCustomValues(values);

  const num = (v) => (v === null || v === '' || v === undefined || isNaN(Number(v)) ? null : Number(v));

  switch (type) {
    case 'task': {
      const rec = values.recurrenceFreq && values.recurrenceFreq !== 'none'
        ? { freq: values.recurrenceFreq, interval: 1 }
        : null;
      return {
        ...base, ...cf,
        title: (values.title || '').trim(),
        description: values.description || '',
        due: values.due || null,
        priority: values.priority || 'normal',
        status: values.status || 'todo',
        categoryId: values.categoryId || '',
        estimateMin: num(values.estimateMin),
        checklist: checklist || [],
        tags: values.tags || [],
        rating: Number(values.rating) || 0,
        recurrence: rec,
        completedAt: values.status === 'done' ? (existing?.completedAt || nowISO()) : null
      };
    }
    case 'event': {
      let start = values.start || null;
      if (!start && data.start) start = data.start;
      const durationMin = Number(values.durationMin) || 60;
      const rec = values.recurrenceFreq && values.recurrenceFreq !== 'none'
        ? {
            freq: values.recurrenceFreq,
            interval: Math.max(1, Number(values.recurrenceInterval) || 1),
            until: values.recurrenceUntil || null
          }
        : null;
      return {
        ...base, ...cf,
        title: (values.title || '').trim(),
        description: values.description || '',
        start: start || nowISO(),
        durationMin,
        end: start ? new Date(new Date(start).getTime() + durationMin * 60000).toISOString() : null,
        location: values.location || '',
        notes: values.notes || '',
        priority: values.priority || 'normal',
        categoryId: values.categoryId || '',
        recurrence: rec,
        tags: values.tags || []
      };
    }
    case 'note':
      return {
        ...base, ...cf,
        title: (values.title || titleFrom(values.text, 50) || 'Senza titolo').trim(),
        text: values.text || '',
        categoryId: values.categoryId || '',
        tags: values.tags || [],
        favorite: Boolean(values.favorite),
        archived: Boolean(values.archived),
        attachments: values.attachments || data.attachments || []
      };
    case 'idea':
      return {
        ...base, ...cf,
        title: (values.title || titleFrom(values.description, 50) || 'Idea').trim(),
        description: values.description || '',
        categoryId: values.categoryId || '',
        status: values.status || 'idea',
        importance: Number(values.importance) || 0,
        feasibility: Number(values.feasibility) || 0,
        rating: Number(values.rating) || 0,
        notes: values.notes || '',
        tags: values.tags || []
      };
    case 'goal':
      return {
        ...base, ...cf,
        name: (values.name || '').trim(),
        description: values.description || '',
        startDate: values.startDate || dayKey(),
        due: values.due || null,
        progress: Number(values.progress) || 0,
        priority: values.priority || 'normal',
        categoryId: values.categoryId || '',
        notes: values.notes || '',
        subtasks: data.subtasks || []
      };
    case 'journal': {
      const d = values.date ? new Date(values.date) : new Date();
      return {
        ...base, ...cf,
        text: values.text || '',
        mood: Number(values.mood) || 0,
        date: dayKey(d),
        time: nowISO(),
        tags: values.tags || []
      };
    }
    case 'inbox':
      return {
        ...base, ...cf,
        text: values.text || '',
        processed: Boolean(existing?.processed),
        source: data.source || 'manual'
      };
    default:
      return { ...base, ...values };
  }
}

/* ------------- Sotto-editor per checklist/sottattività con voce -------- */
export { bindReminders, bindChecklist, bindSubtasks, bindAttachments, PRIORITIES, TASK_STATUS, IDEA_STATUS, TYPE_LABEL, TYPE_ICON, STORE_OF, defaults as editorDefaults, buildPayload };
