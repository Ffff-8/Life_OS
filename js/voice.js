/* ==========================================================================
   LifeOS — voice.js
   Dettatura tramite Web Speech API (SpeechRecognition / webkitSpeechRecognition).

   ONESTÀ TECNICA (importante, non fingere che funzioni sempre):
   - Chrome/Edge (Android e desktop) e Safari iOS 16.4+ (installata in Home)
     espongono l'API. Firefox NON la implementa.
   - Il riconoscimento può richiedere la rete (Chrome invia l'audio ai server
     Google): in modalità offline può non funzionare.
   - Su iOS l'API può interrompersi dopo pochi secondi: gestiamo riavvio
     automatico e stop manuale.
   Se l'API non c'è, l'app mostra un avviso chiaro e il campo resta scrivibile.
   ========================================================================== */

import { toast } from './ui.js';

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

export const speechSupported = Boolean(SR);
export const synthSupported = Boolean(window.speechSynthesis);

export function speechStatus() {
  if (speechSupported) return { ok: true, label: 'Dettatura disponibile' };
  const ua = navigator.userAgent;
  const ff = /Firefox/i.test(ua);
  const ios = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  return {
    ok: false,
    label: ff
      ? 'Firefox non supporta la dettatura vocale: scrivi il testo a mano.'
      : ios
        ? 'Su iPhone la dettatura richiede iOS 16.4+ e l\'app installata nella schermata Home.'
        : 'Questo browser non espone la Web Speech API: scrivi il testo a mano.'
  };
}

export function langCode() {
  const l = (navigator.language || 'it-IT');
  return /^it/i.test(l) ? 'it-IT' : l;
}

/**
 * Crea un oggetto di riconoscimento configurato.
 * @param {{continuous?:boolean, interim?:boolean}} opts
 */
function createRecognition(opts = {}) {
  if (!SR) return null;
  const rec = new SR();
  rec.lang = langCode();
  rec.continuous = opts.continuous !== false;
  rec.interimResults = opts.interim !== false;
  rec.maxAlternatives = 1;
  return rec;
}

/**
 * Dictation: gestisce l'intero ciclo di vita di una sessione di dettatura.
 *
 * @param {object} cfg
 * @param {(text:string, isFinal:boolean)=>void} cfg.onText aggiorna il campo
 * @param {()=>void} [cfg.onStart]
 * @param {(reason:string)=>void} [cfg.onEnd]
 * @param {()=>void} [cfg.onError]
 * @returns {{stop:Function, cancel:Function, active:()=>boolean, supported:boolean}}
 */
export function dictation(cfg) {
  if (!SR) {
    cfg.onEnd?.('unsupported');
    toast('Dettatura non disponibile: scrivi il testo a mano', 3200);
    return { stop() {}, cancel() {}, active: () => false, supported: false };
  }

  const rec = createRecognition({ continuous: true, interim: true });
  let finalText = '';
  let stoppedByUser = false;
  let active = false;
  let restartTimer = null;
  let gotResult = false;

  rec.onstart = () => { active = true; cfg.onStart?.(); };
  rec.onaudiostart = () => { active = true; };

  rec.onresult = (event) => {
    gotResult = true;
    let interim = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const res = event.results[i];
      const txt = res[0]?.transcript || '';
      if (res.isFinal) finalText += (finalText && !/\s$/.test(finalText) ? ' ' : '') + txt.trim();
      else interim += txt;
    }
    const live = (finalText + ' ' + interim).trim();
    cfg.onText?.(live, false);
    if (finalText) cfg.onText?.(finalText.trim(), true);
  };

  rec.onerror = (e) => {
    // "no-speech"/"aborted" sono normali (timeout o stop manuale)
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
      active = false;
      cfg.onError?.(e.error);
      toast('Permesso microfono negato: abilitalo nelle impostazioni del browser', 3600);
      cfg.onEnd?.('denied');
      stoppedByUser = true;
      return;
    }
    if (e.error === 'no-speech') { return; }
    if (e.error === 'audio-capture') {
      toast('Nessun microfono rilevato', 3000);
      cfg.onEnd?.('no-mic');
      stoppedByUser = true;
      return;
    }
    if (e.error === 'network') {
      toast('Dettatura non disponibile offline: riprova con la connessione attiva', 3600);
      cfg.onEnd?.('network');
      stoppedByUser = true;
      return;
    }
    // altri errori: non interrompere l'esperienza
    console.warn('[voice] errore riconoscimento:', e.error);
  };

  rec.onend = () => {
    active = false;
    if (stoppedByUser) { cfg.onEnd?.('stopped'); return; }
    // Riavvio: Chrome e iOS terminano la sessione dopo una pausa
    if (cfg.autoRestart !== false) {
      restartTimer = setTimeout(() => {
        try { rec.start(); } catch (e) { cfg.onEnd?.('error'); }
      }, 320);
    } else {
      cfg.onEnd?.('ended');
    }
  };

  try {
    rec.start();
  } catch (e) {
    cfg.onEnd?.('error');
    return { stop() {}, cancel() {}, active: () => false, supported: true };
  }

  return {
    supported: true,
    active: () => active,
    stop() { // interrompe e mantiene il testo
      stoppedByUser = true;
      clearTimeout(restartTimer);
      try { rec.stop(); } catch (e) {}
      cfg.onEnd?.(gotResult ? 'done' : 'empty');
    },
    cancel() { // interrompe e scarta
      stoppedByUser = true;
      clearTimeout(restartTimer);
      try { rec.abort(); } catch (e) {}
      cfg.onEnd?.('cancelled');
    }
  };
}

