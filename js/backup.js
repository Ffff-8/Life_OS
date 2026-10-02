/* ==========================================================================
   LifeOS — backup.js
   Esportazione / importazione completa in JSON + backup automatico locale.
   Tutto avviene sul dispositivo: nessun upload, nessun account.
   ========================================================================== */

import { exportData, importData, validateBackup, getSetting, setSetting, globalStats } from './store.js';
import { downloadBlob, readFileAsText, nowISO, dayKey } from './utils.js';
import { toast, confirmDialog, sheet, qs, onClick } from './ui.js';
import db, { S } from './db.js';

const AUTO_PREFIX = 'backup:auto:';

/** Nome file: lifeos-backup-2026-09-26.json */
export function backupFilename() {
  return `lifeos-backup-${dayKey(new Date())}.json`;
}

/** Scarica un file JSON con tutti i dati. */
export function exportToFile() {
  const payload = exportData();
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  downloadBlob(blob, backupFilename());
  setSetting('lastBackupAt', nowISO());
  toast('Backup esportato ✅');
  return payload;
}

/** Esporta come testo (per copiarlo a mano). */
export function exportToText() {
  return JSON.stringify(exportData(), null, 2);
}

/**
 * Legge un file JSON scelto dall'utente e restituisce l'oggetto.
 * @param {File} file
 */
export async function parseBackupFile(file) {
  const text = await readFileAsText(file);
  let obj;
  try {
    obj = JSON.parse(text);
  } catch (e) {
    throw new Error('Il file non è un JSON valido');
  }
  const v = validateBackup(obj);
  if (!v.ok) throw new Error(v.error);
  return obj;
}

/**
 * Chiede all'utente come importare (unire o sostituire) e applica.
 * @param {object} payload
 */
export async function importWithChoice(payload) {
  const counts = {};
  ['tasks', 'events', 'notes', 'ideas', 'goals', 'journal', 'inbox', 'categories'].forEach((k) => {
    counts[k] = Array.isArray(payload[k]) ? payload[k].length : 0;
  });
  const summary = Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(' · ');

  return new Promise((resolve) => {
    const body = document.createElement('div');
    body.innerHTML = `
      <p class="muted">Contenuto del file:</p>
      <p class="dim" style="margin:6px 0 14px">${summary || 'nessun elemento'}</p>
      <p class="muted">Data esportazione: ${payload.exportedAt ? new Date(payload.exportedAt).toLocaleString('it-IT') : 'sconosciuta'}</p>
      <div class="divider"></div>
      <p class="warn-box">⚠️ "Sostituisci" cancella i dati attuali sul dispositivo prima di importare. "Unisci" mantiene tutto e aggiunge/aggiorna gli elementi per id.</p>
    `;
    const foot = document.createElement('div');
    foot.className = 'btn-row stack';
    foot.style.width = '100%';
    foot.innerHTML = `
      <button class="btn primary" data-merge>Unisci ai dati esistenti</button>
      <button class="btn danger" data-replace>Sostituisci tutto</button>
      <button class="btn ghost" data-cancel>Annulla</button>
    `;
    const s = sheet({ title: 'Importa backup', body, foot });
    onClick(foot, '[data-merge]', async () => { s.close(); await doImport(payload, true); resolve(true); });
    onClick(foot, '[data-replace]', async () => {
      const ok = await confirmDialog({
        title: 'Sostituire tutti i dati?',
        message: 'Questa azione elimina gli elementi attualmente sul dispositivo e li rimpiazza con quelli del backup. Non è reversibile.',
        confirmText: 'Sostituisci', danger: true
      });
      if (!ok) return;
      s.close();
      await doImport(payload, false);
      resolve(true);
    });
    onClick(foot, '[data-cancel]', () => { s.close(); resolve(false); });
  });
}

async function doImport(payload, merge) {
  try {
    const stats = await importData(payload, { merge });
    toast(merge ? 'Backup unito ✅' : 'Backup ripristinato ✅', 2600);
    console.info('[backup] import completato', stats);
    return true;
  } catch (e) {
    console.error('[backup] import fallito', e);
    toast('Importazione non riuscita', 3200);
    return false;
  }
}

/* ------------------------- BACKUP AUTOMATICO LOCALE --------------------- */
/**
 * Salva uno snapshot JSON dentro IndexedDB (store "settings", chiave
 * "backup:auto:<timestamp>"). Mantiene gli ultimi N snapshot.
 * È un backup "di sicurezza" rapido, non sostituisce l'export su file.
 */
