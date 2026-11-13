#!/usr/bin/env bash
# Lighthouse board server manager, for the WSL host that runs it.
#   board.sh start | stop | status | restart | archive [board] [days]
#   (config.json and store.json live beside this script)
# Starts the server detached from the calling shell (setsid + nohup) so it survives the terminal, the Claude session
# and the Codex app; never start it from inside an agent's process tree that may be killed on close.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
CONFIG="${LH_CONFIG:-$HERE/config.json}"
PIDF="$HERE/board.pid"; LOG="$HERE/board.log"
NODE="${NODE:-$(command -v node)}"
# the pid must be alive AND be this server: after a reboot the number in the file can belong to something else, and
# status must not say "running" of a dead board
alive() {
  [ -f "$PIDF" ] || return 1; local p; p="$(cat "$PIDF")"; kill -0 "$p" 2>/dev/null || return 1
  tr '\0' ' ' < "/proc/$p/cmdline" 2>/dev/null | grep -q "server.js"; }
case "${1:-status}" in
  start)
    if alive; then echo "already running, pid $(cat "$PIDF")"; exit 0; fi
    [ -f "$CONFIG" ] || { echo "no config at $CONFIG"; exit 2; }
    setsid nohup "$NODE" "$HERE/server.js" --config "$CONFIG" >> "$LOG" 2>&1 < /dev/null &
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
  status)
    if alive; then
      echo "running, pid $(cat "$PIDF")"
      port=$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1])).get("port",7700))' "$CONFIG" 2>/dev/null ||
        echo 7700)
      curl -s -m 3 "http://127.0.0.1:$port/api/whoami" || echo "(no answer on $port)"
      echo
    else
      echo "not running"
    fi ;;
  *) echo "usage: board.sh start|stop|status|restart"; exit 2 ;;
esac
