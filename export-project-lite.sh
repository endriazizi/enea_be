#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# export-project-lite.sh — Snapshot leggero per progetti Ionic/Angular/Node
# - Log con emoji SOLO su STDERR (file generati puliti)
# - Modalità: md | zip | split (tree + code)
# - Esclusioni smart (dir e file), troncatura opzionale
# - Report finale + opzionale report per estensione
# - Robusto su Git Bash/Windows grazie a fallback -iname
# =============================================================================

# === CONFIG di default (override via variabili d'ambiente) ===================
ROOT="${ROOT:-.}"
OUT="${OUT:-./exports/project-snapshot.md}"
MODE="${MODE:-md}"  # md | zip | split
ALLOWED_EXT="${ALLOWED_EXT:-ts,js,html,scss,css,json,md,env,txt,yml,yaml,properties,xml,sql,sh,conf}"
EXCLUDE_DIRS="${EXCLUDE_DIRS:-node_modules,.git,dist,build,coverage,logs,tmp,exports,.angular,.vscode,.idea}"
EXCLUDE_FILES="${EXCLUDE_FILES:-package-lock.json,yarn.lock,pnpm-lock.yaml}"  # file da escludere (CSV)
MAX_BYTES_PER_FILE="${MAX_BYTES_PER_FILE:-0}"   # 0=illimitato; >0 tronca (byte)
VERBOSE="${VERBOSE:-1}"                         # 1=log con emoji; 0=silenzio
DRY_RUN="${DRY_RUN:-0}"                         # 1=simula; 0=esegue
REPORT="${REPORT:-1}"                           # 1=report finale; 0=off
REPORT_EXT="${REPORT_EXT:-0}"                   # 1=report per estensione; 0=off
REPORT_EXT_TOP="${REPORT_EXT_TOP:-5}"           # quante estensioni mostrare nel TOP
# =============================================================================

# --- util log: SEMPRE su STDERR (non “sporca” i file generati) --------------
log()  { [[ "$VERBOSE" == "1" ]] && printf "%b\n" "$1" >&2; }
ok()   { [[ "$VERBOSE" == "1" ]] && printf "✅ %b\n" "$1" >&2; }
warn() { [[ "$VERBOSE" == "1" ]] && printf "⚠️  %b\n" "$1" >&2; }
err()  { printf "❌ %b\n" "$1" >&2; }
has_cmd() { command -v "$1" >/dev/null 2>&1; }

print_help() {
  cat >&2 <<'EOF'
Uso:
  bash export-project-lite.sh

Variabili:
  ROOT="."  OUT="./exports/snapshot.md"  MODE=md|zip|split
  ALLOWED_EXT="ts,js,html,..."  EXCLUDE_DIRS="node_modules,.git,..."
  EXCLUDE_FILES="package-lock.json,yarn.lock,..."   # file specifici da escludere
  MAX_BYTES_PER_FILE=0  VERBOSE=1  DRY_RUN=1
  REPORT=1  REPORT_EXT=0  REPORT_EXT_TOP=5

Esempio:
  MODE=split ROOT="." OUT="./exports/admin-snap.md" \
  ALLOWED_EXT="ts,js,html,scss,css,json,md,xml,sql" \
  EXCLUDE_DIRS="node_modules,logs,src/db/migrations,.git,dist,.angular,.vscode,coverage,exports,assets" \
  EXCLUDE_FILES="package-lock.json" \
  bash export-project-lite.sh
EOF
}
for a in "${@:-}"; do [[ "$a" == "-h" || "$a" == "--help" ]] && { print_help; exit 0; }; done

