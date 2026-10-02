/* ==========================================================================
   LifeOS — views/more.js
   Sezione "Altro": impostazioni, categorie, campi personalizzati, backup,
   configurazione AI, informazioni e diagnostica.
   Sottopagine via #/more/<sub>
   ========================================================================== */

import {
  list, byId, save, remove, getSetting, setSetting, allSettings, globalStats,
  init, categoryById
} from '../store.js';
import {
  esc, fmtDate, relTime, uid, nowISO, downloadBlob, copyText, clamp
} from '../utils.js';
import { qs, onClick, toast, emptyState, confirmDialog, sheet, node, menuSheet, installHintHtml, actionSheet } from '../ui.js';
import { FIELD_TYPES, renderFields, bindFields, pickCustomValues } from '../fields.js';
import {
  exportToFile, exportToText, parseBackupFile, importWithChoice, autoBackup,
  listAutoBackups, restoreAutoBackup, clearAutoBackups, wipeAll, storageInfo,
  requestPersistence
} from '../backup.js';
import { diagnostics, permissionState, requestPermission, testNotification } from '../notifications.js';
import { speechStatus, ensureMicAccess, langCode, speak } from '../voice.js';
import { capabilities, configure, getConfig, buildContext } from '../ai/adapter.js';
import { installPrompt, updateAvailable, applyUpdate } from '../app.js';

export function render({ params }) {
  const sub = params._sub || '';
  if (!sub) return renderHub();
  switch (sub) {
    case 'settings': return renderSettings();
    case 'categories': return renderCategories();
    case 'fields': return renderFieldsPage();
    case 'backup': return renderBackup();
    case 'ai': return renderAI();
    case 'voice': return renderVoiceDiag();
    case 'stats': return renderStats();
    case 'about': return renderAbout();
    default: return renderHub();
  }
}

/* --------------------------------- HUB ---------------------------------- */
function renderHub() {
  const s = globalStats();
  const html = `
    <div class="page-head">
      <div class="h1">Altro</div>
      <div class="muted">Impostazioni, backup, categorie e diagnostica.</div>
    </div>

    <div class="stat-grid" style="margin-bottom:16px">
      <div class="stat"><div class="s-val">${s.tasksOpen}</div><div class="s-lbl">attività aperte</div></div>
      <div class="stat"><div class="s-val">${s.notes}</div><div class="s-lbl">note</div></div>
      <div class="stat"><div class="s-val">${s.ideas}</div><div class="s-lbl">idee</div></div>
      <div class="stat"><div class="s-val">${s.events}</div><div class="s-lbl">eventi</div></div>
      <div class="stat"><div class="s-val">${s.reminders}</div><div class="s-lbl">promemoria</div></div>
      <div class="stat"><div class="s-val">${s.inbox}</div><div class="s-lbl">in inbox</div></div>
    </div>

    <div class="menu-list">
      ${menuItem('inbox', '📥', 'Inbox', 'Smista i pensieri raccolti')}
      ${menuItem('goals', '🎯', 'Obiettivi', 'Traguardi con avanzamento')}
      ${menuItem('journal', '📖', 'Diario', 'Pensieri e umore giorno per giorno')}
      ${menuItem('reminders', '🔔', 'Promemoria', 'Tutti gli avvisi programmati')}
      ${menuItem('voice', '🎙️', 'Parla con LifeOS', 'Dettatura libera e analisi')}
      ${menuItem('more/settings', '⚙️', 'Impostazioni', 'Tema, notifiche, preferenze')}
      ${menuItem('more/categories', '🏷️', 'Categorie', 'Nome, icona, colore, descrizione')}
      ${menuItem('more/fields', '✨', 'Campi personalizzati', 'Aggiungi i tuoi campi')}
      ${menuItem('more/backup', '💾', 'Backup e dati', 'Esporta, importa, ripristina')}
      ${menuItem('more/ai', '🤖', 'Motore AI', 'Configura un modello (opzionale)')}
      ${menuItem('more/stats', '📊', 'Statistiche', 'Numeri e spazio usato')}
      ${menuItem('more/about', 'ℹ️', 'Informazioni', 'Privacy, installazione, limiti')}
    </div>
  `;
  return { title: 'Altro', sub: '', html, mount: (ctx) => bindHub(ctx) };
}

function menuItem(route, icon, label, desc) {
  return `<button class="menu-item" data-nav="${esc(route)}">
    <span class="mi-ico">${icon}</span>
    <span class="mi-body"><span>${esc(label)}</span><span class="mi-desc">${esc(desc)}</span></span>
    <span class="dim">›</span>
  </button>`;
}

function bindHub(ctx) {
  onClick(ctx.root, '[data-nav]', (el) => {
    const r = el.dataset.nav;
    location.hash = r.startsWith('more') ? `#/${r}` : `#/${r}`;
  });
}

