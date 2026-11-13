#!/usr/bin/env bash
# Lighthouse sweep. Silent unless a condition changes. Read-only everywhere.
# Emits one line per finding; each line becomes one notification.
# There is no stow/clear/bearings advice. Automatic compaction is not wanted; the sweep says when it is on.

SCRATCH="$(cd "$(dirname "$0")" && pwd)"
STATE="$SCRATCH/lh-state.txt"
SWEEP_INTERVAL=${SWEEP_INTERVAL:-600}   # 10 minutes between sweeps
EXPECT_PROFILE="${EXPECT_PROFILE:-claude-opus-5-5/medium}"   # the profile Owner chose: Opus 5.5 at medium
# with no automatic compaction, a conversation past this is near the 1M window and stops when full
CONTEXT_NEAR=${CONTEXT_NEAR:-900000}

# single instance: a second sweep racing on one state file silently loses findings
LOCK="$SCRATCH/lh.pid"
if [ -f "$LOCK" ]; then
  old=$(cat "$LOCK" 2>/dev/null)
  case "$old" in ''|*[!0-9]*) old= ;; esac
  if [ -n "$old" ] && [ "$old" -gt 1 ] && [ "$old" != "$$" ] && kill -0 "$old" 2>/dev/null; then
    kill "$old" 2>/dev/null
    for attempt in {1..50}; do kill -0 "$old" 2>/dev/null || break; sleep 0.1; done
    kill -0 "$old" 2>/dev/null && kill -9 "$old" 2>/dev/null
    printf '{"t":"%s","line":"LIGHTHOUSE | replaced the previous sweep (pid %s); single instance kept"}\n' \
      "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$old" >> "$SCRATCH/watcher-starts.jsonl" 2>/dev/null
  fi
fi
echo $$ > "$LOCK"
# A TERM/INT trap that does not exit makes bash resume the loop, so the sweep
# becomes unkillable by ordinary signals, and a "stopped" sweep survives to
# race its replacement. Clean up, then actually exit.
sweep_cleanup() {
  if [ "$(cat "$LOCK" 2>/dev/null)" = "$$" ]; then rm -f "$LOCK"; fi
}
trap sweep_cleanup EXIT
trap 'kill $! 2>/dev/null; exit 143' TERM
trap 'kill $! 2>/dev/null; exit 130' INT
trap 'exit 1' PIPE

PENDING="$SCRATCH/watch-output-sweep.txt"
RECORD_PENDING="$SCRATCH/record-check-pending.txt"
lease_check() {
  [ -z "$LH_MONITOR_LEASE" ] || node "$SCRATCH/watch-lease.cjs" || exit 0
}
emit() {
  printf '%s\n' "$*" > "$PENDING" || exit 1
  lease_check
  cat "$PENDING" || exit 1
  lease_check
  : > "$PENDING" || exit 1
}
if [ -s "$PENDING" ]; then
  lease_check
  cat "$PENDING" || exit 1
  lease_check
  : > "$PENDING" || exit 1
fi

touch "$STATE"
prev() { grep -m1 "^$1=" "$STATE" 2>/dev/null | cut -d= -f2-; }

read_json() {  # file key -> value or empty
  python -c "
import json,sys
try:
    d=json.load(open(sys.argv[1]))
    v=d
    for k in sys.argv[2].split('.'): v=v.get(k) if isinstance(v,dict) else None
    print('' if v is None else v)
except Exception: print('unreadable')
" "$1" "$2" 2>/dev/null
}

age_secs() {  # iso8601 -> seconds since
  python -c "
import sys,datetime
try:
    t=sys.argv[1].replace('Z','+00:00')
    d=datetime.datetime.fromisoformat(t)
    now=datetime.datetime.now(datetime.timezone.utc)
    print(int((now-d).total_seconds()))
except Exception: print(-1)
" "$1" 2>/dev/null
}

