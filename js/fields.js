/* ==========================================================================
   LifeOS — fields.js
   Sistema di campi riutilizzabile (punto 11 della specifica):
   Sì/No · checkbox · stelle 1–5 · voto 0–10 · slider · selezione singola ·
   selezione multipla · menu a tendina · testo · numero · data/ora · colore · tag.

   Ogni campo è descritto da un oggetto:
   {
     key, label, type, value,
     options: [{value,label}] | string[],
     min, max, step, placeholder, help, required
   }
   renderFields() produce l'HTML, bindFields() collega gli eventi e
   collectFields() restituisce i valori correnti.
   ========================================================================== */

import { esc, clamp } from './utils.js';
import { qs, qsa } from './ui.js';

/* ---------------------- TIPI DISPONIBILI (metadati) --------------------- */
export const FIELD_TYPES = [
  { type: 'text', label: 'Testo breve' },
  { type: 'textarea', label: 'Testo lungo' },
  { type: 'yesno', label: 'Sì / No' },
  { type: 'checkbox', label: 'Casella di spunta' },
  { type: 'stars', label: 'Stelle (1–5)' },
  { type: 'rating10', label: 'Voto numerico (0–10)' },
  { type: 'slider', label: 'Slider' },
  { type: 'select', label: 'Selezione singola' },
  { type: 'multiselect', label: 'Selezione multipla' },
  { type: 'dropdown', label: 'Menu a tendina' },
  { type: 'number', label: 'Numero' },
  { type: 'date', label: 'Data' },
  { type: 'datetime', label: 'Data e ora' },
  { type: 'color', label: 'Colore' },
  { type: 'tags', label: 'Tag' }
];

const uidc = () => 'f' + Math.random().toString(36).slice(2, 9);

/* ---------------------------- RENDER ------------------------------------ */
/**
 * Genera l'HTML per una lista di campi.
 * @param {Array} fields
 * @param {{cols?:number}} opts
 */
export function renderFields(fields, opts = {}) {
  return fields.map((f) => renderField(f, opts)).join('');
}

