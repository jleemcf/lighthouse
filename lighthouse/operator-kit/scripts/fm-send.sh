#!/bin/bash
# fm-send.sh: Owner's word, verbatim, into firstmate's pane. Runs INSIDE WSL as a script file, never through
# `wsl -- bash -c` (which splits the text and expands $ before bash sees it).
#   bash fm-send.sh [--again] <message file>
# The mechanism is `herdr agent prompt <pane> <text>`, the same door the steward uses. The pane is read live from
# `herdr agent list` (the claude agent whose cwd is firstmate's home; the id changes after a restart), the composer
# must be empty, and a ledger beside this script keeps a hash of every send so the same word never goes twice by
# accident. The text goes exactly as written: firstmate hears Owner, nothing about a lighthouse.
set -u
FM_HOME="__FM_HOME__"; D="$(cd "$(dirname "$0")" && pwd)"; LEDGER="$D/fm-send-ledger.tsv"
AGAIN=0; [ "${1:-}" = "--again" ] && { AGAIN=1; shift; }
FILE="${1:-}"
[ -n "$FILE" ] && [ -f "$FILE" ] || { echo "usage: bash fm-send.sh [--again] <message file>" >&2; exit 2; }
TEXT="$(cat "$FILE")"; [ -n "${TEXT// /}" ] || { echo "REFUSED: the file is empty" >&2; exit 2; }
HASH="$(printf '%s' "$TEXT" | md5sum | cut -c1-12)"; touch "$LEDGER"
if [ $AGAIN -eq 0 ] && grep -q "	$HASH	" "$LEDGER"; then
  echo "SKIPPED: this exact word already went to firstmate at $(grep "	$HASH	" "$LEDGER" | head -1 |
    cut -f1); use --again to send it anyway"
  exit 3
fi
command -v herdr >/dev/null 2>&1 || export PATH="$HOME/.local/bin:$PATH"
command -v herdr >/dev/null 2>&1 || { echo "REFUSED: herdr is not on the path in WSL" >&2; exit 5; }
PANE="$(herdr agent list 2>/dev/null | python3 -c "
import json, sys
try: d = json.load(sys.stdin)
except Exception: sys.exit(0)
ags = d.get('result', d).get('agents', []) if isinstance(d, dict) else d
for a in ags:
    if a.get('agent') == 'claude' and a.get('cwd') == '$FM_HOME': print(a.get('pane_id') or a.get('pane') or ''); break
" 2>/dev/null)"
[ -n "$PANE" ] || {
  echo "REFUSED: firstmate's pane is not in herdr agent list (a claude agent with cwd $FM_HOME);" \
    "is firstmate running?" >&2
  exit 5
}
if [ -f "$FM_HOME/bin/fm-backend.sh" ]; then
  ST="$(cd "$FM_HOME" && . bin/fm-backend.sh >/dev/null 2>&1 && fm_backend_composer_state herdr "default:$PANE" \
    2>/dev/null || echo unknown)"
  case "$ST" in
    empty|unknown) ;;
    *) echo "SKIPPED: firstmate's composer is not empty ($ST); send again at a seam"; exit 4 ;;
  esac
fi
OUT="$(herdr agent prompt "$PANE" "$TEXT" 2>&1)"; RC=$?
if [ $RC -eq 0 ]; then
  printf '%s\t%s\t%s\n' "$(date '+%Y-%m-%d %H:%M:%S %Z')" "$HASH" "$(printf '%s' "$TEXT" | tr '\n\t' '  ' |
    cut -c1-160)" >> "$LEDGER"
  echo "SENT to firstmate (pane $PANE): $(printf '%s' "$TEXT" | tr '\n' ' ' | cut -c1-160)"
  [ -n "$OUT" ] && echo "herdr said: $(printf '%s' "$OUT" | tr '\n' ' ' | cut -c1-200)"
else
  echo "FAILED (exit $RC): $(printf '%s' "$OUT" | tr '\n' ' ' | cut -c1-300)" >&2; exit $RC
fi