# --- helpers portabili -------------------------------------------------------
file_size_bytes() {
  if stat --version >/dev/null 2>&1; then stat -c %s "$1"; else stat -f %z "$1"; fi
}
human_bytes() {
  local b=$1; local u=(B KB MB GB TB); local i=0
  while (( b>=1024 && i<${#u[@]}-1 )); do b=$(( (b+1023)/1024 )); ((i++)); done
  printf "%d %s" "$b" "${u[$i]}"
}

# --- prepara output dir ------------------------------------------------------
OUT_DIR="$(dirname "$OUT")"
[[ "$DRY_RUN" == "0" ]] && { log "🧰 Creo cartella output: $OUT_DIR"; mkdir -p "$OUT_DIR"; }

# --- costruisci filtri (estensioni, esclusioni) ------------------------------
IFS=',' read -r -a EXT_ARR <<< "$ALLOWED_EXT"
# Regex robusto: .*\. (ts|js|html|...) $
EXT_REGEX='\.\('"${EXT_ARR[0]}"
for i in "${EXT_ARR[@]:1}"; do EXT_REGEX="$EXT_REGEX"'\|'"$i"; done
EXT_REGEX="$EXT_REGEX"'\)$'

IFS=',' read -r -a EX_ARR <<< "$EXCLUDE_DIRS"
IFS=',' read -r -a EXFILES_ARR <<< "$EXCLUDE_FILES"

# -path "*/dir/*" -prune -o ...
prune_args=()
for d in "${EX_ARR[@]}"; do prune_args+=(-path "*/$d/*" -prune -o); done

# --- funzioni pure (niente log dentro) --------------------------------------
generate_tree() {
  if has_cmd tree; then
    # tree -I accetta pattern separati da |
    local ignore_dirs ignore_files ignore
    ignore_dirs="$(printf "%s|" "${EX_ARR[@]}")"
    ignore_files="$(printf "%s|" "${EXFILES_ARR[@]}")"
    ignore="${ignore_dirs}${ignore_files}"
    ignore="${ignore%|}"
    (cd "$ROOT" && tree -I "$ignore")
  else
    # fallback: find e poi filtra anche file specifici via grep -Ev
    local grep_pat
    grep_pat="(^|/)("
    for f in "${EXFILES_ARR[@]}"; do
      grep_pat+=$(printf "%s|" "$(printf "%s" "$f" | sed 's/[.[\*^$()+?{}|]/\\&/g')")
    done
    grep_pat="${grep_pat%|})$"
    if [[ "${#EXFILES_ARR[@]}" -gt 0 ]]; then
      (cd "$ROOT" && find . "${prune_args[@]}" -print | sed 's|^\./||' | grep -Ev "$grep_pat")
    else
      (cd "$ROOT" && find . "${prune_args[@]}" -print | sed 's|^\./||')
    fi
  fi
}

list_allowed_files() {
  local out
  if [[ "${#EXFILES_ARR[@]}" -gt 0 ]]; then
    local not_name_args=()
    for f in "${EXFILES_ARR[@]}"; do not_name_args+=( ! -name "$f" ); done
    out=$(
      cd "$ROOT" && \
      find . "${prune_args[@]}" -type f -regex ".*${EXT_REGEX}" "${not_name_args[@]}" -print 2>/dev/null \
        | sed 's|^\./||' | sort
    )
  else
    out=$(
      cd "$ROOT" && \
      find . "${prune_args[@]}" -type f -regex ".*${EXT_REGEX}" -print 2>/dev/null \
        | sed 's|^\./||' | sort
    )
  fi

  # fallback portabile con -iname (Git Bash/Windows)
  if [[ -z "$out" ]]; then
    cd "$ROOT" || exit 1
    local name_args=()
    for e in "${EXT_ARR[@]}"; do name_args+=( -iname "*.${e}" -o ); done
    unset 'name_args[${#name_args[@]}-1]'
    local not_name_args=()
    for f in "${EXFILES_ARR[@]}"; do not_name_args+=( ! -iname "$f" ); done
    find . "${prune_args[@]}" -type f \( "${name_args[@]}" \) "${not_name_args[@]}" -print \
      | sed 's|^\./||' | sort
    return
  fi

  printf '%s\n' "$out"
}

dump_files_markdown() {
  local list="$1"
  while IFS= read -r rel; do
    local full="$ROOT/$rel"; local size; size=$(wc -c < "$full")
    echo; echo "### $rel"; echo '```'
    if [[ "$MAX_BYTES_PER_FILE" -gt 0 && "$size" -gt "$MAX_BYTES_PER_FILE" ]]; then
      head -c "$MAX_BYTES_PER_FILE" "$full"; echo
      echo "[…troncato a ${MAX_BYTES_PER_FILE} byte su ${size}…]"
    else
      cat "$full"
    fi
    echo '```'
  done < "$list"
}

report_by_extension() {
  local list="$1"
  declare -A ext_counts=(); declare -A ext_bytes=()
  while IFS= read -r rel; do
    local ext="${rel##*.}"; ext="${ext,,}"
    local sz; sz=$(file_size_bytes "$ROOT/$rel")
    (( ext_counts["$ext"] += 1 )); (( ext_bytes["$ext"] += sz ))
  done < "$list"
  local tmp; tmp="$(mktemp)"
  for k in "${!ext_bytes[@]}"; do printf "%s %s %s\n" "${ext_bytes[$k]}" "$k" "${ext_counts[$k]}" >> "$tmp"; done
  local n=0; log "📊 Report dettagliato per estensione (TOP ${REPORT_EXT_TOP}):"
  while IFS=' ' read -r b e c; do
    log "   • ${e} → ${c} file → $(human_bytes "$b")"
    ((n++)); [[ "$n" -ge "$REPORT_EXT_TOP" ]] && break || true
  done < <(sort -nrk1,1 "$tmp"); rm -f "$tmp"
}

# --- banner ------------------------------------------------------------------
log "🚀 Avvio export-project-lite"
log "📂 Root: $(cd "$ROOT" && pwd)"
log "🧹 Escludo dir: ${EXCLUDE_DIRS}"
log "🧻 Escludo file: ${EXCLUDE_FILES}"
log "🧩 Estensioni: ${ALLOWED_EXT}"
[[ "$MAX_BYTES_PER_FILE" != "0" ]] && log "✂️  Troncatura per file: ${MAX_BYTES_PER_FILE} byte"
[[ "$REPORT" == "1" ]] && log "📊 Report finale: ATTIVO"
[[ "$REPORT_EXT" == "1" ]] && log "📑 Report per estensione: ATTIVO (TOP ${REPORT_EXT_TOP})"

# --- MODE=zip ---------------------------------------------------------------
if [[ "$MODE" == "zip" ]]; then
  ZIP_OUT="${OUT%.*}.zip"; log "📦 Modalità ZIP → $ZIP_OUT"
  [[ "$DRY_RUN" == "1" ]] && { ok "DRY_RUN: creerei $ZIP_OUT"; exit 0; }
  if has_cmd zip; then
    log "🧭 Creo zip (escludo dir rumorose)…"
    exclude_opts=(); for d in "${EX_ARR[@]}"; do exclude_opts+=(-x "$d/*"); done
    (cd "$ROOT" && zip -rq "../$ZIP_OUT" . "${exclude_opts[@]}") 2>/dev/null || zip -rq "$ZIP_OUT" "$ROOT" "${exclude_opts[@]}"
    ok "Creato: $ZIP_OUT"
  else
    TAR_OUT="${OUT%.*}.tar.gz"; log "🗜️  zip non disponibile → uso tar.gz: $TAR_OUT"
    (cd "$ROOT" && tar $(printf -- " --exclude=%s" "${EX_ARR[@]}") -czf "../$TAR_OUT" .) 2>/dev/null || tar $(printf -- " --exclude=%s" "${EX_ARR[@]}") -czf "$TAR_OUT" "$ROOT"
    ok "Creato: $TAR_OUT"; ZIP_OUT="$TAR_OUT"
  fi
  if [[ "$REPORT" == "1" ]]; then
    [[ -f "$ZIP_OUT" ]] && log "📊 Report:\n   • Archivio: $(human_bytes "$(file_size_bytes "$ZIP_OUT")") ($ZIP_OUT)" || warn "Report: archivio non trovato."
  fi
  exit 0
fi

# --- MODE=split -------------------------------------------------------------
if [[ "$MODE" == "split" ]]; then
  TREE_OUT="${OUT%.*}-tree.md"; CODE_OUT="${OUT%.*}-code.md"
  log "🧭 Modalità SPLIT →"; log "   • Tree: $TREE_OUT"; log "   • Code: $CODE_OUT"
  [[ "$DRY_RUN" == "1" ]] && { ok "DRY_RUN: creerei $TREE_OUT e $CODE_OUT"; exit 0; }

  TMP_LIST="$(mktemp)"; list_allowed_files > "$TMP_LIST"

  log "✍️  Scrivo tree…"
  { echo "# 📁 Project tree"; echo; echo "_Generato: $(date)_"; echo; echo '```text'; generate_tree; echo '```'; } > "$TREE_OUT"

  log "✍️  Scrivo code…"
  { echo "# 🧩 Project code (file ammessi)"; echo; echo "_Generato: $(date)_"; dump_files_markdown "$TMP_LIST"; } > "$CODE_OUT"

  if [[ "$REPORT" == "1" ]]; then
    TOTAL_FILES=$(wc -l < "$TMP_LIST" || echo 0); TOTAL_BYTES=0
    while IFS= read -r rel; do (( TOTAL_BYTES += $(file_size_bytes "$ROOT/$rel") )); done < "$TMP_LIST"
    log "📊 Report:"; log "   • File inclusi: $TOTAL_FILES"; log "   • Dimensione totale contenuti: $(human_bytes "$TOTAL_BYTES")"
    [[ -f "$TREE_OUT" ]] && log "   • Tree MD: $(human_bytes "$(file_size_bytes "$TREE_OUT")")"
    [[ -f "$CODE_OUT" ]] && log "   • Code MD: $(human_bytes "$(file_size_bytes "$CODE_OUT")")"
    [[ "$REPORT_EXT" == "1" ]] && report_by_extension "$TMP_LIST"
  fi

  rm -f "$TMP_LIST"; ok "Fatto: $TREE_OUT + $CODE_OUT"; exit 0
fi

# --- MODE=md (default) ------------------------------------------------------
log "🧭 Modalità MD → $OUT"
[[ "$DRY_RUN" == "1" ]] && { ok "DRY_RUN: creerei $OUT"; exit 0; }

TMP_LIST="$(mktemp)"; log "🔎 Raccolgo file ammessi…"; list_allowed_files > "$TMP_LIST"
COUNT_FILES=$(wc -l < "$TMP_LIST" || echo 0); log "📄 File inclusi: $COUNT_FILES"

log "✍️  Scrivo Markdown…"
{
  echo "# 🧾 PROJECT SNAPSHOT (lite)"; echo
  echo "**Root:** $(cd "$ROOT" && pwd)"; echo
  echo "Esclusi (dir): ${EXCLUDE_DIRS}"; echo
  echo "Esclusi (file): ${EXCLUDE_FILES}"; echo
  echo "Estensioni incluse: ${ALLOWED_EXT}"; echo
  echo "_Generato: $(date)_"; echo
  echo "## Tree (compatto)"; echo '```text'; generate_tree; echo '```'; echo
  echo "## Contenuti file (selezione)"; dump_files_markdown "$TMP_LIST"
} > "$OUT"

if [[ "$REPORT" == "1" ]]; then
  TOTAL_BYTES=0; while IFS= read -r rel; do (( TOTAL_BYTES += $(file_size_bytes "$ROOT/$rel") )); done < "$TMP_LIST"
  SZ_OUT=$(file_size_bytes "$OUT")
  log "📊 Report:"; log "   • File inclusi: $COUNT_FILES"; log "   • Dimensione totale contenuti: $(human_bytes "$TOTAL_BYTES")"; log "   • Snapshot MD: $(human_bytes "$SZ_OUT") ($OUT)"
  [[ "$REPORT_EXT" == "1" ]] && report_by_extension "$TMP_LIST"
fi

rm -f "$TMP_LIST"; ok "Fatto: $OUT"