export function renderField(f, opts = {}) {
  const id = f.id || uidc();
  const v = f.value;
  const label = f.label ? `<label class="label" for="${id}">${esc(f.label)}${f.required ? ' *' : ''}</label>` : '';
  const help = f.help ? `<p class="mic-hint">${esc(f.help)}</p>` : '';
  let control = '';

  switch (f.type) {
    case 'textarea':
      control = `<div class="input-voice">
        <textarea class="textarea" id="${id}" data-field="${esc(f.key)}" placeholder="${esc(f.placeholder || '')}" ${f.voice === false ? '' : 'data-voice="soft"'}>${esc(v || '')}</textarea>
        ${f.voice === false ? '' : `<button type="button" class="mic-btn" data-mic="${esc(f.key)}" aria-label="Dettatura vocale: ${esc(f.label || f.key)}">🎤</button>`}
      </div>`;
      break;

    case 'text':
      control = `<div class="input-voice">
        <input class="input" id="${id}" data-field="${esc(f.key)}" value="${esc(v || '')}" placeholder="${esc(f.placeholder || '')}" />
        ${f.voice === false ? '' : `<button type="button" class="mic-btn" data-mic="${esc(f.key)}" aria-label="Dettatura vocale: ${esc(f.label || f.key)}">🎤</button>`}
      </div>`;
      break;

    case 'yesno': {
      control = `<div class="chips" data-field="${esc(f.key)}" data-kind="yesno">
        <button type="button" class="chip ${v === true ? 'on' : ''}" data-val="yes">✓ Sì</button>
        <button type="button" class="chip ${v === false ? 'on' : ''}" data-val="no">✕ No</button>
      </div>`;
      break;
    }

    case 'checkbox':
      control = `<div class="switch-row" style="border:0;padding:0">
        <span class="sr-text"><span class="sr-title">${esc(f.checkLabel || f.label || '')}</span></span>
        <span class="switch"><input type="checkbox" data-field="${esc(f.key)}" ${v ? 'checked' : ''}><span class="track"></span></span>
      </div>`;
      break;

    case 'stars': {
      const n = clamp(Number(v) || 0, 0, 5);
      control = `<div class="stars" data-field="${esc(f.key)}" data-kind="stars">
        ${[1, 2, 3, 4, 5].map((i) => `<button type="button" class="star ${i <= n ? 'on' : ''}" data-val="${i}">★</button>`).join('')}
      </div>`;
      break;
    }

    case 'rating10': {
      const n = clamp(Number(v) || 0, 0, 10);
      control = `<div>
        <div class="btn-row" style="align-items:center;gap:10px">
          <input class="slider" type="range" min="0" max="10" step="1" value="${n}" data-field="${esc(f.key)}" data-kind="range" style="flex:1" />
          <span class="badge" data-out style="min-width:52px;justify-content:center">${n}/10</span>
        </div>
      </div>`;
      break;
    }

    case 'slider': {
      const min = f.min ?? 0, max = f.max ?? 100, step = f.step ?? 1;
      const n = clamp(Number(v) || min, min, max);
      control = `<div class="btn-row" style="align-items:center;gap:10px">
        <input class="slider" type="range" min="${min}" max="${max}" step="${step}" value="${n}" data-field="${esc(f.key)}" data-kind="range" data-unit="${esc(f.unit || '')}" style="flex:1" />
        <span class="badge" data-out style="min-width:58px;justify-content:center">${n}${f.unit || ''}</span>
      </div>`;
      break;
    }

    case 'select':
    case 'multiselect': {
      const multi = f.type === 'multiselect';
      const arr = multi ? (Array.isArray(v) ? v : []) : null;
      control = `<div class="chips" data-field="${esc(f.key)}" data-kind="${multi ? 'multi' : 'single'}">
        ${(f.options || []).map((o) => {
          const val = typeof o === 'string' ? o : o.value;
          const lab = typeof o === 'string' ? o : o.label;
          const on = multi ? arr.includes(val) : String(v) === String(val);
          return `<button type="button" class="chip ${on ? 'on' : ''}" data-val="${esc(val)}">${esc(lab)}</button>`;
        }).join('')}
      </div>`;
      break;
    }

    case 'dropdown': {
      const opts = (f.options || []).map((o) => {
        const val = typeof o === 'string' ? o : o.value;
        const lab = typeof o === 'string' ? o : o.label;
        const sel = String(v) === String(val) ? 'selected' : '';
        return `<option value="${esc(val)}" ${sel}>${esc(lab)}</option>`;
      }).join('');
      control = `<select class="select" data-field="${esc(f.key)}" data-kind="dropdown">
        ${f.placeholder ? `<option value="">${esc(f.placeholder)}</option>` : ''}${opts}
      </select>`;
      break;
    }

    case 'number':
      control = `<input class="input" type="number" inputmode="decimal" data-field="${esc(f.key)}"
        value="${v ?? ''}" min="${f.min ?? ''}" max="${f.max ?? ''}" step="${f.step ?? 1}"
        placeholder="${esc(f.placeholder || '')}" />`;
      break;

    case 'date':
      control = `<input class="input" type="date" data-field="${esc(f.key)}" value="${esc(dateVal(v))}" />`;
      break;

    case 'datetime':
      control = `<input class="input" type="datetime-local" data-field="${esc(f.key)}" value="${esc(datetimeVal(v))}" />`;
      break;

    case 'color':
      control = `<div class="btn-row" style="align-items:center;gap:12px">
        <input type="color" data-field="${esc(f.key)}" data-kind="color" value="${esc(v || '#4f6df5')}"
          style="width:62px;height:48px;border:1px solid var(--border);border-radius:14px;background:var(--card-2);padding:4px" />
        <span class="badge" data-out>${esc(v || '#4f6df5')}</span>
      </div>`;
      break;

    case 'tags':
      control = `<div class="input-voice">
        <input class="input" data-field="${esc(f.key)}" data-kind="tags" value="${esc((v || []).join(', '))}" placeholder="tag1, tag2, tag3" />
      </div>`;
      break;

    default:
      control = `<input class="input" data-field="${esc(f.key)}" value="${esc(v || '')}" />`;
  }

  const wrapClass = f.type === 'checkbox' ? 'field' : 'field';
  return `<div class="field ${opts.compact ? 'compact' : ''}" data-wrap="${esc(f.key)}" style="${f.hidden ? 'display:none' : ''}">
    ${label}${control}${help}
  </div>`;
}

