/* ==========================================================================
   LifeOS — views/reminders.js
   Elenco dei promemoria (imminenti e già inviati) + pannello di controllo
   onesto su permessi e limiti reali delle notifiche web.
   ========================================================================== */

import { pendingReminders, list, byId, save, _state, getSetting, setSetting } from '../store.js';
import { esc, fmtDate, offsetLabel, relTime, nowISO, sortBy } from '../utils.js';
import { qs, onClick, emptyState, toast, actionSheet, node } from '../ui.js';
import { checkNow, reschedule } from '../reminders.js';
import {
  permissionState, requestPermission, notificationsSupported, diagnostics,
  testNotification, showNotification
} from '../notifications.js';
import { openEditor } from '../editors.js';

export function render() {
  const now = new Date();
  const upcoming = pendingReminders(now);
  const fired = sortBy(_state.reminders.filter((r) => r.fired), (r) => new Date(r.firedAt || r.at).getTime(), -1).slice(0, 25);
  const overdueUnfired = _state.reminders.filter((r) => !r.fired && !r.done && new Date(r.at) < now);

  const perm = permissionState();
  const diag = diagnostics();
  const gran = Number(getSetting('notifyGranularityMin', 15));

  const html = `
    <div class="page-head">
      <div class="h1">Promemoria</div>
      <div class="muted">${upcoming.length} programmati${overdueUnfired.length ? ` · ${overdueUnfired.length} da inviare` : ''}${fired.length ? ` · ${fired.length} già inviati` : ''}</div>
    </div>

    <div class="card">
      <div style="display:flex;align-items:center;gap:10px">
        <span style="font-size:26px">${perm === 'granted' ? '🔔' : perm === 'denied' ? '🔕' : '🔕'}</span>
        <div style="flex:1">
          <div style="font-weight:750">Notifiche ${perm === 'granted' ? 'attive' : perm === 'denied' ? 'bloccate' : 'non attive'}</div>
          <div class="dim">${esc(permLabel(perm))}</div>
        </div>
      </div>
      <div class="btn-row" style="margin-top:12px">
        ${perm === 'granted'
          ? '<button class="btn sm ok" data-test>📨 Notifica di prova</button>'
          : '<button class="btn sm primary" data-ask>🔔 Attiva notifiche</button>'}
        <button class="btn sm" data-check>🔄 Controlla ora</button>
      </div>
      ${diag.advice ? `<p class="mic-hint" style="margin-top:10px">${esc(diag.advice)}</p>` : ''}
    </div>

    <div class="warn-box" style="margin-top:14px">
      <b>Come funzionano davvero i promemoria</b><br>
      LifeOS non ha un server: i promemoria vengono controllati mentre l'app è aperta o quando la riporti in primo piano.
      Se il telefono sospende l'app (schermo spento, app chiusa dal sistema), nessun browser può garantire un avviso puntuale.
      Alla riapertura trovi comunque il riepilogo di ciò che è scaduto nel frattempo.
      ${diag.isIOS && !diag.standalone ? '<br><br><b>Su iPhone:</b> le notifiche funzionano solo dopo aver aggiunto LifeOS alla schermata Home (iOS 16.4 o superiore).' : ''}
    </div>

    ${overdueUnfired.length ? `<section class="section">
      <div class="section-head"><div class="h3">⚠️ Da inviare <span class="count">${overdueUnfired.length}</span></div>
        <button class="link-btn" data-send-all>Invia ora</button></div>
      ${overdueUnfired.map((r) => reminderRow(r, true)).join('')}
    </section>` : ''}

    <section class="section">
      <div class="section-head"><div class="h3">⏭️ Imminenti <span class="count">${upcoming.length}</span></div></div>
      ${upcoming.length ? upcoming.slice(0, 40).map((r) => reminderRow(r, false)).join('')
        : emptyState('🔔', 'Nessun promemoria programmato', 'Aggiungi promemoria agli eventi o alle attività: puoi metterne quanti vuoi (es. 14 giorni, 1 giorno, 2 ore, 30 minuti prima).')}
    </section>

    ${fired.length ? `<section class="section">
      <div class="section-head"><div class="h3">✅ Già inviati <span class="count">${fired.length}</span></div></div>
      ${fired.slice(0, 15).map((r) => reminderRow(r, false, true)).join('')}
    </section>` : ''}

    <section class="section">
      <div class="section-head"><div class="h3">⚙️ Impostazioni promemoria</div></div>
      <div class="card">
        <label class="label">Frequenza controllo (minuti)</label>
        <div class="input-voice">
          <input class="input" type="number" min="1" max="120" value="${gran}" data-gran />
          <button class="btn sm" data-gran-save>Salva</button>
        </div>
        <p class="mic-hint">Con quale frequenza LifeOS verifica i promemoria mentre è aperto. Valori bassi consumano più batteria.</p>
        <div class="divider"></div>
        <div class="switch-row" style="border:0">
          <span class="sr-text">
            <span class="sr-title">Notifiche abilitate</span>
            <span class="sr-desc">Stato salvato nelle preferenze dell'app.</span>
          </span>
          <span class="switch"><input type="checkbox" data-notif-switch ${getSetting('notificationsEnabled', false) ? 'checked' : ''}><span class="track"></span></span>
        </div>
      </div>
    </section>
  `;

  return { title: 'Promemoria', sub: `${upcoming.length} programmati`, html, mount: (ctx) => bind(ctx) };
}