/* ----------------------------- IMPOSTAZIONI ----------------------------- */
function renderSettings() {
  const s = allSettings();
  const html = `
    <div class="page-head">
      <div class="h1">Impostazioni</div>
      <div class="muted">Tutto locale: le preferenze restano su questo dispositivo.</div>
    </div>

    <section class="section">
      <div class="section-head"><div class="h3">🎨 Aspetto</div></div>
      <div class="card">
        <label class="label">Tema</label>
        <div class="chips" data-theme-pick>
          <button class="chip ${s.theme === 'auto' ? 'on' : ''}" data-theme="auto">🌗 Automatico</button>
          <button class="chip ${s.theme === 'light' ? 'on' : ''}" data-theme="light">☀️ Chiaro</button>
          <button class="chip ${s.theme === 'dark' ? 'on' : ''}" data-theme="dark">🌙 Scuro</button>
        </div>
        <div class="divider"></div>
        <label class="label">Come ti chiami</label>
        <div class="input-voice">
          <input class="input" data-name value="${esc(getStoredName() || '')}" placeholder="Il tuo nome" />
          <button class="btn sm" data-name-save>Salva</button>
        </div>
        <p class="mic-hint">Usato solo per il saluto nella Home.</p>
      </div>
    </section>

    <section class="section">
      <div class="section-head"><div class="h3">🔔 Notifiche e promemoria</div></div>
      <div class="card">
        <div class="switch-row" style="border:0">
          <span class="sr-text"><span class="sr-title">Notifiche</span>
            <span class="sr-desc">Permesso: ${esc(permissionState())}</span></span>
          <span class="switch"><input type="checkbox" data-notif ${permissionState() === 'granted' ? 'checked' : ''}><span class="track"></span></span>
        </div>
        <div class="btn-row">
          <button class="btn sm" data-notif-ask>Richiedi permesso</button>
          <button class="btn sm" data-notif-test>Prova</button>
        </div>
        <div class="divider"></div>
        <label class="label">Controllo promemoria ogni (minuti)</label>
        <input class="input" type="number" min="1" max="120" data-gran value="${Number(s.notifyGranularityMin)}" />
        <div class="divider"></div>
        <label class="label">Promemoria predefiniti per gli eventi (minuti prima, separati da virgola)</label>
        <input class="input" data-rem-ev value="${(s.defaultRemindersEvent || []).join(', ')}" placeholder="1440, 120, 30" />
        <label class="label" style="margin-top:12px">Promemoria predefiniti per le attività</label>
        <input class="input" data-rem-tk value="${(s.defaultRemindersTask || []).join(', ')}" placeholder="60" />
        <div class="btn-row" style="margin-top:12px"><button class="btn primary sm" data-pref-save>Salva preferenze</button></div>
      </div>
    </section>

    <section class="section">
      <div class="section-head"><div class="h3">💾 Backup</div></div>
      <div class="card">
        <div class="switch-row" style="border:0">
          <span class="sr-text"><span class="sr-title">Backup automatico locale</span>
            <span class="sr-desc">Uno snapshot al giorno dentro IndexedDB (max ${Number(s.autoBackupKeep)}). Non sostituisce l'export su file.</span></span>
          <span class="switch"><input type="checkbox" data-auto ${s.autoBackup ? 'checked' : ''}><span class="track"></span></span>
        </div>
        <label class="label">Snapshot da conservare</label>
        <input class="input" type="number" min="1" max="20" data-keep value="${Number(s.autoBackupKeep)}" />
        <div class="btn-row" style="margin-top:12px">
          <button class="btn sm" data-backup-now>📦 Crea snapshot ora</button>
          <button class="btn sm" data-nav="more/backup">Gestisci backup ›</button>
        </div>
        <p class="mic-hint">Ultimo backup: ${s.lastBackupAt ? esc(fmtDate(s.lastBackupAt, 'datetime')) : 'mai'}</p>
      </div>
    </section>

    <section class="section">
      <div class="section-head"><div class="h3">💿 Archiviazione</div></div>
      <div class="card">
        <p class="muted" id="storage-info">Verifico lo spazio…</p>
        <div class="btn-row" style="margin-top:10px">
          <button class="btn sm" data-persist>🔒 Proteggi archiviazione</button>
        </div>
        <p class="mic-hint">"Proteggi" chiede al browser di non cancellare i dati per liberare spazio. Non tutti i browser lo concedono.</p>
      </div>
    </section>

    <section class="section">
      <div class="section-head"><div class="h3">📲 App</div></div>
      <div class="card">
        ${installHintHtml()}
        <div class="btn-row" style="margin-top:10px">
          <button class="btn sm primary" data-install>⬇️ Installa LifeOS</button>
          <button class="btn sm" data-update>🔄 Cerca aggiornamenti</button>
        </div>
      </div>
    </section>
  `;
  return { title: 'Impostazioni', sub: '', html, mount: (ctx) => bindSettings(ctx) };
}

function getStoredName() {
  try { return localStorage.getItem('lifeos_name') || ''; } catch (e) { return ''; }
}