while true; do
  lease_check
  NEW="$STATE.new"; : > "$NEW"
  FIRST=0; [ ! -s "$STATE" ] && FIRST=1

  pickup_seq=$(read_json "$SCRATCH/usage-pickup.json" sequence)
  case "$pickup_seq" in ''|*[!0-9]*) pickup_seq=$(prev usage_pickup) ;; esac
  if [ -n "$pickup_seq" ]; then
    echo "usage_pickup=$pickup_seq" >> "$NEW"
    if [ "$pickup_seq" != "$(prev usage_pickup)" ]; then
      emit "COLLECTOR | write your pickup note: context has passed 85% of the compaction window"
    fi
  fi

  # There is no waiter: the lighthouse wakes the steward itself, so no waiter checks here.
  # Live firstmate activity is followed by fmwatch.cjs; this sweep keeps the slower health checks.

  # ---- 1. firstmate: pin, profile, lock, workers, questions, compaction ----
  P=$(timeout 60 wsl -d __WSL_DISTRO__ -- bash -c 'bash __OPERATOR_WSL_DIR__/lh-probe.sh' 2>/dev/null)
  # record check: print a changed firstmate record that no task on the board mentions; it never writes the board.
  # Per-item lines only; the summary line is noise on a change-only sweep.
  if [ -s "$RECORD_PENDING" ]; then RC=$(cat "$RECORD_PENDING")
  else
    lease_check
    timeout 90 wsl -d __WSL_DISTRO__ -- bash -c 'bash __OPERATOR_WSL_DIR__/record-check.sh' \
      > "$RECORD_PENDING" 2>/dev/null
    RC=$(cat "$RECORD_PENDING")
  fi
  while IFS= read -r record; do
    case "$record" in
      *' changed of '*) continue ;;
      'RECORD CHECK | '*) emit "$record" ;;
    esac
  done <<< "$RC"
  lease_check
  : > "$RECORD_PENDING" || exit 1
  cap=$(printf '%s\n' "$P" | grep -m1 '^captain=' | cut -d= -f2)
  lock=$(printf '%s\n' "$P" | grep -m1 '^lock=' | cut -d= -f2)
  fail=$(printf '%s\n' "$P" | grep -m1 '^failed_tasks=' | cut -d= -f2)
  dblk=$(printf '%s\n' "$P" | grep -m1 '^dispatch_blocked=' | cut -d= -f2)
  cctx=$(grep -m1 "^captain_ctx=" <<< "$P" | cut -d= -f2)
  wk=$(grep -m1 "^working_tasks=" <<< "$P" | cut -d= -f2)
  cmod=$(grep -m1 "^captain_model=" <<< "$P" | cut -d= -f2)
  ceff=$(grep -m1 "^captain_effort=" <<< "$P" | cut -d= -f2)
  pdec=$(grep -m1 "^pending_decision=" <<< "$P" | cut -d= -f2)

  # instrument check: a silent probe must never be mistaken for a healthy fleet
  if [ -z "$P" ] || printf '%s\n' "$P" | grep -q '^fleet=unreachable'; then probe="unreachable"; else probe="ok"; fi
  echo "probe=$probe" >> "$NEW"
  if [ "$probe" != "$(prev probe)" ]; then
    if [ "$probe" = "ok" ]; then [ $FIRST -eq 0 ] && emit "LIGHTHOUSE ok | fleet probe reachable again"
    else emit "LIGHTHOUSE ALERT | fleet probe unreachable; firstmate checks are BLIND, not clear"; fi
  fi
  if [ "$probe" = "unreachable" ]; then
    # carry the last known values forward rather than inventing transitions
    for k in captain captain_bad lock failed dblocked profile pending working compaction autocompact; do
      echo "$k=$(prev $k)" >> "$NEW"; done
  else

  # firstmate needs two consecutive bad reads before speaking (avoids firing mid-relaunch)
  cbad=$(prev captain_bad); cbad=${cbad:-0}
  if [ "$cap" = "unpinned" ] || [ "$cap" = "absent" ]; then cbad=$((cbad+1)); else cbad=0; fi
  echo "captain_bad=$cbad" >> "$NEW"
  echo "captain=$cap" >> "$NEW"
  if [ "$cap" != "$(prev captain)" ]; then
    if [ "$cap" = "pinned" ]; then [ $FIRST -eq 0 ] && emit "LIGHTHOUSE ok | firstmate is pinned again"
    elif [ "$cbad" -ge 2 ]; then
      emit "LIGHTHOUSE ALERT | firstmate is $cap (no model/effort pin); it cannot be trusted to be on $EXPECT_PROFILE"
    fi
  elif [ "$cbad" -eq 2 ]; then
    emit "LIGHTHOUSE ALERT | firstmate is $cap (no model/effort pin); confirmed on two consecutive checks"
  fi

  echo "lock=$lock" >> "$NEW"
  if [ "$lock" != "$(prev lock)" ]; then
    if [ "$lock" = "held" ]; then [ $FIRST -eq 0 ] && emit "LIGHTHOUSE ok | fleet lock re-acquired"
    elif [ "$lock" = "stale" ]; then
      emit "LIGHTHOUSE ALERT | fleet lock is stale (names a dead process); firstmate cannot dispatch"; fi
  fi

  # counters: speak only on increase
  echo "failed=$fail" >> "$NEW"
  pf=$(prev failed); pf=${pf:-$fail}
  [ "${fail:-0}" -gt "${pf:-0}" ] 2>/dev/null && emit "LIGHTHOUSE ALERT | a firstmate task moved to failed (now $fail)"
  echo "dblocked=$dblk" >> "$NEW"
  pd=$(prev dblocked); pd=${pd:-$dblk}
  [ "${dblk:-0}" -gt "${pd:-0}" ] 2>/dev/null &&
    emit "LIGHTHOUSE ALERT | a task is blocked on dispatch/harness/quota (now $dblk)"

  # workers: report starts and finishes, never the steady state
  echo "working=$wk" >> "$NEW"
  pw=$(prev working)
  if [ -n "$pw" ] && [ -n "$wk" ] && [ "$wk" != "$pw" ] && [ $FIRST -eq 0 ]; then
    if [ "$wk" -gt "$pw" ] 2>/dev/null; then emit "LIGHTHOUSE fleet | a worker started (working now: $wk, was $pw)"
    else
      emit "LIGHTHOUSE fleet | a worker stopped working (working now: $wk, was $pw) - finished, parked or asking;" \
        "check firstmate"
    fi
  fi

  # compaction, which Owner wants off: say when firstmate is set to compact by itself, and when its conversation
  # nears the window, since with no automatic compaction it stops when full. Compacting is his call
  cauto=$(grep -m1 "^captain_autocompact=" <<< "$P" | cut -d= -f2)
  casrc=$(grep -m1 "^captain_autocompact_source=" <<< "$P" | cut -d= -f2)
  ac=${cauto:-unknown}
  echo "autocompact=$ac" >> "$NEW"
  if [ "$ac" != "$(prev autocompact)" ]; then
    case "$ac" in
      off) [ $FIRST -eq 0 ] && emit "LIGHTHOUSE ok | firstmate's automatic compaction is off, as Owner asked" ;;
      on) emit "LIGHTHOUSE ALERT | firstmate is set to compact automatically (by $casrc);" \
            "Owner asked for no automatic compaction (2026-11-05)" ;;
      default) emit "LIGHTHOUSE ALERT | nothing turns firstmate's automatic compaction off, so Claude Code" \
                 "compacts it by itself near the end of its window;" \
                 "Owner asked for no automatic compaction (2026-11-05)" ;;
      unknown) : ;;
    esac
  fi
  if [ -z "$cctx" ]; then comp="unknown"
  elif [ "$cctx" -ge "$CONTEXT_NEAR" ] 2>/dev/null; then comp="near"
  else comp="ok"; fi
  echo "compaction=$comp" >> "$NEW"; echo "captain_ctx=$cctx" >> "$NEW"
  if [ "$comp" != "$(prev compaction)" ]; then
    case "$comp" in
      near) emit "LIGHTHOUSE ALERT | firstmate's conversation is ${cctx} tokens, near its limit; with no automatic" \
              "compaction it stops when full, and compacting is Owner's call" ;;
      unknown) emit "LIGHTHOUSE ALERT | firstmate conversation size unreadable; the size check is BLIND, not clear" ;;
      ok) : ;;
    esac
  fi

  # profile: firstmate is expected on the profile Owner chose (EXPECT_PROFILE)
  if [ "$cap" = "pinned" ]; then prof="$cmod/$ceff"; else prof="none"; fi
  if [ "$prof" = "$EXPECT_PROFILE" ]; then pstate="ok"
  elif [ "$prof" = "none" ]; then pstate="unpinned"
  else pstate="wrong($prof)"; fi
  echo "profile=$pstate" >> "$NEW"
  if [ "$pstate" != "$(prev profile)" ]; then
    case "$pstate" in
      ok) [ $FIRST -eq 0 ] && emit "LIGHTHOUSE ok | firstmate profile is $EXPECT_PROFILE as Owner chose" ;;
      unpinned) : ;;
      *) emit "LIGHTHOUSE ALERT | firstmate is pinned to $prof, not $EXPECT_PROFILE as Owner chose on 2026-11-05" ;;
    esac
  fi

  # firstmate holding a question for Owner
  echo "pending=$pdec" >> "$NEW"
  if [ "$pdec" != "$(prev pending)" ]; then
    case "$pdec" in
      yes) emit "LIGHTHOUSE DECISION | firstmate is holding a question for Owner" ;;
      no) [ $FIRST -eq 0 ] && emit "LIGHTHOUSE ok | firstmate's question is answered" ;;
      *) emit "LIGHTHOUSE ALERT | cannot tell whether firstmate is holding a question; that check is BLIND," \
           "not clear" ;;
    esac
  fi
  fi   # end probe=ok

  # ---- 3. shared lighthouse board: comments from others ---------------------
  # one repo-wide call, not one per issue: eight calls a pass made a sweep slower than its own interval
  last=$(prev board_id); last=${last:-0}; maxid=$last
  if [ "__BOARD_REPO__" != "none" ] && [ -n "__BOARD_REPO__" ]; then
  lease_check
  out=$(timeout 30 gh api "repos/__BOARD_REPO__/issues/comments?sort=created&direction=desc&per_page=30" \
        --jq '.[] | "\(.id) \(.issue_url|split("/")|last) \(.body|@base64)"' 2>/dev/null)
  if [ -n "$out" ]; then
    while read -r id issue b64; do
      [ -z "$id" ] && continue
      [ "$id" -gt "$maxid" ] 2>/dev/null && maxid=$id
      if [ "$id" -gt "$last" ] 2>/dev/null && [ "$last" -gt 0 ] 2>/dev/null; then
        body=$(printf '%s' "$b64" | base64 -d 2>/dev/null)
        printf '%s' "$body" | head -1 | grep -q "on __MACHINE_NAME__ machine" || \
          emit "LIGHTHOUSE board #$issue | $(printf '%s' "$body" | head -c 500 | tr '\n' ' ')"
      fi
    done <<< "$out"
    echo "board_id=$maxid" >> "$NEW"
  else
    echo "board_id=$last" >> "$NEW"   # call failed; do not advance the cursor
  fi
  fi

  # ---- 3b. the operator's own compaction: the collector leaves compacted.txt when the operator's transcript shows a
  #      compaction summary; one reminder per compaction, since the brief is the first thing a summary drops ----
  if [ -f "$SCRATCH/compacted.txt" ]; then
    ct="$(tr -d '\r\n' < "$SCRATCH/compacted.txt" | head -c 40)"; echo "compacted=$ct" >> "$NEW"
    if [ -n "$ct" ] && [ "$ct" != "$(prev compacted)" ]; then
      emit "LIGHTHOUSE | your session was compacted at ${ct:11:5} UTC: read OPERATOR-BRIEF.md in this folder again" \
        "before your next line; every line names a task, only SHIFT and OPS say general, and TASK_CREATED names the" \
        "task it opens (bash shift.sh start prints the short form)"
    fi
  fi

  # ---- 4. the wake gate's own health (gate.cjs): silence is alarmed, fail-open is announced, once per change ----
  # A gate that dies quietly would look like a quiet fleet: a gate that fails closed is invisible.
  if [ -f "$SCRATCH/gate-heartbeat.json" ]; then
    G=$(python - "$SCRATCH/gate-heartbeat.json" <<'PYG' 2>/dev/null
import json, sys, datetime
try:
    h = json.load(open(sys.argv[1], encoding="utf-8"))
    t = datetime.datetime.fromisoformat(h["t"].replace("Z", "+00:00"))
    age = int((datetime.datetime.now(datetime.timezone.utc) - t).total_seconds() // 60)
    print(f"{h.get('mode','off')} {age} {'failopen' if h.get('failOpenSince') else 'ok'} "
          f"{(h.get('failOpenSince') or '')[11:16]}")
except Exception: print("unreadable 0 ok")
PYG
)
    set -- $G; gmode="${1:-off}"; gage="${2:-0}"; gfail="${3:-ok}"; gsince="${4:-}"
    gstate="quiet"; [ "$gmode" != off ] && [ "$gage" -ge 20 ] 2>/dev/null && gstate="silent"
    [ "$gfail" = failopen ] && gstate="failopen"
    echo "gate=$gstate" >> "$NEW"
    if [ "$gstate" != "$(prev gate)" ]; then
      case "$gstate" in
        silent)   emit "LIGHTHOUSE ALERT | GATE silent for ${gage} min in mode ${gmode}: if the watchers are" \
                    "printing, the gate may be dead and nothing reaches you; restart the piped watcher or run:" \
                    "bash shift.sh gate off" ;;
        failopen) emit "LIGHTHOUSE ALERT | GATE fail-open since ${gsince} UTC: every line wakes; Jev is not answering" \
                    "(a key, a timeout, a 429, or the network)" ;;
        quiet)    [ $FIRST -eq 0 ] && emit "LIGHTHOUSE ok | GATE alive and judging again (mode ${gmode})" ;;
      esac
    fi
  fi

  # heartbeat: a stalled loop must be distinguishable from a quiet one
  echo "swept_at=$(date +%s)" >> "$NEW"
  echo "swept_hhmm=$(date +%H:%M:%S)" >> "$NEW"

  lease_check
  mv -f "$NEW" "$STATE"
  # sleep in the background and wait on it: bash defers a TERM trap until a foreground child exits,
  # which would keep a stopped sweep alive for up to ten minutes.
  if [ -n "$LH_MONITOR_LEASE" ]; then
    node "$SCRATCH/watch-lease.cjs" wait "$SWEEP_INTERVAL" &
  else
    sleep "$SWEEP_INTERVAL" &
  fi
  wait $!
  [ -n "$LH_MONITOR_LEASE" ] && lease_check
done