/* ---------------------------- BIND -------------------------------------- */
/**
 * Collega gli eventi dei campi. Usa un oggetto "values" come stato condiviso.
 * @param {HTMLElement} root
 * @param {Array} fields definizioni (con .value aggiornato da collectFields)
 * @returns {{values:object, get:Function, sync:Function}}
 */
export function bindFields(root, fields) {
  const values = {};
  fields.forEach((f) => { values[f.key] = f.value; });

  qsa('[data-field]', root).forEach((el) => {
    const key = el.dataset.field;
    const kind = el.dataset.kind || el.tagName.toLowerCase();

    // Chip: selezione singola / multipla / sì-no
    if (el.classList.contains('chips')) {
      el.addEventListener('click', (e) => {
        const chip = e.target.closest('.chip');
        if (!chip) return;
        const val = chip.dataset.val;
        if (kind === 'yesno') {
          values[key] = val === 'yes';
          qsa('.chip', el).forEach((c) => c.classList.toggle('on', c === chip));
          el.dataset.dirty = '1';
          el.dispatchEvent(new CustomEvent('fieldchange', { bubbles: true, detail: { key, value: values[key] } }));
          return;
        }
        if (kind === 'single') {
          values[key] = val;
          qsa('.chip', el).forEach((c) => c.classList.toggle('on', c === chip));
        } else { // multi
          const cur = new Set(Array.isArray(values[key]) ? values[key] : []);
          cur.has(val) ? cur.delete(val) : cur.add(val);
          values[key] = [...cur];
          chip.classList.toggle('on');
        }
        el.dispatchEvent(new CustomEvent('fieldchange', { bubbles: true, detail: { key, value: values[key] } }));
      });
      return;
    }

    // Stelle
    if (kind === 'stars') {
      el.addEventListener('click', (e) => {
        const b = e.target.closest('.star');
        if (!b) return;
        const n = Number(b.dataset.val);
        values[key] = values[key] === n ? 0 : n; // secondo tocco = azzera
        qsa('.star', el).forEach((s) => s.classList.toggle('on', Number(s.dataset.val) <= values[key]));
        el.dispatchEvent(new CustomEvent('fieldchange', { bubbles: true, detail: { key, value: values[key] } }));
      });
      return;
    }

    // Checkbox / switch
    if (el.type === 'checkbox') {
      el.addEventListener('change', () => {
        values[key] = el.checked;
        el.dispatchEvent(new CustomEvent('fieldchange', { bubbles: true, detail: { key, value: el.checked } }));
      });
      return;
    }

    // Range (rating10 / slider)
    if (el.type === 'range') {
      const out = qs('[data-out]', el.closest('[data-wrap]') || root);
      const upd = () => {
        values[key] = Number(el.value);
        if (out) out.textContent = `${el.value}${el.dataset.unit || (el.max === '10' ? '/10' : '')}`;
      };
      el.addEventListener('input', () => { upd(); el.dispatchEvent(new CustomEvent('fieldchange', { bubbles: true, detail: { key, value: values[key] } })); });
      upd();
      return;
    }

    // Colore
    if (kind === 'color') {
      const out = qs('[data-out]', el.closest('[data-wrap]') || root);
      el.addEventListener('input', () => { values[key] = el.value; if (out) out.textContent = el.value; });
      return;
    }

    // Tag (stringa CSV -> array)
    if (kind === 'tags') { return; }

    // Testo / textarea / numero / select / date / datetime
    el.addEventListener('input', () => { values[key] = el.value; });
    el.addEventListener('change', () => { values[key] = el.value; });
  });

  /** Legge lo stato corrente dei campi e aggiorna `values`. */
  function sync() {
    qsa('[data-field]', root).forEach((el) => {
      const key = el.dataset.field;
      const kind = el.dataset.kind || '';
      if (el.classList.contains('chips')) {
        if (el.dataset.dirty === '1') return; // già gestito dal click
        if (kind === 'yesno') {
          const on = qs('.chip.on', el);
          values[key] = on ? on.dataset.val === 'yes' : null;
        } else if (kind === 'single') {
          values[key] = qs('.chip.on', el)?.dataset.val ?? '';
        } else {
          values[key] = qsa('.chip.on', el).map((c) => c.dataset.val);
        }
        return;
      }
      if (kind === 'stars') { return; }
      if (kind === 'color') { values[key] = el.value; return; }
      if (kind === 'tags') {
        values[key] = String(el.value || '').split(',').map((s) => s.trim()).filter(Boolean);
        return;
      }
      if (el.type === 'checkbox') { values[key] = el.checked; return; }
      if (el.type === 'range') { values[key] = Number(el.value); return; }
      if (el.type === 'number') { values[key] = el.value === '' ? null : Number(el.value); return; }
      if (el.type === 'date') { values[key] = el.value ? new Date(el.value + 'T00:00:00').toISOString() : null; return; }
      if (el.type === 'datetime') { values[key] = el.value ? new Date(el.value).toISOString() : null; return; }
      values[key] = el.value;
    });
    return values;
  }

  return { values, get: () => ({ ...values }), sync };
}