function bindSettings(ctx) {
  const root = ctx.root;
  const s = allSettings();

  onClick(root, '[data-theme]', async (el) => {
    const t = el.dataset.theme;
    await setSetting('theme', t);
    applyTheme(t);
    ctx.refresh();
  });

  onClick(root, '[data-name-save]', async (el) => {
    const name = (qs('[data-name]', root).value || '').trim();
    try { localStorage.setItem('lifeos_name', name); } catch (e) {}
    await setSetting('displayName', name);
    toast('Nome salvato');
  });

  onClick(root, '[data-notif-ask]', async () => { await requestPermission(); ctx.refresh(); });
  onClick(root, '[data-notif-test]', async () => { const ok = await testNotification(); toast(ok ? 'Notifica inviata' : 'Invio non riuscito', 3200); });

  qs('[data-notif]', root)?.addEventListener('change', async (e) => {
    if (e.target.checked) {
      const p = await requestPermission();
      if (p !== 'granted') e.target.checked = false;
    } else {
      await setSetting('notificationsEnabled', false);
    }
  });

  onClick(root, '[data-pref-save]', async () => {
    const gran = clamp(Number(qs('[data-gran]', root).value) || 15, 1, 120);
    const ev = parseList(qs('[data-rem-ev]', root).value);
    const tk = parseList(qs('[data-rem-tk]', root).value);
    await setSetting('notifyGranularityMin', gran);
    await setSetting('defaultRemindersEvent', ev);
    await setSetting('defaultRemindersTask', tk);
    const { reschedule } = await import('../reminders.js');
    reschedule();
    toast('Preferenze salvate ✅');
  });

  qs('[data-auto]', root)?.addEventListener('change', async (e) => {
    await setSetting('autoBackup', e.target.checked);
    toast(e.target.checked ? 'Backup automatico attivo' : 'Backup automatico disattivato');
  });
  qs('[data-keep]', root)?.addEventListener('change', async (e) => {
    await setSetting('autoBackupKeep', clamp(Number(e.target.value) || 5, 1, 20));
    toast('Impostazione salvata');
  });

  onClick(root, '[data-backup-now]', async () => { const k = await autoBackup(); toast(k ? 'Snapshot creato' : 'Snapshot non riuscito'); });

  onClick(root, '[data-persist]', async () => { await requestPersistence(); ctx.refresh(); });

  onClick(root, '[data-install]', async () => {
    const ok = await installPrompt();
    if (!ok) toast('Usa il menu del browser: "Installa app"', 3600);
  });

  onClick(root, '[data-update]', async () => {
    const found = await updateAvailable();
    if (found) { await applyUpdate(); } else toast('Sei già all\'ultima versione');
  });

  // info spazio
  storageInfo().then((info) => {
    const el = qs('#storage-info', root);
    if (!el) return;
    const used = info.usage != null ? (info.usage / 1024 / 1024).toFixed(2) + ' MB' : 'non disponibile';
    const quota = info.quota != null ? (info.quota / 1024 / 1024).toFixed(0) + ' MB' : 'non disponibile';
    el.innerHTML = `
      Spazio usato: <b>${used}</b> su <b>${quota}</b><br>
      Archiviazione protetta: <b>${info.persisted ? 'sì' : 'no'}</b><br>
      <span class="dim">Elementi: ${info.counters.tasks} attività · ${info.counters.notes} note · ${info.counters.ideas} idee · ${info.counters.events} eventi · ${info.counters.journal} voci diario</span>`;
  }).catch(() => {});
}

function parseList(str) {
  return String(str || '').split(/[,;\s]+/).map((x) => Number(x)).filter((n) => !isNaN(n) && n >= 0).sort((a, b) => b - a);
}

export function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme === 'auto' ? 'auto' : theme);
}

/* ------------------------------ CATEGORIE ------------------------------- */
function renderCategories() {
  const cats = list('categories');
  const counts = {};
  ['tasks', 'events', 'notes', 'ideas', 'goals'].forEach((st) => {
    list(st).forEach((x) => { if (x.categoryId) counts[x.categoryId] = (counts[x.categoryId] || 0) + 1; });
  });

  const html = `
    <div class="page-head">
      <div class="h1">Categorie</div>
      <div class="muted">${cats.length} categorie · nome, icona, colore e descrizione personalizzabili.</div>
    </div>
    <div class="btn-row" style="margin-bottom:14px">
      <button class="btn primary sm" data-new-cat>➕ Nuova categoria</button>
    </div>
    ${cats.map((c) => `<div class="card">
      <div style="display:flex;gap:12px;align-items:center">
        <span style="width:46px;height:46px;border-radius:14px;display:grid;place-items:center;font-size:22px;background:${esc(c.color)}22;border:1.5px solid ${esc(c.color)}">${c.icon || '📁'}</span>
        <div style="flex:1;min-width:0">
          <div class="row-title">${esc(c.name)}</div>
          <div class="row-sub">
            <span class="badge" style="background:${esc(c.color)};color:#fff">${esc(c.color)}</span>
            <span>${counts[c.id] || 0} elementi</span>
          </div>
          ${c.description ? `<div class="dim" style="margin-top:4px">${esc(c.description)}</div>` : ''}
        </div>
        <button class="icon-btn" data-cat-menu="${esc(c.id)}" aria-label="Azioni">⋯</button>
      </div>
    </div>`).join('')}
    <p class="mic-hint">Eliminando una categoria gli elementi collegati non vengono cancellati: restano semplicemente senza categoria.</p>
  `;
  return { title: 'Categorie', sub: `${cats.length}`, html, mount: (ctx) => bindCategories(ctx) };
}

