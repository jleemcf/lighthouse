#!/usr/bin/env bash
# The operator's shift command: "start shift" brings everything up, "end shift" takes it all down and the operator
# does nothing until the next start.
#   bash shift.sh start | stop | status | clock | claim <code> | gate <mode>|status | mark <event> acted|noise
#                 | kill-watchers | outbox start|stop|restart|status | update | steward start|stop|restart|status
#                 | kit-status
# claim:  once, at setup: exchanges a one-time code Owner gives you for this machine's token, written into LH-TOKEN.txt
#         in this folder and in the WSL twin. The token is never shown.
# start:  prints the clock (ET, from Windows' own zone tables) and brings the outbox up (the collector, hidden, one
#         instance per home, through Start-Collector.ps1 beside this script).
# stop:   takes the outbox down.   status: says whether it is up.   clock: the time in ET, the only clock to trust.
# The watchers are Monitors inside the operator's session, one each as the advisors have always run them, so the
# operator arms and stops those itself. Start/stop also confirm the board's shift edge, manage the advice steward,
# and print the current rules. update stages and verifies both kit copies; kit-status reports versions/reconnects.
# gate:   the wake gate's mode (gate.cjs, piped after a watcher): off | rules | observe | shadow | hold, live, no
#         restart; `gate status` reads its heartbeat. mark: a hand correction for the measuring week (`gate-report.py`).
# kill-watchers: stops every watcher, route and gate process of this home (Kill-Watchers.ps1: the home's own pid files
#         and gate registry, and shells whose command line names the home; never by parentage, which on Git Bash can
#         kill a live sweep). `stop` does the same after taking the outbox down; `start` clears leftovers first.
#         Mid-shift, the outbox alone: `outbox restart` (a `stop`/`start` pair would take the watchers down with it).
set -u
# New guided homes use core tools without optional Windows/WSL adapters. Legacy homes keep the existing path.
HERE="${SHIFT_HOME:-$(cd "$(dirname "$0")" && pwd)}"
if [ -f "$HERE/binding.json" ]; then
  case "${1:-}" in
    start|stop|end|status|doctor|update)
      exec node "$HERE/setup-runtime.cjs" "$1" ;;
  esac
fi
# typing `bash` in PowerShell starts WSL's bash, where python and powershell are not the Windows ones
if [ -n "${WSL_DISTRO_NAME:-}" ] || grep -qi microsoft /proc/version 2>/dev/null; then
  echo "shift.sh runs in Git Bash on the Windows side; this is WSL's bash." \
    "Open Git Bash, or from PowerShell run:  & 'C:\Program Files\Git\bin\bash.exe' shift.sh ${*:-start}" >&2
  exit 2
fi
# SHIFT_HOME: set when update re-runs this script from a copy of itself (see update)
HERE="${SHIFT_HOME:-$(cd "$(dirname "$0")" && pwd)}"
# stamped by the installer: looking the name up by its key would fail, since the installer replaces the key too
MACHINE="__MACHINE_NAME__"
SERVER="__BOARD_SERVER__"; DISTRO="__WSL_DISTRO__"; WSL_HOME="__OPERATOR_WSL_DIR__"
PS="powershell -NoProfile -ExecutionPolicy Bypass"
STARTER="$(cygpath -w "$HERE/Start-Collector.ps1" 2>/dev/null || echo "$HERE/Start-Collector.ps1")"
clock() {
  $PS -Command "[System.TimeZoneInfo]::ConvertTimeBySystemTimeZoneId((Get-Date), '__WINDOWS_TIME_ZONE__')"\
".ToString('h:mm tt') + ' __TIME_ZONE_LABEL__'" | tr -d '\r'; }
# the steward's waker, only where it is installed: Start-Steward.ps1 says "no steward" elsewhere
steward() {
  local tmp code; tmp="$(mktemp)" || return 1
  $PS -File "$(cygpath -w "$HERE/Start-Steward.ps1" 2>/dev/null || echo "$HERE/Start-Steward.ps1")" \
    -Action "$1" > "$tmp" 2>&1 < /dev/null
  code=$?; tr -d '\r' < "$tmp"; rm -f "$tmp"; return "$code"; }
