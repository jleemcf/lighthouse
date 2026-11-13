#!/usr/bin/env bash
set -eu
SRC="$(cd "$(dirname "$0")" && pwd)"
DST="${LH_HOME:-$HOME/lighthouse-board}"
[ -f "$DST/config.json" ] || { echo "no board home (no config.json)" >&2; exit 2; }
[ -n "${1:-}" ] || { echo "usage: LH_HOME=<board home> bash rollback-board.sh <retained release>" >&2; exit 2; }
exec 9>"$DST/.board-control.lock"
flock -n 9 || { echo "another board operation holds the control lock" >&2; exit 1; }
export LH_CONTROL_LOCKED=1
exec "${NODE:-node}" "$SRC/board-release.js" rollback "$SRC" "$DST" "$1"