function bindCategories(ctx) {
  const root = ctx.root;

  async function openCat(cat = null) {
    const body = node(`<div>
      <div class="field"><label class="label">Nome</label>
        <div class="input-voice"><input class="input" data-c-name value="${esc(cat?.name || '')}" placeholder="es. Università" />
        <button class="mic-btn" data-mic="c-name">🎤</button></div></div>
      <div class="field"><label class="label">Icona (emoji)</label>
        <input class="input" data-c-icon value="${esc(cat?.icon || '📁')}" placeholder="🎓" maxlength="4" /></div>
      <div class="field"><label class="label">Colore</label>
        <input class="input" type="color" data-c-color value="${esc(cat?.color || '#4f6df5')}" style="height:56px;padding:6px" /></div>
      <div class="field"><label class="label">Descrizione</label>
        <textarea class="textarea" data-c-desc placeholder="A cosa serve questa categoria?">${esc(cat?.description || '')}</textarea></div>
    </div>`);
    const foot = node(`<div class="btn-row" style="width:100%">
      ${cat ? '<button class="btn danger sm" data-del-cat style="flex:0 0 auto">🗑️</button>' : ''}
      <button class="btn" data-cancel>Annulla</button>
      <button class="btn primary" data-save-cat>Salva</button>
    </div>`);
    const s = sheet({ title: cat ? 'Modifica categoria' : 'Nuova categoria', body, foot });
    const { attachMics } = await import('../voice.js');
    attachMics(s.body);

    onClick(foot, '[data-cancel]', () => s.close());
    onClick(foot, '[data-save-cat]', async () => {
      const name = (qs('[data-c-name]', s.body).value || '').trim();
      if (!name) { toast('Serve un nome'); return; }
      await save('categories', {
        id: cat?.id,
        name,
        icon: (qs('[data-c-icon]', s.body).value || '📁').trim(),
        color: qs('[data-c-color]', s.body).value,
        description: (qs('[data-c-desc]', s.body).value || '').trim(),
        createdAt: cat?.createdAt
      });
      toast(cat ? 'Categoria aggiornata' : 'Categoria creata');
      s.close(); ctx.refresh();
    });
    onClick(foot, '[data-del-cat]', async () => {
      const ok = await confirmDialog({
        title: 'Eliminare la categoria?',
        message: `"${cat.name}" verrà rimossa. Gli elementi che la usavano resteranno, senza categoria.`,
        confirmText: 'Elimina', danger: true
      });
      if (!ok) return;
      await remove('categories', cat.id);
      toast('Categoria eliminata'); s.close(); ctx.refresh();
    });
  }

  onClick(root, '[data-new-cat]', () => openCat(null));
  onClick(root, '[data-cat-menu]', (el, e) => { e.stopPropagation(); openCat(byId('categories', el.dataset.catMenu)); });
}

/* -------------------------- CAMPI PERSONALIZZATI ------------------------ */
function renderFieldsPage() {
  const fields = list('customFields');
  const html = `
    <div class="page-head">
      <div class="h1">Campi personalizzati</div>
      <div class="muted">Tipi disponibili: testo, Sì/No, checkbox, stelle, voto 0–10, slider, selezione singola/multipla, menu a tendina, numero, data, colore, tag.</div>
    </div>
    <div class="btn-row" style="margin-bottom:14px">
      <button class="btn primary sm" data-new-field>➕ Nuovo campo</button>
    </div>
    ${fields.length ? fields.map((f) => `<div class="card">
      <div style="display:flex;gap:10px;align-items:center">
        <span style="font-size:20px">✨</span>
        <div style="flex:1;min-width:0">
          <div class="row-title">${esc(f.name)}</div>
          <div class="row-sub">
            <span class="badge">${esc((FIELD_TYPES.find((t) => t.type === f.type) || {}).label || f.type)}</span>
            <span>${(f.entityTypes || []).length ? (f.entityTypes || []).map(esc).join(', ') : 'tutti i tipi'}</span>
          </div>
          ${(f.options || []).length ? `<div class="dim" style="margin-top:4px">Opzioni: ${(f.options || []).map(esc).join(' · ')}</div>` : ''}
        </div>
        <button class="icon-btn" data-field-menu="${esc(f.id)}">⋯</button>
      </div>
    </div>`).join('') : emptyState('✨', 'Nessun campo personalizzato', 'Crea campi tuoi (es. "Voto esame 0–10", "Fatto?", "Difficoltà") e li ritroverai in tutti gli editor.')}
  `;
  return { title: 'Campi personalizzati', sub: `${fields.length}`, html, mount: (ctx) => bindFieldsPage(ctx) };
}

