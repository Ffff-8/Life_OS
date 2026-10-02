# LifeOS — PWA personale mobile-first

Second brain / assistente personale che vive **sul tuo telefono**: eventi, attività,
note, idee, obiettivi, diario, inbox e promemoria. Nessun account, nessun server,
nessuna pubblicità. Offline-first, installabile come app.

---

## 1. Installazione e avvio

### In locale (computer, per sviluppo)
I moduli ES e IndexedDB richiedono `http`/`https`, **non** `file://`.
Dalla cartella del progetto:

```bash
python3 -m http.server 8000
# poi apri  http://localhost:8000
```

### Sul telefono
1. Pubblica la cartella su un qualsiasi hosting statico (GitHub Pages, Netlify,
   Vercel, un tuo spazio web…). Non serve alcun backend: sono file statici.
2. Apri l'indirizzo con il browser del telefono.
3. Installa l'app:
   - **Android (Chrome/Edge):** menu ⋮ → *Installa app* / *Aggiungi a schermata Home*.
   - **iPhone/iPad (Safari):** tocca **Condividi** → *Aggiungi a Home*.
   - **Desktop:** icona di installazione nella barra degli indirizzi.

Da quel momento LifeOS si apre a tutto schermo, come una normale applicazione.

---

## 2. Struttura del progetto

```
lifeos/
├── index.html                 guscio dell'app (shell, bottom-nav, splash)
├── manifest.json              identità PWA (icone, avvio, scorciatoie)
├── service-worker.js          cache offline + gestione click notifiche
├── offline.html               pagina di fallback offline
├── css/styles.css             design system, temi chiaro/scuro, componenti
├── icons/                     icone PNG generate localmente (192/512/maskable)
├── js/
│   ├── app.js                 bootstrap, rotte, tema, SW, install, banner offline
│   ├── db.js                  IndexedDB versionato (onupgradeneeded + migrazioni)
│   ├── store.js               dati, cache in memoria, event bus, statistiche
│   ├── utils.js               date italiane, formattazione, helper DOM
│   ├── router.js              router a hash (funziona nelle PWA installate)
│   ├── ui.js                  toast, bottom sheet, dialoghi, badge, stati vuoti
│   ├── fields.js              sistema di campi (stelle, slider, sì/no, …)
│   ├── editors.js             editor completo di ogni tipo di elemento
│   ├── voice.js               Web Speech API (dettatura + sintesi)
│   ├── notifications.js       notifiche locali, permessi, diagnostica
│   ├── reminders.js           motore dei promemoria
│   ├── recur.js               ricorrenze (giornaliera/settimanale/mensile/annuale)
│   ├── search.js              ricerca globale + filtri
│   ├── backup.js              export/import JSON, snapshot automatici
│   ├── ai/parser.js           parser italiano a regole (date, intenti, entità)
│   ├── ai/adapter.js          punto di innesto per un modello AI
│   └── views/                 una vista per sezione (home, calendar, tasks, …)
└── tools/
    ├── make_icons.py          genera le icone PNG con Pillow
    ├── test_static.py         controlli statici (file, sintassi, import, manifest)
    └── e2e_test.mjs           smoke test in Chromium headless (Playwright)
```

---

## 3. Funzioni implementate