/* ------------------ INTEGRAZIONE CON I CAMPI (mic-btn) ------------------ */

/**
 * Attiva la dettatura per tutti i pulsanti [data-mic] dentro `root`.
 * Il testo viene ACCODATO al contenuto esistente del campo collegato.
 * @param {HTMLElement} root
 * @param {{placeholderTarget?:HTMLElement}} [opts]
 */
export function attachMics(root, opts = {}) {
  const status = speechStatus();
  root.querySelectorAll('[data-mic]').forEach((btn) => {
    if (btn.dataset.micBound === '1') return;
    btn.dataset.micBound = '1';

    if (!status.ok) {
      btn.style.opacity = '.45';
      btn.title = status.label;
      btn.setAttribute('aria-disabled', 'true');
    }

    let session = null;

    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();

      if (session) { session.stop(); session = null; return; }

      if (!status.ok) { toast(status.label, 4200); return; }

      const key = btn.dataset.mic;
      const field = root.querySelector(`[data-field="${CSS.escape(key)}"]`);
      if (!field) return;

      const base = field.value ? String(field.value).trimEnd() + ' ' : '';
      let hint = null;

      session = dictation({
        onText: (text) => {
          field.value = (base + text).replace(/\s{2,}/g, ' ');
          field.dispatchEvent(new Event('input', { bubbles: true }));
          field.dispatchEvent(new Event('change', { bubbles: true }));
        },
        onStart: () => {
          btn.classList.add('rec');
          btn.textContent = '⏹';
          hint = document.createElement('div');
          hint.className = 'voice-live';
          hint.textContent = '🎙️ In ascolto… parla ora (tocca ⏹ per fermare)';
          field.parentElement?.insertAdjacentElement('afterend', hint);
        },
        onEnd: () => {
          btn.classList.remove('rec');
          btn.textContent = '🎤';
          hint?.remove();
          session = null;
        }
      });
    });
  });
}

/* ---------------------------- SINTESI VOCALE ---------------------------- */
/** Legge un testo ad alta voce (solo se disponibile). */
export function speak(text) {
  if (!synthSupported) { toast('Sintesi vocale non disponibile', 2600); return false; }
  try {
    const u = new SpeechSynthesisUtterance(String(text).slice(0, 900));
    u.lang = langCode();
    u.rate = 1.02;
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
    return true;
  } catch (e) { return false; }
}

/** Verifica/richiede il permesso microfono (se l'API dei permessi esiste). */
export async function requestMicPermission() {
  try {
    if (navigator.permissions?.query) {
      const st = await navigator.permissions.query({ name: 'microphone' });
      return st.state; // 'granted' | 'prompt' | 'denied'
    }
  } catch (e) { /* alcuni browser non supportano la query */ }
  return 'unknown';
}

/**
 * Chiede l'accesso al microfono aprendo un flusso audio reale:
 * è il modo più affidabile per far comparire il prompt di sistema.
 */
export async function ensureMicAccess() {
  if (!navigator.mediaDevices?.getUserMedia) return { ok: true, reason: 'no-getusermedia' };
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop());
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: e?.name || 'error' };
  }
}