function bindFieldsPage(ctx) {
  const root = ctx.root;

  async function openField(f = null) {
    const entityOptions = ['event', 'task', 'note', 'idea', 'goal', 'journal'];
    const body = node(`<div>
      <div class="field"><label class="label">Nome del campo</label>
        <div class="input-voice"><input class="input" data-f-name value="${esc(f?.name || '')}" placeholder="es. Difficoltà percepita" />
        <button class="mic-btn" data-mic="f-name">🎤</button></div></div>
      <div class="field"><label class="label">Tipo</label>
        <select class="select" data-f-type>${FIELD_TYPES.map((t) => `<option value="${t.type}" ${f?.type === t.type ? 'selected' : ''}>${esc(t.label)}</option>`).join('')}</select></div>
      <div class="field"><label class="label">Opzioni (per selezioni, separate da virgola)</label>
        <input class="input" data-f-options value="${esc((f?.options || []).join(', '))}" placeholder="Bassa, Media, Alta" /></div>
      <div class="field-row">
        <div class="field"><label class="label">Minimo</label><input class="input" type="number" data-f-min value="${f?.min ?? ''}" /></div>
        <div class="field"><label class="label">Massimo</label><input class="input" type="number" data-f-max value="${f?.max ?? ''}" /></div>
      </div>
      <div class="field"><label class="label">Unità (slider)</label><input class="input" data-f-unit value="${esc(f?.unit || '')}" placeholder="es. %" /></div>
      <div class="field"><label class="label">Dove usarlo</label>
        <div class="chips" data-entities>${entityOptions.map((e) => `<button type="button" class="chip ${(f?.entityTypes || []).includes(e) ? 'on' : ''}" data-entity="${e}">${e}</button>`).join('')}</div>
        <p class="mic-hint">Nessuna selezione = il campo compare in tutti gli editor.</p></div>
    </div>`);
    const foot = node(`<div class="btn-row" style="width:100%">
      ${f ? '<button class="btn danger sm" data-del-field style="flex:0 0 auto">🗑️</button>' : ''}
      <button class="btn" data-cancel>Annulla</button>
      <button class="btn primary" data-save-field>Salva</button>
    </div>`);
    const s = sheet({ title: f ? 'Modifica campo' : 'Nuovo campo', body, foot });
    const { attachMics } = await import('../voice.js');
    attachMics(s.body);

    onClick(s.body, '.chip[data-entity]', (chip) => chip.classList.toggle('on'));

    onClick(foot, '[data-cancel]', () => s.close());
    onClick(foot, '[data-save-field]', async () => {
      const name = (qs('[data-f-name]', s.body).value || '').trim();
      if (!name) { toast('Serve un nome'); return; }
      const options = String(qs('[data-f-options]', s.body).value || '').split(',').map((x) => x.trim()).filter(Boolean);
      const entityTypes = [...s.body.querySelectorAll('.chip[data-entity].on')].map((c) => c.dataset.entity);
      await save('customFields', {
        id: f?.id,
        name,
        type: qs('[data-f-type]', s.body).value,
        options,
        min: qs('[data-f-min]', s.body).value === '' ? null : Number(qs('[data-f-min]', s.body).value),
        max: qs('[data-f-max]', s.body).value === '' ? null : Number(qs('[data-f-max]', s.body).value),
        unit: qs('[data-f-unit]', s.body).value || '',
        entityTypes,
        order: f?.order ?? list('customFields').length,
        createdAt: f?.createdAt
      });
      toast(f ? 'Campo aggiornato' : 'Campo creato');
      s.close(); ctx.refresh();
    });
    onClick(foot, '[data-del-field]', async () => {
      const ok = await confirmDialog({ title: 'Eliminare il campo?', message: `"${f.name}" non comparirà più negli editor. I valori già salvati restano nei dati.`, confirmText: 'Elimina', danger: true });
      if (!ok) return;
      await remove('customFields', f.id);
      toast('Campo eliminato'); s.close(); ctx.refresh();
    });
  }

  onClick(root, '[data-new-field]', () => openField(null));
  onClick(root, '[data-field-menu]', (el) => openField(byId('customFields', el.dataset.fieldMenu)));
}

/* -------------------------------- BACKUP -------------------------------- */
function renderBackup() {
  const s = allSettings();
  const html = `
    <div class="page-head">
      <div class="h1">Backup e dati</div>
      <div class="muted">Esportazione e importazione completa in JSON. Nessun cloud: il file resta tuo.</div>
    </div>

    <section class="section">
      <div class="section-head"><div class="h3">📤 Esporta</div></div>
      <div class="card">
        <p class="muted">Il file contiene eventi, attività, note, idee, obiettivi, diario, inbox, categorie, campi personalizzati e impostazioni.</p>
        <div class="btn-row" style="margin-top:12px">
          <button class="btn primary sm" data-export>💾 Scarica backup JSON</button>
          <button class="btn sm" data-copy>📋 Copia JSON</button>
        </div>
        <p class="mic-hint">Ultimo backup: ${s.lastBackupAt ? esc(fmtDate(s.lastBackupAt, 'datetime')) : 'mai'}</p>
      </div>
    </section>

    <section class="section">
      <div class="section-head"><div class="h3">📥 Importa</div></div>
      <div class="card">
        <input class="input" type="file" accept="application/json,.json" data-import-file style="padding:10px" />
        <div class="btn-row" style="margin-top:10px">
          <button class="btn sm primary" data-import>📂 Importa file selezionato</button>
        </div>
        <p class="mic-hint">Potrai scegliere se <b>unire</b> i dati o <b>sostituirli</b>. Un'unione non elimina nulla di ciò che hai già.</p>
      </div>
    </section>

    <section class="section">
      <div class="section-head"><div class="h3">📦 Snapshot automatici</div>
        <button class="link-btn" data-clear-auto>Svuota</button></div>
      <div id="autos"><p class="dim">Carico gli snapshot…</p></div>
    </section>

    <section class="section">
      <div class="section-head"><div class="h3">⚠️ Zona pericolosa</div></div>
      <div class="card" style="border-color:color-mix(in srgb, var(--danger) 40%, var(--border))">
        <p class="muted">LifeOS non cancella mai nulla in automatico. Puoi però eliminare tutto manualmente: l'azione è irreversibile.</p>
        <div class="btn-row" style="margin-top:12px">
                <div class="divider"></div>
      <div class="h3" style="margin-bottom:10px">🩺 Diagnostica dell'installazione</div>
      <div id="pwa-diag" class="muted" style="line-height:1.7">Raccolta informazioni…</div>
      <div class="btn-row" style="margin-top:12px">
        <a class="btn sm" href="./reset.html">Pagina di diagnostica</a>
      </div>
      <button class="btn danger sm" data-wipe>🗑️ Elimina tutti i dati</button>
        </div>
      </div>
    </section>
  `;
  return { title: 'Backup e dati', sub: '', html, mount: (ctx) => bindBackup(ctx) };
}