export async function autoBackup() {
  try {
    const payload = exportData();
    const key = AUTO_PREFIX + Date.now();
    await db.put(S.SETTINGS, { key, value: payload, updatedAt: nowISO() });
    await pruneAutoBackups();
    await setSetting('lastBackupAt', nowISO());
    return key;
  } catch (e) {
    console.warn('[backup] auto-backup non riuscito', e);
    return null;
  }
}

/** Elenca gli snapshot automatici (dal più recente). */
export async function listAutoBackups() {
  const all = await db.all(S.SETTINGS);
  return all
    .filter((r) => String(r.key).startsWith(AUTO_PREFIX))
    .sort((a, b) => String(b.key).localeCompare(String(a.key)))
    .map((r) => ({
      key: r.key,
      at: new Date(Number(String(r.key).slice(AUTO_PREFIX.length))).toISOString(),
      counts: r.value?.counts || {},
      payload: r.value
    }));
}

async function pruneAutoBackups() {
  const keep = Math.max(1, Number(getSetting('autoBackupKeep', 5)));
  const list = await listAutoBackups();
  const extra = list.slice(keep);
  for (const b of extra) await db.del(S.SETTINGS, b.key);
}

/** Ripristina uno snapshot automatico. */
export async function restoreAutoBackup(key) {
  const row = await db.get(S.SETTINGS, key);
  if (!row?.value) { toast('Backup non trovato'); return false; }
  const ok = await confirmDialog({
    title: 'Ripristinare questo backup?',
    message: `Verranno ripristinati i dati salvati il ${new Date(row.value.exportedAt).toLocaleString('it-IT')}. I dati attuali verranno sostituiti.`,
    confirmText: 'Ripristina', danger: true
  });
  if (!ok) return false;
  await importData(row.value, { merge: false });
  toast('Backup ripristinato ✅');
  return true;
}

/** Cancella tutti gli snapshot automatici. */
export async function clearAutoBackups() {
  const list = await listAutoBackups();
  for (const b of list) await db.del(S.SETTINGS, b.key);
  return list.length;
}

/** Forse è ora di un auto-backup? (all'avvio, max 1 al giorno) */
export async function maybeAutoBackup() {
  if (!getSetting('autoBackup', false)) return false;
  const last = getSetting('lastBackupAt', null);
  if (last && dayKey(new Date(last)) === dayKey(new Date())) return false;
  const key = await autoBackup();
  return Boolean(key);
}

/* ------------------------------ CANCELLAZIONE --------------------------- */
/** Cancella TUTTI i dati dell'utente (solo su richiesta esplicita). */
export async function wipeAll() {
  const ok = await confirmDialog({
    title: 'Cancellare tutti i dati?',
    message: 'Eventi, attività, note, idee, obiettivi, diario, inbox e categorie verranno eliminati definitivamente da questo dispositivo. Ti consigliamo di esportare un backup prima.',
    confirmText: 'Elimina tutto', danger: true
  });
  if (!ok) return false;
  const again = await confirmDialog({
    title: 'Sei davvero sicuro?',
    message: 'Ultima conferma: questa operazione non può essere annullata.',
    confirmText: 'Sì, elimina', danger: true
  });
  if (!again) return false;
  await db.wipe();
  toast('Dati eliminati');
  location.hash = '#/home';
  setTimeout(() => location.reload(), 700);
  return true;
}

/** Spazio stimato usato dal browser per i dati dell'app. */
export async function storageInfo() {
  const est = await db.usage();
  const counters = globalStats();
  return {
    quota: est?.quota || null,
    usage: est?.usage || null,
    persisted: navigator.storage?.persisted ? await navigator.storage.persisted().catch(() => false) : false,
    counters
  };
}

/** Chiede la persistenza dello storage (evita cancellazioni "per spazio"). */
export async function requestPersistence() {
  try {
    if (navigator.storage?.persist) {
      const already = await navigator.storage.persisted();
      if (already) return true;
      const granted = await navigator.storage.persist();
      toast(granted ? 'Archiviazione protetta ✅' : 'Archiviazione non protetta dal sistema', 3000);
      return granted;
    }
  } catch (e) { /* noop */ }
  toast('Il browser non supporta la richiesta di persistenza', 3000);
  return false;
}
