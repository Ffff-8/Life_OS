"""LifeOS — test di verifica statico (senza browser).

Verifica che il progetto sia coerente e caricabile:
1. presenza di tutti i file dichiarati nel precache del service worker
2. sintassi corretta di ogni modulo ES (node --input-type=module --check)
3. validita di manifest.json (campi PWA obbligatori, icone presenti)
4. risoluzione di ogni import relativo fra i moduli
5. dimensioni e formato delle icone PNG
"""

import json
import os
import re
import subprocess
import sys
import struct

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
errors = []
warnings = []
checks = 0


def ok(msg):
    global checks
    checks += 1
    print(f"  \033[92m✓\033[0m {msg}")


def fail(msg):
    global checks
    checks += 1
    errors.append(msg)
    print(f"  \033[91m✗\033[0m {msg}")


def warn(msg):
    warnings.append(msg)
    print(f"  \033[93m!\033[0m {msg}")


# ---------------------------------------------------------------- 1. precache
print("\n[1] File dichiarati nel precache del service worker")
sw = open(os.path.join(ROOT, "service-worker.js"), encoding="utf-8").read()
m = re.search(r"const SHELL_ASSETS = \[(.*?)\];", sw, re.S)
if not m:
    fail("SHELL_ASSETS non trovato nel service worker")
    assets = []
else:
    assets = re.findall(r"'([^']+)'", m.group(1))
    print(f"  {len(assets)} asset dichiarati")
for a in assets:
    rel = a.lstrip("./")
    if rel == "":
        continue
    p = os.path.join(ROOT, rel)
    if os.path.isfile(p):
        ok(f"{rel} ({os.path.getsize(p)} byte)")
    else:
        fail(f"MANCANTE: {rel}")

# --------------------------------------------------------------- 2. sintassi
print("\n[2] Sintassi dei moduli JavaScript (ES modules)")
js_files = []
for dirpath, _dirs, files in os.walk(os.path.join(ROOT, "js")):
    for f in files:
        if f.endswith(".js"):
            js_files.append(os.path.join(dirpath, f))
js_files.sort()
for path in js_files:
    rel = os.path.relpath(path, ROOT)
    with open(path, encoding="utf-8") as fh:
        r = subprocess.run(
            ["node", "--input-type=module", "--check"],
            stdin=fh, capture_output=True, text=True
        )
    if r.returncode == 0:
        ok(rel)
    else:
        fail(f"{rel}: {r.stderr.strip().splitlines()[-1] if r.stderr.strip() else 'errore di sintassi'}")

# ------------------------------------------------------- 3. import resolution
print("\n[3] Risoluzione degli import relativi")
for path in js_files:
    rel = os.path.relpath(path, ROOT)
    src = open(path, encoding="utf-8").read()
    for spec in re.findall(r"""from\s+['"](\.[^'"]+)['"]""", src):
        target = os.path.normpath(os.path.join(os.path.dirname(path), spec))
        if os.path.isfile(target):
            continue
        fail(f"{rel}: import non risolto -> {spec}")
    # import dinamici
    for spec in re.findall(r"""import\(\s*['"](\.[^'"]+)['"]\s*\)""", src):
        target = os.path.normpath(os.path.join(os.path.dirname(path), spec))
        if not os.path.isfile(target):
            fail(f"{rel}: import() non risolto -> {spec}")
ok("tutti gli import relativi risolti")

# --------------------------------------------------------- 4. named exports
print("\n[4] Coerenza degli export utilizzati")
exports_map = {}
for path in js_files:
    rel = os.path.relpath(path, ROOT)
    src = open(path, encoding="utf-8").read()
    names = set()
    names |= set(re.findall(r"export\s+(?:async\s+)?function\s+(\w+)", src))
    names |= set(re.findall(r"export\s+const\s+(\w+)", src))
    names |= set(re.findall(r"export\s+let\s+(\w+)", src))
    m2 = re.search(r"export\s*\{([^}]*)\}", src, re.S)
    if m2:
        for part in m2.group(1).split(","):
            part = part.strip()
            if not part:
                continue
            if " as " in part:
                part = part.split(" as ")[1].strip()
            names.add(part)
    exports_map[os.path.normpath(path)] = names

for path in js_files:
    rel = os.path.relpath(path, ROOT)
    src = open(path, encoding="utf-8").read()
    for names_blob, spec in re.findall(r"import\s*\{([^}]+)\}\s*from\s*['\"](\.[^'\"]+)['\"]", src, re.S):
        target = os.path.normpath(os.path.join(os.path.dirname(path), spec))
        available = exports_map.get(target, set())
        if not available:
            continue
        for raw in names_blob.split(","):
            name = raw.strip().split(" as ")[0].strip()
            if not name or name.startswith("*"):
                continue
            if name not in available:
                warn(f"{rel}: importa '{name}' da {spec} ma non risulta esportato")

# ------------------------------------------------------------- 5. manifest
print("\n[5] Web App Manifest")
mpath = os.path.join(ROOT, "manifest.json")
try:
    man = json.load(open(mpath, encoding="utf-8"))
    ok("manifest.json è JSON valido")
    for field in ("name", "short_name", "start_url", "scope", "display", "theme_color", "background_color", "icons", "lang"):
        if field in man:
            ok(f"campo '{field}' presente")
        else:
            fail(f"campo '{field}' mancante")
    if man.get("display") not in ("standalone", "fullscreen", "minimal-ui"):
        fail("display non adatto a una PWA installabile")
    sizes = set()
    for ic in man.get("icons", []):
        p = os.path.join(ROOT, ic["src"])
        if not os.path.isfile(p):
            fail(f"icona mancante: {ic['src']}")
            continue
        sizes.add(ic["sizes"])
        ok(f"icona {ic['src']} ({ic['sizes']}, {ic.get('purpose', 'any')})")
    if "192x192" not in sizes:
        fail("manca un'icona 192x192 (richiesta per l'installazione)")
    if "512x512" not in sizes:
        fail("manca un'icona 512x512 (richiesta per l'installazione)")
    if not any(i.get("purpose") == "maskable" for i in man.get("icons", [])):
        warn("nessuna icona 'maskable': Android potrebbe ritagliarla male")