# through a file, not a pipe: the hidden collector inherits PowerShell's stdout handle, and a pipe would then wait for
# the collector itself to exit, so start would hang
outbox() {
  local tmp code; tmp="$(mktemp)" || return 1
  $PS -File "$STARTER" -Action "$1" > "$tmp" 2>&1 < /dev/null
  code=$?; tr -d '\r' < "$tmp"; rm -f "$tmp"; return "$code"; }
# "started" is not running: a collector that dies at once (on an unreadable cursor, say) says so here, with its
# error, instead of leaving the board silent
outbox_alive() {
  sleep 4; outbox status | grep -q '^running' && return 0
  echo "outbox: NOT RUNNING: the collector stopped right after it started; nothing you write reaches the board." \
    "Its last error:"
  tail -n 6 "$HERE/collector.err" 2>/dev/null | tr -d '\r' | sed 's/^/  /'; return 1; }
kill_watchers() {   # $1 = -OrphansOnly to clear only what a stopped Monitor left running
  local ps1; ps1="$(cygpath -w "$HERE/Kill-Watchers.ps1" 2>/dev/null || echo "$HERE/Kill-Watchers.ps1")"
  if [ -f "$HERE/lh.pid" ] && [ "${1:-}" != "-OrphansOnly" ]; then
    local sp; sp="$(tr -d '\r\n' < "$HERE/lh.pid")"
    kill "$sp" 2>/dev/null && echo "watchers: stopped the sweep (pid $sp, from lh.pid)"
  fi
  [ -f "$HERE/Kill-Watchers.ps1" ] || { echo "watchers: Kill-Watchers.ps1 is not installed here"; return 0; }
  $PS -File "$ps1" -OperatorHome "$(cygpath -w "$HERE" 2>/dev/null || echo "$HERE")" ${1:-} < /dev/null 2>&1 |
    tr -d '\r' | sed 's/^/watchers: /'; }
