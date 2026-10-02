/* ==========================================================================
   LifeOS — views/voice.js
   "Parla con LifeOS": dettatura libera, analisi locale del testo e
   salvataggio nel tipo più probabile (o scelta manuale).
   ========================================================================== */

import { list, save, getSetting } from '../store.js';
import { esc, capitalize, nowISO, dayKey, fmtDate } from '../utils.js';
import { qs, onClick, toast, sheet, node, emptyState } from '../ui.js';
import { dictation, speechStatus, ensureMicAccess, speak, synthSupported } from '../voice.js';
import { interpret, capabilities } from '../ai/adapter.js';

let session = null;
let transcript = '';
let lastAnalysis = null;

export function render({ params }) {
  const target = params.target || '';
  const status = speechStatus();
  const ai = capabilities();

  const html = `
    <div class="page-head">
      <div class="h1">Parla con LifeOS</div>
      <div class="muted">${target ? `Dettatura per: <b>${esc(target)}</b>` : 'Dettà un pensiero: capisco se è un\'evento, un\'attività, un\'idea, una nota o un diario.'}</div>
    </div>

    ${!status.ok ? `<div class="warn-box">🎤 ${esc(status.label)}<br><br>Puoi comunque <b>scrivere</b> il testo qui sotto: il pulsante "+" e gli editor hanno tutti i campi scrivibili.</div>` : ''}

    <div class="voice-hero">
      <button class="voice-orb" id="orb" aria-label="Avvia o ferma la dettatura">🎙️</button>
      <div id="orb-label" class="muted">${status.ok ? 'Tocca il microfono e parla' : 'Dettatura non disponibile: scrivi qui sotto'}</div>
    </div>

    <div class="field">
      <label class="label">Testo (modificabile)</label>
      <textarea class="textarea" id="voice-text" placeholder="Es. Lunedì devo studiare Analisi II per almeno due ore…">${esc(transcript)}</textarea>
    </div>

    <div class="btn-row" style="margin-bottom:12px">
      <button class="btn primary" data-analyze style="flex:1">✨ Analizza e salva</button>
      <button class="btn" data-clear>🗑️</button>
      ${synthSupported ? '<button class="btn" data-read aria-label="Leggi ad alta voce">🔊</button>' : ''}
    </div>

    <div id="analysis"></div>

    <section class="section">
      <div class="section-head"><div class="h3">💡 Esempi che funzionano bene</div></div>
      <div class="chips">
        ${[
          'Lunedì devo studiare Analisi II per almeno due ore',
          'Giovedì alle 15 ho il dentista, ricordami un giorno prima',
          'Idea: prototipo Godot con generazione procedurale',
          'Nota: il professore ha spostato l\'esame al 15 ottobre',
          'Oggi mi sento stanco ma soddisfatto',
          'Riunione con il gruppo progetto ogni martedì alle 18'
        ].map((ex) => `<button class="chip" data-example="${esc(ex)}">"${esc(ex)}"</button>`).join('')}
      </div>
      <p class="mic-hint" style="margin-top:10px">
        Motore attivo: <b>${esc(ai.provider === 'remote' ? 'modello AI collegato' : 'parser locale a regole')}</b>.
        Tutto avviene sul dispositivo: nessun testo viene inviato a servizi esterni in questa configurazione.
      </p>
    </section>

    <section class="section">
      <div class="section-head"><div class="h3">🕘 Testo salvato di recente dalla voce</div></div>
      ${recentVoice()}
    </section>
  `;

  return { title: 'Parla con LifeOS', sub: 'Dettatura e analisi', html, mount: (ctx) => bind(ctx, target) };
}

function recentVoice() {
  const items = [
    ...list('notes').filter((n) => n.source === 'voice').map((n) => ({ t: 'Nota', title: n.title, at: n.createdAt })),
    ...list('ideas').map((n) => ({ t: 'Idea', title: n.title, at: n.createdAt })),
    ...list('inbox').filter((i) => i.source === 'voice').map((n) => ({ t: 'Inbox', title: n.text, at: n.createdAt }))
  ].sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, 5);
  if (!items.length) return `<p class="dim">Ancora nessun elemento creato con la voce.</p>`;
  return items.map((i) => `<div class="row" style="align-items:center">
    <div class="row-body">
      <div class="row-title" style="font-size:14.5px">${esc(i.t)}: ${esc(String(i.title || '').slice(0, 70))}</div>
      <div class="row-sub"><span>${esc(fmtDate(i.at, 'datetime'))}</span></div>
    </div>
  </div>`).join('');
}