| Area | Dettagli |
|---|---|
| **Home** | saluto, data, attività di oggi, eventi, promemoria, attività scadute, obiettivi, note e idee recenti, **percentuale di completamento della giornata**, suggerimenti |
| **Creazione rapida** | pulsante centrale **+** → Evento, Attività, Nota, Idea, Obiettivo, Pensiero, Pensiero veloce (Inbox) |
| **Dettatura** | pulsante 🎤 su ogni campo testuale + pagina **Parla con LifeOS** con analisi automatica |
| **Inbox** | cattura rapida, poi conversione in 💡 Idea / 📝 Nota / ✅ Attività / 📅 Evento / 📖 Diario |
| **Calendario** | griglia mensile tattile, eventi del giorno, prossimi appuntamenti, ricorrenze |
| **Eventi** | titolo, descrizione, data/ora, durata, categoria+colore, priorità, luogo, note, ricorrenza, **promemoria multipli** personalizzabili (anche 14 giorni / 7 giorni / 1 giorno / 2 ore / 30 minuti prima) |
| **Attività** | titolo, descrizione, scadenza, priorità, categoria, stato (⚪ Da fare · 🔵 In corso · 🟢 Completata · 🔴 Scaduta), tag, tempo stimato, checklist, promemoria, valutazione 0–10, posticipo e swipe |
| **Note** | titolo, testo, categoria, tag, allegati (base64 in IndexedDB), ricerca, modifica, archiviazione, preferiti, dettatura |
| **Idee** | titolo, descrizione, categoria, tag, stato, importanza ⭐, fattibilità ⭐, valutazione 0–10, data, note |
| **Sistema di campi** | Sì/No, checkbox, stelle 1–5, voto 0–10, slider, selezione singola, selezione multipla, menu a tendina, numero, data, data+ora, colore, tag — più **campi personalizzati** definiti dall'utente |
| **Categorie** | nome, icona, colore, descrizione; eliminabile senza perdere gli elementi |
| **Ricerca globale** | eventi, attività, note, idee, obiettivi, diario, inbox + filtri per tipo, categoria, stato, priorità, periodo |
| **Notifiche** | notifiche locali reali via Service Worker, multipli promemoria per evento, pagina Promemoria con diagnostica onesta |
| **Obiettivi** | nome, descrizione, inizio, scadenza, % completamento, sotto-attività, categoria, priorità, note, barra di avanzamento |
| **Diario** | testo, voce trascritta, valutazione 1–5, tag, data, ora |
| **Memoria** | tutto persistente in IndexedDB; **nessuna cancellazione automatica**, solo manuale |
| **Backup** | export file JSON, import (unisci o sostituisci), snapshot automatici locali, copia JSON negli appunti |
| **PWA** | manifest, service worker, icone maskable, installazione in schermata Home, funzionamento offline |
| **AI (opzionale)** | `ai/adapter.js` espone `interpret / classify / summarize / answer / suggestOrganizations`: oggi usa il parser locale, domani un LLM senza toccare le viste |

---

## 4. Limiti reali (senza girarci intorno)

**Dettatura vocale (Web Speech API)**
- Disponibile su Chrome/Edge (Android e desktop) e Safari su iOS **16.4+ con l'app installata**.
- **Firefox non la implementa**: il pulsante 🎤 viene disabilitato e l'app lo dice.
- In Chrome il riconoscimento può richiedere la connessione (l'audio è elaborato lato servizio): può non funzionare offline.
- Tutti i campi restano comunque scrivibili con la tastiera.

**Notifiche**
- Una PWA **senza server push** non può garantire avvisi puntuali ad app chiusa: nessun browser lo permette.
- I promemoria scattano mentre l'app è aperta o quando la riporti in primo piano; alla riapertura compare il riepilogo di quelli scaduti nel frattempo.
- **iOS 16.4+ e app installata nella schermata Home** sono requisiti; in Safari aperto le notifiche web non funzionano.
- Android può sospendere i timer in background: per gli avvisi critici usa anche l'agenda di sistema.

**Archiviazione**
- I dati vivono in IndexedDB: se svuoti i dati del browser o disinstalli l'app, vanno persi → **esporta il backup JSON** periodicamente.
- Gli allegati sono salvati come base64 (limite 3 MB per file); file enormi esauriscono la quota del browser.
- Su alcuni browser i dati "best effort" possono essere rimossi per spazio: usa *Impostazioni → Proteggi archiviazione*.

**Privacy**
- Per impostazione predefinita nessun dato esce dal dispositivo.
- Se in *Altro → Motore AI* colleghi un endpoint esterno, i testi inviati per l'analisi **escono dal telefono**: è una scelta esplicita dell'utente.

---

## 5. Test

```bash
python3 tools/make_icons.py      # rigenera le icone
python3 tools/test_static.py     # 147 controlli: file, sintassi, import, manifest, IndexedDB
npm i playwright && npx playwright install chromium
node tools/e2e_test.mjs          # smoke test reale in Chromium headless
```

La suite end-to-end verifica: avvio, navigazione in tutte le sezioni, creazione di
un'attività, persistenza dopo ricarica, modifica, completamento, ricerca, filtri,
export/import JSON (incluso il download reale), registrazione del service worker,
ricarica **offline con rete disattivata**, temi chiaro/scuro, layout mobile
(assenza di overflow, dimensione delle aree tattili), analisi del testo vocale,
cancellazione manuale e assenza di errori in console.