# Windows will not let the installer replace a file a running Monitor or this very script holds open; the installer
# then writes <name>.new, and this swaps it in once the file is free. Runs at every start and at the end of every
# update.
swap_new() {
  local n f failed=0; for n in "$HERE"/*.new "$HERE"/wsl/*.new; do [ -f "$n" ] || continue; f="${n%.new}"
    if mv -f "$n" "$f" 2>/dev/null; then echo "swapped in $(basename "$f") (was pending from an update)"
    else echo "still pending: $(basename "$f") is open; stop the Monitor that runs it and run:" \
        "bash shift.sh ${1:-start}"
      failed=1
    fi; done; return "$failed"; }
rules() {   # the rules, printed at every start shift from the installed brief, so they are known exactly
  # the home's protocol, from its token files: LH-COLLECTOR-TOKEN.txt is tool mode (the collector reports with its own
  # token), LH-SHADOW-TOKEN.txt is a shadow trial (lines still answer Owner; the tools only dry-run), neither is lines
  local mode=lines rc=0
  [ -f "$HERE/LH-SHADOW-TOKEN.txt" ] && mode=shadow
  [ -f "$HERE/LH-COLLECTOR-TOKEN.txt" ] && mode=tools
  # is the session running this writing in the configured folder? One in another folder goes silent while every check
  # stays green. LH_SKIP_HERE=1 when shift.sh is run outside the operator's own session
  local here_out here_rc=0
  if [ "${LH_SKIP_HERE:-}" != 1 ]; then
    here_out="$(node "$(cygpath -w "$HERE/lighthouse-mcp.cjs" 2>/dev/null || echo "$HERE/lighthouse-mcp.cjs")" here \
      < /dev/null 2>&1)"; here_rc=$?
  fi
  if [ "$here_rc" != 0 ]; then
    printf '%s\n' "$here_out" | tr -d '\r'
    if [ "$mode" = tools ]; then
      echo "TOOL MODE REFUSED: this session is not where the board's tools and your collector look." \
        "Tell Owner in your chat; start the operator in the configured folder."
      return 3
    fi
    echo "WARNING: from this folder your lines do not reach the board. Tell Owner in your chat."
  fi
  if [ "$mode" = tools ]; then
    [ -f "$HERE/LH-SHADOW-TOKEN.txt" ] &&
      echo "TOOLS: LH-SHADOW-TOKEN.txt is still here beside the tool-mode tokens, so your tools only dry-run;" \
        "the chief developer removes it at the switch."
    [ -f "$HERE/OPERATOR-BRIEF-TOOLS.md" ] && {
      echo; echo "Tool mode, in short (OPERATOR-BRIEF-TOOLS.md):"
      sed -n '/<!-- tool-rules -->/,/<!-- \/tool-rules -->/p' "$HERE/OPERATOR-BRIEF-TOOLS.md" | grep -v '^<!--' |
        tr -d '\r'; }
  elif [ -f "$HERE/OPERATOR-BRIEF.md" ]; then
    echo; echo "The line, in short (OPERATOR-BRIEF.md):"
    sed -n '/<!-- line-rules -->/,/<!-- \/line-rules -->/p' "$HERE/OPERATOR-BRIEF.md" | grep -v '^<!--' | tr -d '\r'
    [ "$mode" = shadow ] &&
      echo "SHADOW TRIAL: these lines are still what answer Owner. Alongside each act, make the matching lighthouse" \
        "tool call (OPERATOR-BRIEF-TOOLS.md, Shadow first); it only dry-runs."
  fi
  [ "$mode" = lines ] && return 0
  # the tools must be registered at local scope for this operator's session, with the compaction hooks
  # (TOOLCALL-DESIGN §3)
  echo
  node "$(cygpath -w "$HERE/lighthouse-mcp.cjs" 2>/dev/null || echo "$HERE/lighthouse-mcp.cjs")" check \
    < /dev/null 2>&1 | tr -d '\r'; rc=${PIPESTATUS[0]}
  [ "$rc" = 0 ] && return 0
  if [ "$mode" = tools ]; then
    echo "TOOL MODE REFUSED: without the lighthouse tools nothing you do reaches the board. Tell Owner in your chat" \
      "that your tools are not ready, and work no other route until the chief developer fixes it."
  else
    echo "SHADOW NOT READY: keep to your lines as always; tell Owner in a line that the tool trial cannot run this" \
      "shift."
  fi
  return 3; }
gate() {
  case "${1:-status}" in
    off|rules|observe|shadow|hold)
      printf '%s\n' "$1" > "$HERE/gate-mode"
      echo "gate: $1 (gate-mode written; a running gate switches within seconds)"
      ;;
    status)
      echo "gate mode file: $(tr -d '\r\n' < "$HERE/gate-mode" 2>/dev/null ||
        echo "(none; the installed default applies)")"
      [ -f "$HERE/gate-heartbeat.json" ] || { echo "gate heartbeat: none (no gate has run in this home)"; return 0; }
      python - "$HERE/gate-heartbeat.json" <<'PYHB'
import json, sys, datetime
h = json.load(open(sys.argv[1], encoding="utf-8"))
t = datetime.datetime.fromisoformat(h["t"].replace("Z", "+00:00"))
age = int((datetime.datetime.now(datetime.timezone.utc) - t).total_seconds() // 60)
print(f"gate heartbeat: {age} min ago, mode {h.get('mode')} (effective {h.get('effective')}), pid {h.get('pid')}")
print(f"  since start {h.get('started','')[:16]}: judged {h.get('judged',0)}, woke {h.get('woke',0)}, "
      f"held {h.get('held',0)} ({h.get('heldNow',0)} waiting now), dropped {h.get('dropped',0)}, "
      f"passed {h.get('passed',0)}, failed {h.get('failed',0)}")
if h.get("failOpenSince"): print(f"  FAIL-OPEN since {h['failOpenSince'][:16]}: every line wakes; Jev is not answering")
if h.get("offUntil"): print(f"  release window: off until {h['offUntil'][:16]}")
PYHB
      ;;
    *) echo "usage: bash shift.sh gate off|rules|observe|shadow|hold|status" >&2; return 2 ;;
  esac; }
case "${1:-}" in
  clock)  clock ;;
  gate)   gate "${2:-status}" ;;
  mark)   case "${3:-}" in
            acted|noise)
              printf '{"id":"%s","mark":"%s","at":"%s"}\n' "$2" "$3" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
                >> "$HERE/gate-marks.jsonl"
              echo "marked $2 $3" ;;
            *) echo "usage: bash shift.sh mark <event id> acted|noise" >&2; exit 2 ;;
          esac ;;
  start)  kill_watchers; swap_new; echo "clock: $(clock)"
          node "$HERE/lighthouse-mcp.cjs" shift start || exit $?
          echo "outbox: $(outbox start)"; outbox_alive
          echo "steward: $(steward start)"; rules; node "$HERE/kit-version.cjs" "$HERE" notice ;;
  outbox) case "${2:-status}" in
            start|stop|status) echo "outbox: $(outbox "$2")" ;;
            restart) echo "outbox: $(outbox stop)"; sleep 1; echo "outbox: $(outbox start)"; outbox_alive ;;
            *) echo "usage: bash shift.sh outbox start|stop|restart|status" >&2; exit 2 ;; esac ;;
  # the stop time: the next start's collector skips untagged prose written while the shift was off
  stop)   shift_rc=0; node "$HERE/lighthouse-mcp.cjs" shift end || shift_rc=$?
          echo "outbox: $(outbox stop)"; echo "steward: $(steward stop)"
          date -u +%Y-%m-%dT%H:%M:%SZ > "$HERE/shift-stopped.txt"; kill_watchers; echo "clock: $(clock)"
          exit "$shift_rc" ;;
  kill-watchers) kill_watchers ;;
  status) echo "outbox: $(outbox status)"; echo "steward: $(steward status)"; echo "clock: $(clock)"
          node "$HERE/kit-version.cjs" "$HERE" ;;
  kit-status) node "$HERE/kit-version.cjs" "$HERE" ;;
  doctor) node "$HERE/setup-runtime.cjs" doctor ;;
  steward) case "${2:-status}" in   # the steward's waker, where this machine has one: kept running like the collector
      start|stop|status) echo "steward: $(steward "$2")" ;;
      restart) echo "steward: $(steward stop)"; echo "steward: $(steward start)" ;;
      *) echo "usage: bash shift.sh steward start|stop|status|restart" >&2; exit 2 ;; esac ;;
  # when the chief developer says the kit changed: pull the repository this home was installed from, re-install into
  # this home from its own config, refresh the WSL half
  update)
    set -o pipefail
    shopt -s execfail
    update_state="Windows and WSL unchanged"
    update_notice() {
      if [ -f "$HERE/kit-version.cjs" ]; then
        node "$HERE/kit-version.cjs" "$HERE" notice 2>/dev/null
        return
      fi
      [ -n "${mcp_before:-}" ] || return 0
      mcp_after="$(sha256sum "$HERE/lighthouse-mcp.cjs" "$HERE/toolcalls-spec.json" \
        "$HERE/lighthouse-mcp.cjs.new" "$HERE/toolcalls-spec.json.new" 2>/dev/null)"
      if [ "$mcp_before" != "$mcp_after" ]; then
        echo "Lighthouse tools changed: reconnect the lighthouse MCP server with /mcp, or restart the session." \
          "A running session keeps the old tools until you do."
      fi
    }
    update_fail() {
      echo "Update incomplete: $1. $update_state. Rerun update after correcting the failed phase." >&2
      update_notice
      exit 1
    }
    if [ "${KIT_UPDATE_DRIVER:-}" != 1 ]; then
      repo="$(sed -n 2p "$HERE/REPO.txt" 2>/dev/null | tr -d '\r')"
      [ -d "$repo" ] || update_fail "REPO.txt names no repository; run the installer by hand"
      home_win="$(cygpath -am "$HERE")" || update_fail "Windows path conversion"
      repo_win="$(cygpath -am "$repo")" || update_fail "repository path conversion"
      bash_win="$(cygpath -am "$BASH")" || update_fail "Git Bash path conversion"
      MSYS_NO_PATHCONV=1 exec python "$repo_win/lighthouse/operator-kit/bootstrap.py" \
        --home "$home_win" --bash "$bash_win"
      update_fail "bootstrap launch; see README one-time migration"
    fi
    # run from a copy, so this file is not open while the installer replaces it (Windows refuses otherwise)
    if [ -z "${SHIFT_HOME:-}" ]; then
      tmp="$(mktemp)" || update_fail "temporary updater"
      cp "$0" "$tmp" || { rm -f "$tmp"; update_fail "updater copy"; }
      SHIFT_UPDATE_TEMP="$tmp" SHIFT_HOME="$HERE" exec bash "$tmp" update
      update_fail "updater launch"
    fi
    if [ -n "${SHIFT_UPDATE_TEMP:-}" ]; then trap 'rm -f "$SHIFT_UPDATE_TEMP"' EXIT; fi
    repo="${KIT_UPDATE_SOURCE:-$(sed -n 2p "$HERE/REPO.txt" 2>/dev/null | tr -d '\r')}"
    [ -d "$repo" ] || update_fail "REPO.txt names no repository; run the installer by hand"
    mcp_before="$(sha256sum "$HERE/lighthouse-mcp.cjs" "$HERE/toolcalls-spec.json" \
      "$HERE/lighthouse-mcp.cjs.new" "$HERE/toolcalls-spec.json.new" 2>/dev/null)"
    if [ -z "${KIT_UPDATE_SOURCE:-}" ]; then
      git -C "$repo" pull --ff-only >/dev/null 2>&1 || update_fail "repository refresh"
    fi
    home_win="$(cygpath -am "$HERE")" || update_fail "Windows path conversion"
    repo_win="$(cygpath -am "$repo")" || update_fail "repository path conversion"
    machine="$(printf '%s' "$MACHINE" | tr 'A-Z' 'a-z')"
    install_options=()
    if [ -n "${KIT_UPDATE_REPOSITORY:-}" ]; then
      install_options=(--repository "$KIT_UPDATE_REPOSITORY" --release "$KIT_UPDATE_RELEASE")
    fi
    update_state="Windows installation may be partial; WSL unchanged"
    # the repository's config for this machine brings new keys; this home's typed values (the board address) are kept
    if [ -n "$machine" ] && [ -f "$repo/private/machines/$machine/operator-config.json" ]; then
      MSYS_NO_PATHCONV=1 python "$repo_win/lighthouse/operator-kit/install.py" \
        --config "$repo_win/private/machines/$machine/operator-config.json" \
        --keep-from "$home_win/config.json" --out "$home_win" "${install_options[@]}" \
        >/dev/null 2>&1 || update_fail "installer"
    else
      MSYS_NO_PATHCONV=1 python "$repo_win/lighthouse/operator-kit/install.py" \
        --config "${KIT_UPDATE_CONFIG:-$home_win/config.json}" --out "$home_win" "${install_options[@]}" \
        >/dev/null 2>&1 || update_fail "installer"
    fi
    swap_new update 2>/dev/null || update_fail "Windows activation (.new files remain)"
    MSYS_NO_PATHCONV=1 python "$repo_win/lighthouse/operator-kit/scripts/kit-state.py" \
      "$home_win" "$home_win/KIT-MANIFEST.json" >/dev/null 2>&1 || update_fail "Windows manifest verification"
    update_state="Windows verified; WSL may be partial"
    # C:\Users\x\lighthouse-operator -> /mnt/c/Users/x/lighthouse-operator
    mnt="$home_win"
    if [[ "$mnt" == ?:/* ]]; then
      drive="$(printf '%s' "${mnt:0:1}" | tr 'A-Z' 'a-z')"
      mnt="/mnt/$drive/${mnt:3}"
    fi
    MSYS_NO_PATHCONV=1 wsl -d "$DISTRO" -e bash -c '
      set -e
      mkdir -p "$2"
      cp -r "$1/wsl/." "$2/"
      chmod +x "$2"/*.sh
      python3 "$1/kit-state.py" "$2" "$1/KIT-MANIFEST.json" --side wsl
      cp "$1/KIT-MANIFEST.json" "$2/KIT-MANIFEST.json"
    ' kit-update "$mnt" "$WSL_HOME" >/dev/null 2>&1 || update_fail "WSL copy or verification"
    update_state="Windows and WSL verified; helper activation incomplete"
    # a running collector keeps the old code until it restarts: restart it now
    helper_status="$(outbox status 2>/dev/null)" || update_fail "outbox status"
    if printf '%s\n' "$helper_status" | grep -q '^running'; then
      outbox stop >/dev/null 2>&1 || update_fail "outbox stop"
      outbox start >/dev/null 2>&1 || update_fail "outbox start"
      outbox_alive >/dev/null 2>&1 || update_fail "outbox health"
    fi
    # the steward's waker too, or it runs the old code beside the new brief; a job it was on goes back to the board's
    # queue and runs again
    helper_status="$(steward status 2>/dev/null)" || update_fail "steward status"
    if printf '%s\n' "$helper_status" | grep -q '^running'; then
      steward stop >/dev/null 2>&1 || update_fail "steward stop"
      steward start >/dev/null 2>&1 || update_fail "steward start"
    fi
    echo "Update complete: Windows and WSL scripts match the target manifest."
    update_notice
    ;;
  claim)
    code="${2:-}"; [ -n "$code" ] || { echo "usage: bash shift.sh claim <code>" >&2; exit 2; }
    MSYS_NO_PATHCONV=1 python - "$SERVER" "$code" "$(cygpath -w "$HERE/LH-TOKEN.txt")" "$DISTRO" "$WSL_HOME" <<'PY'
import json, os, subprocess, sys, urllib.request, urllib.error
server, code, out, distro, wsl_home = sys.argv[1:6]
req = urllib.request.Request(server.rstrip("/") + "/api/claim", data=json.dumps({"code": code}).encode(),
                             headers={"Content-Type": "application/json"}, method="POST")
try:
    with urllib.request.urlopen(req, timeout=20) as r: j = json.loads(r.read().decode())
except urllib.error.HTTPError as e:
    try: msg = json.loads(e.read().decode()).get("error", "")
    except Exception: msg = ""
    sys.exit("the board refused the code: " + (msg or str(e.code)))
tok = j.get("token", "")
if not tok: sys.exit("the board returned no token")
# a switch to tools: the shadow and collector tokens have files of their own, on the Windows side only
kind = j.get("kind", "lines")
# the advice steward's token sits beside stwake.cjs, which alone reads it
if kind in ("shadow", "collector", "steward"):
    out = os.path.join(os.path.dirname(out), {"shadow": "LH-SHADOW-TOKEN.txt", "collector": "LH-COLLECTOR-TOKEN.txt",
                                              "steward": "LH-STEWARD-TOKEN.txt"}[kind])
with open(out, "w", encoding="utf-8", newline="\n") as f: f.write(tok + "\n")
try: os.chmod(out, 0o600)
except Exception: pass
try:   # Windows ignores that mode; the ACL is what counts there: this user only
    if os.name == "nt":
        subprocess.run(["icacls", out, "/inheritance:r", "/grant:r", os.environ.get("USERNAME", "") + ":F"],
                       capture_output=True)
except Exception: pass
if kind in ("shadow", "collector", "steward"):
    print(kind + " token placed for " + j.get("name", "?") + " in " + out); sys.exit(0)
r = subprocess.run(["wsl", "-d", distro, "--", "bash", "-c",
                    "umask 077 && mkdir -p '" + wsl_home + "' && cat > '" + wsl_home + "/LH-TOKEN.txt'"],
                   input=(tok + "\n").encode(), capture_output=True)
print("token placed for " + j.get("name", "?") + " in " + out
      + (" and in " + wsl_home + "/LH-TOKEN.txt" if r.returncode == 0
         else "; the WSL copy failed: " + r.stderr.decode(errors="replace").strip()))
PY
    ;;
  *)      echo "usage: bash shift.sh start|stop|status|clock|claim <code>|gate <mode>|status|mark <event>" \
            "acted|noise | kill-watchers | outbox start|stop|restart|status | update |" \
            "steward start|stop|restart|status | kit-status" \
            >&2; exit 2 ;;
esac