function permLabel(p) {
  if (!notificationsSupported()) return 'Questo browser non espone l\'API Notification';
  if (p === 'granted') return 'Il sistema può mostrare gli avvisi di LifeOS';
  if (p === 'denied') return 'Permesso negato: riabilitalo dalle impostazioni del sito';
  return 'Tocca "Attiva notifiche" per concedere il permesso';
}

function reminderRow(r, overdue = false, fired = false) {
  const ref = r.refType === 'task' ? byId('tasks', r.refId) : r.refType === 'event' ? byId('events', r.refId) : byId('goals', r.refId);
  return `<div class="row ${overdue ? 'overdue' : ''}" data-rem="${esc(r.id)}" style="${fired ? 'opacity:.55' : ''}">
    <span class="row-bar" style="background:${overdue ? 'var(--danger)' : r.refType === 'event' ? 'var(--accent)' : r.refType === 'task' ? 'var(--ok)' : 'var(--warn)'}"></span>
    <div class="row-body">
      <div class="row-title" style="font-size:14.5px">${r.refType === 'event' ? '📅' : r.refType === 'task' ? '✅' : '🎯'} ${esc(r.title || 'Promemoria')}</div>
      <div class="row-sub">
        <span>🔔 ${esc(offsetLabel(r.offsetMin))}</span>
        <span>${esc(fmtDate(r.at, 'datetime'))}</span>
        ${fired && r.firedAt ? `<span>inviato ${esc(relTime(r.firedAt))}</span>` : `<span>${esc(relTime(r.at))}</span>`}
      </div>
    </div>
    <div class="row-right">${ref ? `<span class="dim">›</span>` : ''}</div>
  </div>`;
}

function bind(ctx) {
  const root = ctx.root;

  onClick(root, '[data-ask]', async () => {
    const perm = await requestPermission();
    if (perm === 'granted') {
      await setSetting('notificationsEnabled', true);
      toast('Notifiche attive ✅');
    }
    ctx.refresh();
  });

  onClick(root, '[data-test]', async () => {
    const ok = await testNotification();
    toast(ok ? 'Notifica inviata' : 'Invio non riuscito: controlla i permessi', 3200);
  });

  onClick(root, '[data-check]', async () => {
    const n = await checkNow();
    toast(n ? `${n} promemoria inviati` : 'Nessun promemoria in scadenza');
    ctx.refresh();
  });

  onClick(root, '[data-send-all]', async () => {
    const now = new Date();
    const due = _state.reminders.filter((r) => !r.fired && !r.done && new Date(r.at) <= now);
    for (const r of due.slice(0, 6)) {
      await showNotification(r.title || 'Promemoria', `🔔 ${offsetLabel(r.offsetMin)} · ${fmtDate(r.at, 'datetime')}`, { tag: r.id, url: r.url });
      await save('reminders', { id: r.id, fired: true, firedAt: nowISO() });
    }
    toast(due.length ? `${Math.min(due.length, 6)} promemoria inviati` : 'Nulla da inviare');
    ctx.refresh();
  });

  onClick(root, '[data-gran-save]', async () => {
    const val = Number(qs('[data-gran]', root).value) || 15;
    await setSetting('notifyGranularityMin', Math.max(1, Math.min(120, val)));
    reschedule();
    toast('Frequenza aggiornata');
  });

  qs('[data-notif-switch]', root)?.addEventListener('change', async (e) => {
    if (e.target.checked) {
      const perm = await requestPermission();
      if (perm !== 'granted') { e.target.checked = false; await setSetting('notificationsEnabled', false); return; }
    }
    await setSetting('notificationsEnabled', e.target.checked);
    toast(e.target.checked ? 'Notifiche abilitate' : 'Notifiche disabilitate');
  });

  onClick(root, '[data-rem]', async (el, e) => {
    if (e.target.closest('button')) return;
    const r = _state.reminders.find((x) => x.id === el.dataset.rem);
    if (!r) return;
    const refStore = r.refType === 'task' ? 'task' : r.refType === 'event' ? 'event' : 'goal';
    const choice = await actionSheet(r.title || 'Promemoria', [
      { label: 'Apri elemento', icon: '📂', value: 'open' },
      { label: r.fired ? 'Segna come non inviato' : 'Segna come inviato', icon: '🔁', value: 'toggle' },
      { label: 'Invia notifica adesso', icon: '📨', value: 'notify' }
    ]);
    if (choice === 'open') { openEditor(refStore, r.refId, () => ctx.refresh()); return; }
    if (choice === 'toggle') { await save('reminders', { id: r.id, fired: !r.fired, firedAt: r.fired ? null : nowISO() }); ctx.refresh(); return; }
    if (choice === 'notify') {
      await showNotification(r.title || 'Promemoria', `🔔 ${offsetLabel(r.offsetMin)}`, { tag: r.id, url: r.url });
      toast('Notifica inviata');
    }
  });
}