function bindBackup(ctx) {
  const root = ctx.root;

  onClick(root, '[data-export]', () => { exportToFile(); ctx.refresh(); });

  onClick(root, '[data-copy]', async () => {
    const ok = await copyText(exportToText());
    toast(ok ? 'JSON copiato negli appunti' : 'Copia non disponibile', 3000);
  });

  onClick(root, '[data-import]', async () => {
    const file = qs('[data-import-file]', root)?.files?.[0];
    if (!file) { toast('Seleziona prima un file JSON'); return; }
    try {
      const payload = await parseBackupFile(file);
      await importWithChoice(payload);
      ctx.refresh();
    } catch (e) {
      toast(e.message || 'File non valido', 4000);
    }
  });

  onClick(root, '[data-clear-auto]', async () => {
    const n = await clearAutoBackups();
    toast(n ? `${n} snapshot eliminati` : 'Nessuno snapshot da eliminare');
    ctx.refresh();
  });

  onClick(root, '[data-wipe]', async () => { await wipeAll(); });

  // lista snapshot
  listAutoBackups().then((list_) => {
    const el = qs('#autos', root);
    if (!el) return;
    if (!list_.length) { el.innerHTML = '<p class="dim">Nessuno snapshot. Attiva il backup automatico nelle Impostazioni oppure creane uno ora.</p>'; return; }
    el.innerHTML = list_.map((b) => `<div class="row" style="align-items:center">
      <div class="row-body">
        <div class="row-title" style="font-size:14.5px">Snapshot del ${esc(fmtDate(b.at, 'datetime'))}</div>
        <div class="row-sub"><span>${esc(relTime(b.at))}</span>
          <span>${Object.entries(b.counts || {}).filter(([, v]) => v).slice(0, 4).map(([k, v]) => `${v} ${k}`).join(' · ')}</span></div>
      </div>
      <div class="row-right">
        <button class="btn xs primary" data-restore="${esc(b.key)}">Ripristina</button>
      </div>
    </div>`).join('');

    onClick(el, '[data-restore]', async (btn) => {
      const ok = await restoreAutoBackup(btn.dataset.restore);
      if (ok) ctx.refresh();
    });
  }).catch(() => {});
}

/* ---------------------------------- AI ---------------------------------- */
function renderAI() {
  const cfg = getConfig();
  const cap = capabilities();
  const ctxData = buildContext();

  const html = `
    <div class="page-head">
      <div class="h1">Motore AI</div>
      <div class="muted">Opzionale. LifeOS funziona già con un parser locale a regole: nessun servizio esterno necessario.</div>
    </div>

    <div class="card">
      <div class="switch-row" style="border:0">
        <span class="sr-text">
          <span class="sr-title">Usa un modello esterno</span>
          <span class="sr-desc">Se attivo, l'interpretazione dei testi e le risposte alle domande vengono inoltrate all'endpoint che indichi. <b>I tuoi testi lasceranno il dispositivo.</b></span>
        </span>
        <span class="switch"><input type="checkbox" data-ai-toggle ${cfg.provider === 'remote' ? 'checked' : ''}><span class="track"></span></span>
      </div>
      <div class="divider"></div>
      <label class="label">Endpoint (chat completions compatibile)</label>
      <input class="input" data-ai-endpoint value="${esc(cfg.endpoint)}" placeholder="https://…/v1/chat/completions" />
      <label class="label" style="margin-top:12px">Chiave API (salvata solo in locale)</label>
      <input class="input" data-ai-key value="${esc(cfg.apiKey)}" placeholder="sk-…" />
      <label class="label" style="margin-top:12px">Modello</label>
      <input class="input" data-ai-model value="${esc(cfg.model)}" placeholder="es. gpt-4o-mini" />
      <div class="btn-row" style="margin-top:14px">
        <button class="btn primary sm" data-ai-save>Salva configurazione</button>
      </div>
      <p class="mic-hint">Lo stato attuale è <b>${esc(cap.provider === 'remote' && cap.endpoint ? 'provider remoto' : 'parser locale')}</b>. Se il provider non risponde, LifeOS torna automaticamente al parser locale.</p>
    </div>

    <section class="section">
      <div class="section-head"><div class="h3">🔌 Cosa può fare l'AI, quando collegata</div></div>
      <div class="card">
        <ul style="font-size:14px;line-height:1.85;list-style:none">
          <li>${chk(cap.features.interpret)} interpretare gli input vocali</li>
          <li>${chk(cap.features.classify)} classificare automaticamente note e idee</li>
          <li>${chk(cap.features.interpret)} creare attività dagli input</li>
          <li>${chk(cap.features.interpret)} creare eventi</li>
          <li>${chk(cap.features.summarize)} riassumere note (ora: riassunto estrattivo locale)</li>
          <li>${chk(cap.features.answer)} trovare informazioni nella memoria</li>
          <li>${chk(cap.features.suggestions)} suggerire organizzazioni</li>
          <li>${chk(cap.features.answer)} rispondere a domande sui dati personali</li>
        </ul>
        <p class="mic-hint">Il pulsante "Modifica prima di salvare" nella pagina vocale resta sempre disponibile: l'AI propone, tu decidi.</p>
      </div>
    </section>

    <section class="section">
      <div class="section-head"><div class="h3">🧠 Contesto disponibile per il modello</div></div>
      <div class="card">
        <p class="muted">Ecco cosa LifeOS può passare al modello (solo se lo attivi):</p>
        <pre style="font-size:11.5px;background:var(--card-2);padding:12px;border-radius:12px;overflow:auto;max-height:280px;white-space:pre-wrap">${esc(JSON.stringify({ counts: ctxData.counts, categories: ctxData.categories.length, today: ctxData.today }, null, 2))}</pre>
      </div>
    </section>
  `;
  return { title: 'Motore AI', sub: '', html, mount: (ctx) => bindAI(ctx) };
}

function chk(on) {
  return on === true ? '✅' : on ? '🟡' : '⚪';
}

