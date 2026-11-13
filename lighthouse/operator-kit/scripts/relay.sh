#!/usr/bin/env bash
# Lighthouse relay: the captain's words, verbatim, on Send, to firstmate only.
#   bash relay.sh firstmate <file>    send the file through the machine's configured firstmate command
#   bash relay.sh --again ...         send even if this exact text was relayed before
# A ledger keeps hashes to refuse accidental duplicate sends; the advice steward never takes prompts.
# The route is the home's configured FM_SEND: herdr in WSL, a command with {file}, or none-yet.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
FM_SEND="__FM_SEND__"
DISTRO="__WSL_DISTRO__"; WSL_HOME="__OPERATOR_WSL_DIR__"
LEDGER="$HERE/relay-ledger.tsv"; LAST="$HERE/relay-last.txt"
AGAIN=0; [ "${1:-}" = "--again" ] && { AGAIN=1; shift; }
TO="${1:-}"; FILE="${2:-}"
case "$TO" in
  firstmate) ;;
  *) echo "usage: bash relay.sh [--again] firstmate <file with the captain's words>" >&2; exit 2 ;;
esac
[ -n "$FILE" ] && [ -f "$FILE" ] || {
  echo "usage: bash relay.sh [--again] firstmate <file with the captain's words>" >&2; exit 2
}
TEXT="$(cat "$FILE")"; [ -n "${TEXT// /}" ] || { echo "REFUSED: the file is empty" >&2; exit 2; }
HASH="$(printf '%s' "$TO:$TEXT" | md5sum | cut -c1-12)"
touch "$LEDGER"
if [ $AGAIN -eq 0 ] && grep -q "^[^	]*	$HASH	" "$LEDGER"; then
  echo "SKIPPED: this exact word already went to the $TO at $(grep "	$HASH	" "$LEDGER" | head -1 |
    cut -f1); use --again to send it anyway"
  exit 3
fi
CLOCK="$(bash "$HERE/shift.sh" clock 2>/dev/null || date '+%H:%M')"
MSG="$TEXT"
MSGF="$(mktemp "$HERE/relay-msg.XXXXXX")" || { echo "REFUSED: cannot write the message file" >&2; exit 2; }
trap 'rm -f "$MSGF"' EXIT
printf '%s\n' "$MSG" > "$MSGF"   # this relay's own file: two relays at once never send each other's text
printf '%s\n' "$MSG" > "$LAST"   # a copy for reading only (the no-route case below points Owner at it)
case "$TO" in
  firstmate)
    if [ "$FM_SEND" = "none-yet" ] || [ -z "$FM_SEND" ]; then
      echo "NO ROUTE YET: this machine has no configured command for typing into firstmate's pane." \
        "Deliver Owner's word by the means you have (the message is in $LAST), then put the working command" \
        "into __FM_SEND__ in this home's config.json, with {file} where the message file goes, and run" \
        "bash shift.sh update; from then on this script does it."
      exit 6
    fi
    # the WSL half's fm-send.sh, handed the message as a file path (never the text through wsl.exe)
    if [ "$FM_SEND" = "herdr" ]; then
      mnt="$(cygpath -w "$MSGF" | sed -e 's|\\|/|g' -e 's|^\([A-Za-z]\):|/mnt/\L\1|')"
      OUT="$(MSYS_NO_PATHCONV=1 wsl -d "$DISTRO" -- bash "$WSL_HOME/fm-send.sh" $([ $AGAIN -eq 1 ] && echo --again) \
        "$mnt" 2>&1)"; RC=$?
    else
      CMD="${FM_SEND//\{file\}/$MSGF}"
      OUT="$(bash -c "$CMD" 2>&1)"; RC=$?
    fi
    ;;
esac
if [ $RC -eq 0 ]; then
  printf '%s\t%s\t%s\t%s\n' "$(date '+%Y-%m-%d %H:%M:%S %Z')" "$HASH" "$TO" "$(printf '%s' "$TEXT" |
    tr '\n\t' '  ' | cut -c1-160)" >> "$LEDGER"
  echo "SENT to the $TO at $CLOCK: $(printf '%s' "$TEXT" | tr '\n' ' ' | cut -c1-160)"
  [ -n "$OUT" ] && echo "route said: $(printf '%s' "$OUT" | tr '\n' ' ' | cut -c1-200)"
else
  echo "FAILED (exit $RC): $(printf '%s' "$OUT" | tr '\n' ' ' | cut -c1-300)" >&2; exit $RC
fi