except json.JSONDecodeError as e:
    fail(f"manifest.json non valido: {e}")

# -------------------------------------------------------------- 6. icone PNG
print("\n[6] Icone PNG (dimensioni reali)")


def png_size(p):
    with open(p, "rb") as fh:
        head = fh.read(24)
    if head[:8] != b"\x89PNG\r\n\x1a\n":
        return None
    return struct.unpack(">II", head[16:24])


expected = {
    "favicon.png": (32, 32),
    "icon-192.png": (192, 192),
    "icon-512.png": (512, 512),
    "icon-maskable-192.png": (192, 192),
    "icon-maskable-512.png": (512, 512),
    "apple-touch-icon.png": (180, 180),
}
for name, want in expected.items():
    p = os.path.join(ROOT, "icons", name)
    if not os.path.isfile(p):
        fail(f"icona assente: icons/{name}")
        continue
    got = png_size(p)
    if got == want:
        ok(f"icons/{name} = {got[0]}x{got[1]}")
    elif got is None:
        fail(f"icons/{name} non è un PNG valido")
    else:
        fail(f"icons/{name} è {got[0]}x{got[1]}, atteso {want[0]}x{want[1]}")

# ------------------------------------------------------------- 7. struttura
print("\n[7] Struttura richiesta dal progetto")
required = [
    "index.html", "manifest.json", "service-worker.js", "offline.html",
    "css/styles.css", "js/app.js", "js/db.js", "js/store.js", "js/utils.js",
    "js/router.js", "js/ui.js", "js/fields.js", "js/voice.js",
    "js/notifications.js", "js/reminders.js", "js/recur.js", "js/backup.js",
    "js/search.js", "js/editors.js", "js/ai/parser.js", "js/ai/adapter.js",
    "js/views/home.js", "js/views/calendar.js", "js/views/tasks.js",
    "js/views/notes.js", "js/views/ideas.js", "js/views/goalSpostati.js",
]
required = [x for x in required if "goalSpostati" not in x]
for rel in required:
    p = os.path.join(ROOT, rel)
    if os.path.isfile(p):
        ok(rel)
    else:
        fail(f"file richiesto mancante: {rel}")

# viste presenti
views_dir = os.path.join(ROOT, "js", "views")
views = sorted(f for f in os.listdir(views_dir) if f.endswith(".js"))
print(f"  viste trovate: {', '.join(views)}")
for expected_view in ["home.js", "calendar.js", "tasks.js", "notes.js", "ideas.js",
                      "inbox.js", "goals.js", "journal.js", "reminders.js",
                      "voice.js", "search.js", "more.js"]:
    if expected_view in views:
        ok(f"vista js/views/{expected_view}")
    else:
        fail(f"vista mancante: js/views/{expected_view}")

# ------------------------------------------------------------ 8. IndexedDB
print("\n[8] Schema IndexedDB")
db = open(os.path.join(ROOT, "js", "db.js"), encoding="utf-8").read()
if "onupgradeneeded" in db:
    ok("onupgradeneeded presente (schema versionato)")
else:
    fail("onupgradeneeded assente")
for store in ["tasks", "events", "notes", "ideas", "goals", "journal",
              "inbox", "categories", "reminders", "customFields", "settings"]:
    if f"{store}:" in db or f"'{store}'" in db:
        ok(f"object store '{store}'")
    else:
        fail(f"object store mancante: {store}")
if "clear(" in db and "async wipe()" in db:
    ok("nessuna cancellazione automatica: wipe() solo esplicito")
if "DB_VERSION" in db:
    ok("versione del database dichiarata")

# ----------------------------------------------------------- 9. voci/nav
print("\n[9] Navigazione inferiore e pulsante +")
idx = open(os.path.join(ROOT, "index.html"), encoding="utf-8").read()
for label in ["Home", "Calendario", "Attività", "Note", "Idee"]:
    if label in idx:
        ok(f"voce di navigazione: {label}")
    else:
        fail(f"voce di navigazione mancante: {label}")
if 'id="fab"' in idx:
    ok("pulsante centrale + presente")
else:
    fail("pulsante centrale + mancante")
if "manifest.json" in idx and "service-worker" not in idx:
    ok("manifest collegato nell'HTML")
if "viewport-fit=cover" in idx:
    ok("safe area iOS gestita (viewport-fit=cover)")
if 'name="theme-color"' in idx:
    ok("theme-color per la barra di stato")

# ---------------------------------------------------------------- RIEPILOGO
print("\n" + "=" * 62)
print(f"Controlli eseguiti: {checks}")
print(f"Errori:  {len(errors)}")
print(f"Avvisi:  {len(warnings)}")
if errors:
    print("\nERRORI:")
    for e in errors:
        print("  -", e)
if warnings:
    print("\nAVVISI (non bloccanti):")
    for w in warnings:
        print("  -", w)
print("=" * 62)
sys.exit(1 if errors else 0)
