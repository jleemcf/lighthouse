#!/usr/bin/env bash
# Lighthouse board server manager, for the WSL host that runs it.
#   board.sh start | stop | status | restart | claim <name> [lines|tools|shadow|collector|steward]
#            | archive [board] [days] | clear-cards <board>
#   (LH_CONFIG selects the config; storeFile is relative to that config)
# Starts the server detached from the calling shell (setsid + nohup) so it survives the terminal, the Claude session
# and the Codex app; never start it from inside an agent's process tree that may be killed on close.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
CONTROLLED="${LH_CONTROL_LOCKED:-}"
if [ "$CONTROLLED" != 1 ]; then
  if [ -f "$HERE/.board-deploy.json" ]; then
    case "${1:-status}" in
      start|restart|archive|clear-cards)
        echo "unfinished deployment; run deploy-board.sh recover first" >&2; exit 1 ;;
    esac
  fi
  exec 9>"$HERE/.board-control.lock"
  flock -n 9 || { echo "another board operation holds the control lock" >&2; exit 1; }
  export LH_CONTROL_LOCKED=1
fi
RELEASE="$HERE"
if [ -L "$HERE/current" ]; then
  RELEASE="$(readlink -f "$HERE/current")"
  [ -f "$RELEASE/server.js" ] || { echo "current release is missing" >&2; exit 1; }
fi
CONFIG="${LH_CONFIG:-$HERE/config.json}"
PIDF="$HERE/board.pid"; LOG="$HERE/board.log"
NODE="${NODE:-$(command -v node)}"
# the pid must be alive AND be this server: after a reboot the number in the file can belong to something else, and
# status must not say "running" of a dead board
alive() {
  [ -f "$PIDF" ] || return 1; local p; p="$(cat "$PIDF")"; kill -0 "$p" 2>/dev/null || return 1
  [[ "$(cat "/proc/$p/stat" 2>/dev/null)" != *") Z "* ]] || return 1
  tr '\0' '\n' < "/proc/$p/cmdline" 2>/dev/null | grep -Fxq "$RELEASE/server.js"; }
restart_after() {
  local result="$1" restarted=0
  if [ "$result" -ne 0 ]; then echo "maintenance failed (exit $result)" >&2; fi
  bash "$0" start || restarted=$?
  if [ "$result" -ne 0 ]; then return "$result"; fi
  return "$restarted"
}
case "${1:-status}" in
  start)
    if alive; then echo "already running, pid $(cat "$PIDF")"; exit 0; fi
    [ -f "$CONFIG" ] || { echo "no config at $CONFIG"; exit 2; }
    setsid nohup env -u LH_CONTROL_LOCKED "$NODE" "$RELEASE/server.js" --config "$CONFIG" \
      >> "$LOG" 2>&1 < /dev/null 9>&- &
    echo $! > "$PIDF"; sleep 1
    if alive; then
      echo "started, pid $(cat "$PIDF"); log $LOG"; tail -1 "$LOG"
    else
      echo "failed to start; see $LOG"; tail -5 "$LOG"; exit 1
    fi ;;
  stop)
    if alive; then
      p="$(cat "$PIDF")"
      kill "$p" || exit 1
      for i in {1..150}; do
        if ! kill -0 "$p" 2>/dev/null || [[ "$(cat "/proc/$p/stat" 2>/dev/null)" == *") Z "* ]]; then
          rm -f "$PIDF" || exit 1
          echo "stopped"; exit 0
        fi
        sleep 0.1
      done
      echo "server $p did not stop within 15 seconds; kept $PIDF" >&2
      exit 1
    else
      echo "not running"; rm -f "$PIDF"
    fi ;;
  restart) bash "$0" stop && sleep 1 && bash "$0" start ;;
  claim)
    # board.sh claim <name> [lines|tools|shadow|collector|steward]: print a one-time code, good for an hour, that
    # hands that token over (shift.sh claim <code> on its machine puts it in the right file)
    name="${2:-}"
    [ -n "$name" ] || { echo "usage: board.sh claim <name> [lines|tools|shadow|collector|steward]" >&2; exit 2; }
    python3 - "$name" "$CONFIG" "${3:-lines}" <<'PY'
import json, os, secrets, sys, time
name, config, kind = sys.argv[1], sys.argv[2], sys.argv[3]
home = os.path.dirname(os.path.abspath(config))
if kind not in ("lines", "tools", "shadow", "collector", "steward"):
    sys.exit("the kind is lines, tools, shadow, collector or steward")
fits = lambda v: bool(v.get("shadow")) if kind == "shadow" \
    else (not v.get("shadow") and (v.get("mode") or "lines") == kind)
cfg = json.load(open(config))
if not any(v.get("name") == name and v.get("via") == "api" and fits(v) for v in cfg.get("tokens", {}).values()):
    sys.exit("no %s token is issued for %s" % (kind, name))
alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
code = "".join(secrets.choice(alphabet) for _ in range(8))
os.makedirs(os.path.join(home, "claims"), exist_ok=True)
json.dump({"name": name, "kind": kind, "exp": int(time.time() * 1000) + 60 * 60 * 1000},
          open(os.path.join(home, "claims", code + ".json"), "w"))
print(code)
PY
    ;;
  archive)
    target="$("$NODE" "$RELEASE/config-target.js" "$CONFIG" "${2:-}")" || exit 2
    # board.sh archive [board] [days]: stop, move Done cards older than N days into config.archiveDir, start again
    bash "$0" stop || exit $?
    "$NODE" "$RELEASE/server.js" --config "$CONFIG" archive --board "$target" --days "${3:-7}"
    result=$?
    restart_after "$result" ;;
  clear-cards)
    # board.sh clear-cards <board>: at Owner's word only. Stop, copy the store aside, move EVERY card of the board
    # (any state) with its conversation into the archive, keep General and the transcript, start again. The operator
    # then re-opens its tasks with a fresh sweep.
    b="${2:-}"; [ -n "$b" ] || { echo "usage: board.sh clear-cards <board>" >&2; exit 2; }
    bash "$0" stop || exit $?
    store="$(python3 -c '
import json, os, sys
config = os.path.abspath(sys.argv[1])
cfg = json.load(open(config))
print(os.path.abspath(os.path.join(os.path.dirname(config), cfg.get("storeFile") or "store.json")))
' "$CONFIG")"
    result=$?
    if [ "$result" -ne 0 ]; then restart_after "$result"; exit $?; fi
    result=0
    cp -p "$store" "$store.bak-$(date +%Y%m%d-%H%M%S)-before-clearing-$b" || result=$?
    if [ "$result" -ne 0 ]; then
      echo "safety copy failed; cards were not cleared" >&2
      restart_after "$result"; exit $?
    fi
    echo "store copied aside"
    "$NODE" "$RELEASE/server.js" --config "$CONFIG" archive --board "$b" --all
    result=$?
    restart_after "$result" ;;
  status)
    if alive; then
      echo "running, pid $(cat "$PIDF")"
      echo "release $RELEASE"
      port=$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1])).get("port",7700))' "$CONFIG" 2>/dev/null ||
        echo 7700)
      curl -s -m 3 "http://127.0.0.1:$port/api/whoami" || echo "(no answer on $port)"
      echo
    else
      echo "not running"
    fi ;;
  *) echo "usage: board.sh start|stop|status|restart|claim <name> [lines|tools|shadow|collector|steward]" \
          "|archive [board] [days]|clear-cards <board>"
     exit 2 ;;
esac