function bindAI(ctx) {
  const root = ctx.root;

  onClick(root, '[data-ai-save]', async () => {
    const remote = qs('[data-ai-toggle]', root).checked;
    configure({
      provider: remote ? 'remote' : 'local-rules',
      endpoint: (qs('[data-ai-endpoint]', root).value || '').trim(),
      apiKey: (qs('[data-ai-key]', root).value || '').trim(),
      model: (qs('[data-ai-model]', root).value || '').trim()
    });
    await setSetting('ai', getConfig());
    toast('Configurazione AI salvata');
    ctx.refresh();
  });

  qs('[data-ai-toggle]', root)?.addEventListener('change', (e) => {
    if (e.target.checked && !(qs('[data-ai-endpoint]', root).value || '').trim()) {
      toast('Inserisci un endpoint prima di attivare il modello esterno', 3600);
    }
  });
}

/* -------------------------- DIAGNOSTICA VOCE ---------------------------- */
function renderVoiceDiag() {
  const st = speechStatus();
  const diag = diagnostics();
  const html = `
    <div class="page-head">
      <div class="h1">Dettatura vocale</div>
      <div class="muted">Web Speech API — supporto reale del tuo dispositivo.</div>
    </div>
    <div class="card">
      <p class="muted">${esc(st.label)}</p>
      <div class="divider"></div>
      <p class="muted">Lingua riconosciuta: <b>${esc(langCode())}</b></p>
      <div class="btn-row" style="margin-top:12px">
        <button class="btn sm primary" data-mic-test>🎤 Prova microfono</button>
        <button class="btn sm" data-voice-link>Parla con LifeOS ›</button>
      </div>
    </div>
    <div class="warn-box" style="margin-top:14px">
      <b>Cosa aspettarsi</b><br>
      • Chrome / Edge (Android e desktop): supportata, ma può richiedere la connessione perché l'audio viene riconosciuto lato servizio.<br>
      • iPhone: richiede iOS 16.4 o superiore e l'app installata nella schermata Home.<br>
      • Firefox: non implementata. Usa la tastiera (minuscolo: tutti i campi restano scrivibili).<br>
      • La lingua segue quella del dispositivo.
      ${diag.isIOS && !diag.standalone ? '<br><br><b>Ora stai usando LifeOS nel browser, non come app installata:</b> su iPhone la dettatura e le notifiche potrebbero non essere disponibili.' : ''}
    </div>
  `;
  return { title: 'Dettatura', sub: '', html, mount: (ctx) => bindVoiceDiag(ctx) };
}

function bindVoiceDiag(ctx) {
  const root = ctx.root;

  onClick(root, '[data-voice-link]', () => { location.hash = '#/voice'; });

  onClick(root, '[data-mic-test]', async (el) => {
    const btn = el;
    btn.textContent = '⏳ Chiedo permesso…';
    const res = await ensureMicAccess();
    if (res.ok) { toast('Microfono accessibile ✅'); btn.textContent = '🎤 Prova microfono'; ctx.refresh(); return; }
    const msg = res.reason === 'NotAllowedError' ? 'Permesso negato: controlla le impostazioni del sito.'
      : res.reason === 'NotFoundError' ? 'Nessun microfono rilevato.'
        : res.reason === 'no-getusermedia' ? 'Questo browser non espone getUserMedia: il test non è possibile.'
          : `Accesso al microfono non riuscito (${res.reason}).`;
    toast(msg, 4200);
    btn.textContent = '🎤 Prova microfono';
  });
}

/* ------------------------------- STATS ---------------------------------- */
function renderStats() {
  const s = globalStats();
  const tasks = list('tasks');
  const done = tasks.filter((t) => t.status === 'done').length;
  const rate = tasks.length ? Math.round((done / tasks.length) * 100) : 0;
  const ideas = list('ideas');
  const avgImp = ideas.length ? (ideas.reduce((a, i) => a + (Number(i.importance) || 0), 0) / ideas.length).toFixed(1) : '—';
  const journal = list('journal');
  const avgMood = journal.length ? (journal.reduce((a, j) => a + (Number(j.mood) || 0), 0) / journal.length).toFixed(1) : '—';
  const byCat = {};
  ['tasks', 'events', 'notes', 'ideas', 'goals'].forEach((st) => list(st).forEach((x) => {
    if (x.categoryId) byCat[x.categoryId] = (byCat[x.categoryId] || 0) + 1;
  }));

  const html = `
    <div class="page-head">
      <div class="h1">Statistiche</div>
      <div class="muted">Numeri calcolati in locale sui tuoi dati.</div>
    </div>

    <div class="stat-grid">
      ${stat(s.tasks, 'attività totali')}
      ${stat(s.tasksOpen, 'aperte')}
      ${stat(s.events, 'eventi')}
      ${stat(s.notes, 'note')}
      ${stat(s.ideas, 'idee')}
      ${stat(s.goals, 'obiettivi')}
      ${stat(s.journal, 'voci diario')}
      ${stat(s.reminders, 'promemoria attivi')}
    </div>

    <section class="section">
      <div class="section-head"><div class="h3">📈 Qualità</div></div>
      <div class="card">
        <div class="progress-top" style="color:var(--text-2)"><span>Attività completate</span><span style="color:var(--text);font-weight:800">${rate}%</span></div>
        <div class="progress-line"><i style="width:${rate}%"></i></div>
        <div class="divider"></div>
        <p class="muted">Importanza media delle idee: <b>${esc(avgImp)}</b> / 5</p>
        <p class="muted">Umore medio nel diario: <b>${esc(avgMood)}</b> / 5</p>
      </div>
    </section>

    ${Object.keys(byCat).length ? `<section class="section">
      <div class="section-head"><div class="h3">🏷️ Elementi per categoria</div></div>
      <div class="card">
        ${Object.entries(byCat).sort((a, b) => b[1] - a[1]).map(([id, n]) => {
          const c = categoryById(id);
          const max = Math.max(...Object.values(byCat));
          return `<div style="margin-bottom:11px">
            <div style="display:flex;justify-content:space-between;font-size:13.5px"><span>${c ? `${c.icon} ${esc(c.name)}` : esc(id)}</span><b>${n}</b></div>
            <div class="progress-line" style="margin-top:4px"><i style="width:${Math.round((n / max) * 100)}%"></i></div>
          </div>`;
        }).join('')}
      </div>
    </section>` : ''}
  `;
  return { title: 'Statistiche', sub: '', html, mount: (ctx) => bindStats(ctx) };
}