function bind(ctx, target) {
  const root = ctx.root;
  const orb = qs('#orb', root);
  const orbLabel = qs('#orb-label', root);
  const ta = qs('#voice-text', root);
  const analysisBox = qs('#analysis', root);

  ta.addEventListener('input', () => { transcript = ta.value; });

  onClick(root, '[data-example]', (el) => {
    ta.value = el.dataset.example;
    transcript = ta.value;
    toast('Esempio inserito: tocca "Analizza e salva"');
  });

  onClick(root, '[data-clear]', () => { ta.value = ''; transcript = ''; analysisBox.innerHTML = ''; lastAnalysis = null; orbLabel.textContent = 'Pronto'; });

  onClick(root, '[data-read]', () => {
    if (!ta.value.trim()) { toast('Niente da leggere'); return; }
    speak(ta.value);
  });

  orb.addEventListener('click', async () => {
    if (session) { session.stop(); return; }
    const st = speechStatus();
    if (!st.ok) { toast(st.label, 4200); return; }

    // 1) permesso microfono: apriamo un flusso reale per far comparire il prompt
    const access = await ensureMicAccess();
    if (!access.ok && access.reason === 'NotAllowedError') {
      toast('Permesso microfono negato: abilitalo nelle impostazioni del sito', 4200);
      return;
    }

    // 2) avvia la dettatura
    transcript = ta.value ? ta.value.trimEnd() + ' ' : '';
    session = dictation({
      onText: (text, isFinal) => {
        ta.value = (transcript + text).replace(/\s{2,}/g, ' ');
        if (isFinal) transcript = ta.value.trimEnd() + ' ';
        orbLabel.textContent = '🎙️ In ascolto… tocca per fermare';
      },
      onStart: () => { orb.classList.add('rec'); orb.textContent = '⏹'; orbLabel.textContent = '🎙️ In ascolto… parla ora'; },
      onEnd: () => {
        orb.classList.remove('rec'); orb.textContent = '🎙️';
        orbLabel.textContent = ta.value.trim() ? 'Dettatura terminata: controlla il testo e analizza' : 'Nessun testo rilevato: riprova';
        session = null;
      },
      onError: () => { orb.classList.remove('rec'); orb.textContent = '🎙️'; session = null; }
    });
  });

  onClick(root, '[data-analyze]', async () => {
    const text = (ta.value || '').trim();
    if (!text) { toast('Scrivi o detta prima qualcosa'); ta.focus(); return; }

    const a = await interpret(text, { categories: list('categories') });
    lastAnalysis = a;

    analysisBox.innerHTML = analysisHtml(a);
    const mountAnalysis = analysisBox;

    // se siamo arrivati da una vista specifica (es. "dettà una nota"), salta l'analisi
    if (target) {
      await quickSave(target, text, a, ctx);
      return;
    }

    onClick(mountAnalysis, '[data-save-as]', async (el) => {
      const type = el.dataset.saveAs;
      await quickSave(type, text, a, ctx);
    });

    onClick(mountAnalysis, '[data-open-editor]', async (el) => {
      const type = el.dataset.openEditor;
      const { openEditor } = await import('../editors.js');
      const preset = presetFor(type, text, a);
      ta.value = ''; transcript = '';
      await openEditor(type, null, () => { analysisBox.innerHTML = ''; ctx.refresh(); }, preset);
    });

    onClick(mountAnalysis, '[data-details]', () => showDetails(a));
  });
}

function analysisHtml(a) {
  const typeLabel = { event: '📅 Evento', task: '✅ Attività', idea: '💡 Idea', note: '📝 Nota', journal: '📖 Diario', inbox: '📥 Inbox', goal: '🎯 Obiettivo' };
  const conf = Math.round((a.confidence || 0) * 100);
  const cats = list('categories');
  const cat = cats.find((c) => c.id === a.entities.categoryId);

  return `<div class="card" style="border-color:var(--accent)">
    <div style="display:flex;align-items:center;gap:10px">
      <span style="font-size:24px">${(typeLabel[a.intent] || '📥').slice(0, 2)}</span>
      <div style="flex:1">
        <div style="font-weight:750">${esc((typeLabel[a.intent] || 'Inbox').slice(3) || 'Inbox')}</div>
        <div class="dim">${esc(a.suggestion)}</div>
      </div>
      <span class="badge ${conf > 60 ? 'done' : 'normal'}">${conf}%</span>
    </div>

    <div class="divider"></div>

    <div style="font-size:14.5px;line-height:1.6">
      <div><b>Titolo:</b> ${esc(a.title)}</div>
      ${a.entities.when ? `<div><b>Quando:</b> ${esc(fmtDate(a.entities.when, 'full'))} alle ${esc(fmtDate(a.entities.when, 'time'))}</div>` : '<div class="dim">Nessuna data riconosciuta</div>'}
      ${a.entities.durationMin ? `<div><b>Durata:</b> ${a.entities.durationMin} minuti</div>` : ''}
      ${a.entities.priority ? `<div><b>Priorità:</b> ${a.entities.priority === 'urgent' ? '🔴 urgente' : a.entities.priority === 'low' ? '🔵 bassa' : '🟡 normale'}</div>` : ''}
      ${cat ? `<div><b>Categoria:</b> ${cat.icon} ${esc(cat.name)}</div>` : ''}
      ${a.entities.location ? `<div><b>Luogo:</b> ${esc(a.entities.location)}</div>` : ''}
      ${(a.entities.tags || []).length ? `<div><b>Tag:</b> ${a.entities.tags.map((t) => '#' + esc(t)).join(' ')}</div>` : ''}
      ${a.entities.recurrence ? `<div><b>Ricorrenza:</b> 🔁 ${esc(a.entities.recurrence.freq)}</div>` : ''}
    </div>

    <div class="divider"></div>

    <p class="label">Salva come</p>
    <div class="btn-row">
      <button class="btn sm primary" data-save-as="${esc(a.intent === 'inbox' ? 'inbox' : a.intent)}">✓ ${esc((typeLabel[a.intent] || 'Inbox').slice(3) || 'Inbox')}</button>
      <button class="btn sm" data-save-as="task">✅ Attività</button>
      <button class="btn sm" data-save-as="note">📝 Nota</button>
      <button class="btn sm" data-save-as="idea">💡 Idea</button>
      <button class="btn sm" data-save-as="event">📅 Evento</button>
      <button class="btn sm" data-save-as="journal">📖 Diario</button>
      <button class="btn sm" data-save-as="inbox">📥 Inbox</button>
    </div>
    <div class="btn-row" style="margin-top:9px">
      <button class="btn sm ghost" data-open-editor="${esc(a.intent === 'inbox' ? 'note' : a.intent)}">✏️ Modifica prima di salvare</button>
      <button class="btn sm ghost" data-details>🔍 Dettagli analisi</button>
    </div>
    <p class="mic-hint">Il parser locale può sbagliare: controlla data e tipo, e correggi con "Modifica prima di salvare".</p>
  </div>`;
}