/* --------------------------- VALORI DATA -------------------------------- */
function dateVal(v) {
  if (!v) return '';
  const d = new Date(v);
  if (isNaN(d)) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function datetimeVal(v) {
  if (!v) return '';
  const d = new Date(v);
  if (isNaN(d)) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/* ---------------------- CAMPI PERSONALIZZATI ---------------------------- */
/**
 * Costruisce le definizioni dei campi a partire dai "campi personalizzati"
 * creati dall'utente nello store `customFields`, filtrati per entità.
 */
export function customFieldDefs(customFields, entity, current = {}) {
  return (customFields || [])
    .filter((f) => !f.entityTypes || !f.entityTypes.length || f.entityTypes.includes(entity))
    .sort((a, b) => (a.order || 0) - (b.order || 0))
    .map((f) => ({
      key: `cf_${f.id}`,
      label: f.name,
      type: f.type || 'text',
      options: f.options || [],
      min: f.min, max: f.max,
      unit: f.unit || '',
      voice: f.type === 'text' || f.type === 'textarea',
      value: current[`cf_${f.id}`] ?? (f.type === 'checkbox' ? false : f.type === 'multiselect' || f.type === 'tags' ? [] : f.type === 'stars' || f.type === 'slider' || f.type === 'rating10' ? 0 : ''),
      _custom: true,
      defId: f.id
    }));
}

/** Estrae solo i valori dei campi personalizzati da un oggetto salvataggio. */
export function pickCustomValues(values) {
  const out = {};
  Object.entries(values).forEach(([k, v]) => { if (k.startsWith('cf_')) out[k] = v; });
  return out;
}

/** Riepilogo leggibile di un valore di campo (per le card). */
export function fieldValueLabel(def, value) {
  if (value === null || value === undefined || value === '') return '';
  switch (def.type) {
    case 'yesno': return value ? 'Sì' : 'No';
    case 'checkbox': return value ? '✓' : '✕';
    case 'stars': return '★'.repeat(Number(value) || 0);
    case 'rating10': return `${value}/10`;
    case 'multiselect': return Array.isArray(value) ? value.join(', ') : String(value);
    case 'tags': return Array.isArray(value) ? value.map((t) => `#${t}`).join(' ') : String(value);
    case 'slider': return `${value}${def.unit || ''}`;
    default: return String(value);
  }
}