function stat(val, lbl) {
  return `<div class="stat"><div class="s-val">${val}</div><div class="s-lbl">${esc(lbl)}</div></div>`;
}

function bindStats(ctx) {
  // nessuna interazione: pagina informativa
}

/* ------------------------------- ABOUT ---------------------------------- */
function renderAbout() {
  const diag = diagnostics();
  const html = `
    <div class="page-head">
      <div class="h1">Informazioni</div>
      <div class="muted">LifeOS · Progressive Web App personale</div>
    </div>

    <div class="card">
      <div style="text-align:center;padding:12px 0">
        <div style="font-size:38px;font-weight:800;letter-spacing:-.03em">Life<span style="background:linear-gradient(92deg,var(--accent),var(--accent-2));-webkit-background-clip:text;background-clip:text;color:transparent">OS</span></div>
        <div class="dim">Il tuo secondo cervello, sul tuo telefono</div>
      </div>
      <div class="divider"></div>
      <p class="muted">Versione <b>1.0.0</b> · schema dati 1 · ${esc(diag.standalone ? 'in esecuzione come app installata' : 'aperta nel browser')}</p>
    </div>

    <section class="section">
      <div class="section-head"><div class="h3">🔒 Privacy</div></div>
      <div class="card">
        <ul style="font-size:14px;line-height:1.9;list-style:none">
          <li>✅ I dati sono salvati <b>solo sul tuo dispositivo</b> (IndexedDB)</li>
          <li>✅ Nessun account, nessun login</li>
          <li>✅ Nessun database remoto, nessuna pubblicità, nessun tracciamento</li>
          <li>✅ Funziona offline per tutte le funzioni locali</li>
          <li>✅ Niente viene cancellato automaticamente</li>
          <li>⚠️ Se attivi un modello AI esterno, i testi che gli invii escono dal dispositivo: è una tua scelta consapevole</li>
        </ul>
      </div>
    </section>

    <section class="section">
      <div class="section-head"><div class="h3">📲 Installazione</div></div>
      <div class="card">
        ${installHintHtml()}
        <div class="btn-row" style="margin-top:10px">
          <button class="btn sm primary" data-install>⬇️ Installa ora</button>
        </div>
      </div>
    </section>

    <section class="section">
      <div class="section-head"><div class="h3">🧪 Diagnostica del dispositivo</div></div>
      <div class="card">
        ${diag.rows.map((r) => `<div class="switch-row" style="border:0;padding:9px 0">
          <span class="sr-text"><span class="sr-title">${esc(r.label)}</span><span class="sr-desc">${esc(r.note)}</span></span>
          <span>${r.ok ? '✅' : '⚪'}</span>
        </div>`).join('')}
        <div class="divider"></div>
        <p class="label">Limiti reali delle notifiche</p>
        <p class="muted" style="font-size:13.5px">
          Una PWA senza server push non può garantire avvisi puntuali a app chiusa. LifeOS lo dice apertamente:
          i promemoria scattano mentre l'app è aperta o quando la riporti in primo piano; alla riapertura trovi
          il riepilogo di quelli scaduti. Su iPhone servono iOS 16.4+ e l'app aggiunta alla schermata Home.
        </p>
      </div>
    </section>

    <section class="section">
      <div class="section-head"><div class="h3">🗂️ Struttura del progetto</div></div>
      <div class="card">
        <pre style="font-size:11.5px;line-height:1.7;background:var(--card-2);padding:12px;border-radius:12px;overflow:auto;white-space:pre">lifeos/
├── index.html            guscio dell'app
├── manifest.json         identità PWA
├── service-worker.js     cache offline
├── offline.html          fallback offline
├── css/styles.css        design system + temi
├── icons/                icone 192/512/maskable
└── js/
    ├── app.js            avvio, route, temi, install
    ├── db.js             IndexedDB versionato
    ├── store.js          dati, cache, eventi
    ├── editors.js        editor di ogni tipo
    ├── fields.js         sistema di campi
    ├── ui.js             componenti UI
    ├── voice.js          Web Speech API
    ├── notifications.js  notifiche locali
    ├── reminders.js      motore promemoria
    ├── recur.js          ricorrenze
    ├── search.js         ricerca e filtri
    ├── backup.js         export/import JSON
    ├── ai/parser.js      parser italiano a regole
    ├── ai/adapter.js     innesto per un modello AI
    └── views/            una vista per sezione</pre>
      </div>
    </section>
  `;
  return { title: 'Informazioni', sub: '', html, mount: (ctx) => bindAbout(ctx) };
}

function bindAbout(ctx) {
  onClick(ctx.root, '[data-install]', async () => {
    const ok = await installPrompt();
    if (!ok) toast('Usa il menu del browser: "Installa app"', 3600);
  });
}