function presetFor(type, text, a) {
  const base = {
    title: a.title,
    text,
    description: text,
    name: a.title,
    due: a.entities.when,
    start: a.entities.when,
    priority: a.entities.priority || 'normal',
    categoryId: a.entities.categoryId || '',
    tags: a.entities.tags || [],
    estimateMin: a.entities.durationMin,
    mood: 3,
    date: dayKey(new Date())
  };
  if (type === 'journal') { base.text = text; base.tags = a.entities.tags || []; }
  return base;
}

async function quickSave(type, text, a, ctx) {
  const storeOf = { task: 'tasks', event: 'events', note: 'notes', idea: 'ideas', journal: 'journal', inbox: 'inbox' };
  const store = storeOf[type];
  if (!store) { toast('Tipo non valido'); return; }

  const base = { createdAt: nowISO(), tags: a.entities.tags || [], categoryId: a.entities.categoryId || '', source: 'voice' };

  let payload;
  if (type === 'task') {
    payload = { ...base, title: a.title, description: text, due: a.entities.when, priority: a.entities.priority || 'normal', status: 'todo', estimateMin: a.entities.durationMin, reminders: getSetting('defaultRemindersTask', [60]), recurrence: a.entities.recurrence };
  } else if (type === 'event') {
    payload = { ...base, title: a.title, description: text, start: a.entities.when || new Date(Date.now() + 3600000).toISOString(), durationMin: a.entities.durationMin || 60, location: a.entities.location || '', priority: a.entities.priority || 'normal', reminders: getSetting('defaultRemindersEvent', [1440, 120, 30]), recurrence: a.entities.recurrence };
    payload.end = new Date(new Date(payload.start).getTime() + payload.durationMin * 60000).toISOString();
  } else if (type === 'note') {
    payload = { ...base, title: a.title, text, favorite: false, archived: false, attachments: [] };
  } else if (type === 'idea') {
    payload = { ...base, title: a.title, description: text, status: 'idea', importance: 3, feasibility: 3, rating: 3, notes: '' };
  } else if (type === 'journal') {
    payload = { ...base, text, mood: 3, date: dayKey(new Date()), time: nowISO() };
  } else {
    payload = { ...base, text, processed: false };
  }

  try {
    await save(store, payload);
    toast(`Salvato in ${type} ✅`, 2400);
    transcript = '';
    ctx.refresh();
  } catch (e) {
    toast('Salvataggio non riuscito: ' + (e.message || e), 3600);
  }
}

function showDetails(a) {
  const scores = Object.entries(a.scores || {}).sort((x, y) => y[1] - x[1]);
  const body = node(`<div>
    <p class="muted">Analisi locale, nessun modello esterno coinvolto.</p>
    <div class="divider"></div>
    <p class="label">Punteggi per intento</p>
    ${scores.map(([k, v]) => `<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border)">
      <span>${esc(k)}</span><b>${v}</b></div>`).join('')}
    <div class="divider"></div>
    <p class="label">Entità estratte</p>
    <pre style="font-size:12px;background:var(--card-2);padding:11px;border-radius:12px;overflow:auto;white-space:pre-wrap">${esc(JSON.stringify(a.entities, null, 2))}</pre>
    <p class="mic-hint">${esc(a.provider === 'remote' ? 'Interpretazione fornita da un provider remoto configurato.' : 'Parser a regole italiano: date, orari, durate, priorità, ricorrenze e hashtag.')}</p>
  </div>`);
  sheet({ title: '🔍 Dettagli analisi', body });
}
