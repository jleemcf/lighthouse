#!/usr/bin/env bash
# Lighthouse probe: key=value facts about firstmate's fleet. Read-only.
# The captain is the claude process whose cwd is the firstmate ROOT; workers sit
# in projects/ or worktree dirs. Picking "the first claude process" reads a worker.
FM=__FM_HOME__
cd "$FM" 2>/dev/null || { echo "fleet=unreachable"; exit 0; }

cap_pid=""
for p in $(pgrep -f claude 2>/dev/null); do
  [ "$(readlink -f /proc/$p/cwd 2>/dev/null)" = "$FM" ] || continue
  case "$(ps -o args= -p "$p" 2>/dev/null)" in
    claude*) cap_pid=$p; break ;;
  esac
done

if [ -z "$cap_pid" ]; then
  echo "captain=absent"
else
  args=$(ps -o args= -p "$cap_pid" 2>/dev/null)
  # the last --model and the last --effort win, as in claude itself: firstmate can run with a flag twice
  amodel=$(printf "%s" "$args" | awk '{v=""; for(i=1;i<=NF;i++){
    if($i=="--model" && i<NF) v=$(i+1); else if(index($i,"--model=")==1) v=substr($i,9) } print v}')
  aeffort=$(printf "%s" "$args" | awk '{v=""; for(i=1;i<=NF;i++){
    if($i=="--effort" && i<NF) v=$(i+1); else if(index($i,"--effort=")==1) v=substr($i,10) } print v}')
  if [ -n "$amodel" ] && [ -n "$aeffort" ]; then
    echo "captain=pinned"; echo "captain_pin_source=argv"
  else
    # The pin can live in settings (model, effortLevel) instead of argv; a resume without flags is then still
    # pinned. Claude Code's own order: firstmate's .claude/settings.local.json, then its .claude/settings.json,
    # then the user's ~/.claude/settings.json. A pin in settings.local.json alone still pins a plain
    # claude --resume. Read them in that order, and say which answered.
    read -r smodel seffort ssrc <<< "$(python3 - <<'PYPIN' 2>/dev/null
import json, os
m = e = ""; src = ""
for f, name in ((".claude/settings.local.json", "settings.local"), (".claude/settings.json", "settings.project"),
                (os.path.expanduser("~/.claude/settings.json"), "settings")):
    try: d = json.load(open(f))
    except Exception: continue
    if not m and d.get("model"): m = d["model"]; src = src or name
    if not e and d.get("effortLevel"): e = d["effortLevel"]; src = src or name
print(m or "-", e or "-", src or "-")
PYPIN
)"
    [ "$smodel" = "-" ] && smodel=""; [ "$seffort" = "-" ] && seffort=""
    if [ -n "$smodel" ] && [ -n "$seffort" ]; then
      echo "captain=pinned"; echo "captain_pin_source=$ssrc"; amodel=${amodel:-$smodel}; aeffort=${aeffort:-$seffort}
    else
      echo "captain=unpinned"; echo "captain_pin_source=none"
    fi
  fi
  echo "captain_pid=$cap_pid"
  echo "captain_model=$amodel"
  echo "captain_effort=$aeffort"
  # Automatic compaction, which Owner wants off: on when firstmate runs with --autocompact or
  # CLAUDE_CODE_AUTO_COMPACT_WINDOW, or a setting turns it on or sets its window; off when a setting says
  # autoCompactEnabled: false; default when nothing says, and then Claude Code compacts by itself near the window's
  # end. Settings in Claude Code's order, the first that names the key answering: a file or JSON given with
  # --settings (firstmate can run with a session settings file that turns it off), then its settings.local.json,
  # settings.json, the user's ~/.claude/settings.json, and ~/.claude.json
  if printf "%s" "$args" | grep -qE '(^| )--autocompact(=| |$)'; then
    echo "captain_autocompact=on"; echo "captain_autocompact_source=argv"
  elif tr '\0' '\n' < "/proc/$cap_pid/environ" 2>/dev/null | grep -q '^CLAUDE_CODE_AUTO_COMPACT_WINDOW=.'; then
    echo "captain_autocompact=on"; echo "captain_autocompact_source=env"
  else
    CAP_PID="$cap_pid" python3 - <<'PYAC' 2>/dev/null || echo "captain_autocompact="
import json, os
pid = os.environ.get("CAP_PID", "")
def flag_settings():   # --settings <file or JSON>, read from the exact arguments; the last one given wins
    try: argv = [a.decode("utf-8", "replace") for a in open("/proc/%s/cmdline" % pid, "rb").read().split(b"\0")]
    except Exception: return None
    val = None
    for i, a in enumerate(argv):
        if a == "--settings" and i + 1 < len(argv): val = argv[i + 1]
        elif a.startswith("--settings="): val = a[len("--settings="):]
    if not val: return None
    if val.lstrip().startswith("{"): return json.loads(val)
    if not os.path.isabs(val): val = os.path.join(os.readlink("/proc/%s/cwd" % pid), val)
    return json.load(open(val))
def files():
    try:
        d = flag_settings()
        if d is not None: yield d, "--settings"
    except Exception: pass
    for f, name in ((".claude/settings.local.json", "settings.local"), (".claude/settings.json", "settings.project"),
                    (os.path.expanduser("~/.claude/settings.json"), "settings"),
                    (os.path.expanduser("~/.claude.json"), "claude.json")):
        try: yield json.load(open(f)), name
        except Exception: continue
for d, name in files():
    if not isinstance(d, dict): continue
    if d.get("autoCompactEnabled") is False:
        print("captain_autocompact=off"); print("captain_autocompact_source=" + name); break
    if d.get("autoCompactEnabled") is True or d.get("autoCompactWindow"):
        print("captain_autocompact=on"); print("captain_autocompact_source=" + name); break
else:
    print("captain_autocompact=default"); print("captain_autocompact_source=none")
PYAC
  fi
fi

lk=$(bash bin/fm-lock.sh status 2>/dev/null | head -1)
case "$lk" in
  *stale*) echo "lock=stale" ;;
  *held*)  echo "lock=held" ;;
  *)       echo "lock=unknown" ;;
esac

# Only a task whose LAST status line is a failure is failing now. Matching anywhere in the file
# would count an old failure that the task has already moved past (last line: paused).
fcount=0
for sf in state/*.status; do
  [ -f "$sf" ] || continue
  case "$(tail -1 "$sf" 2>/dev/null)" in failed*) fcount=$((fcount+1)) ;; esac
done
echo "failed_tasks=$fcount"
# Last status line only, like failed_tasks: a resolved "blocked: ... local candidate ..." line earlier in a task's
# history is not a live dispatch block when its current line is "done".
bcount=0
for sf in state/*.status; do
  [ -f "$sf" ] || continue
  tail -1 "$sf" 2>/dev/null |
    grep -qi '^blocked.*\(harness\|candidate\|dispatch\|spawn\|quota\|runway\)' && bcount=$((bcount+1))
done
echo "dispatch_blocked=$bcount"

# Captain context size, for advice on the stow/clear/bearings ritual.
# Latest assistant usage block in the newest captain transcript; tail only, the file grows all day.
T=$(ls -t /home/__WSL_USER__/.claude/projects/__FM_CONV_DIR__/*.jsonl 2>/dev/null | head -1)
if [ -n "$T" ]; then
  ctx=$(tail -c 3000000 "$T" | python3 -c '
import sys, json
last = None
seen = False
for line in sys.stdin:
    try:
        o = json.loads(line)
    except Exception:
        continue
    if o.get("type") != "assistant":
        continue
    seen = True
    u = (o.get("message") or {}).get("usage")
    if u:
        tot = u.get("input_tokens", 0) + u.get("cache_read_input_tokens", 0) + u.get("cache_creation_input_tokens", 0)
        # A failed turn (request timed out) records usage of 0; that is not a cleared conversation.
        # Keep the last turn that actually carried tokens.
        if tot > 0:
            last = tot
# A just-cleared captain has a new transcript with no assistant turn yet: that is fresh (0), not blind.
# Assistant turns present but none carrying usage would mean the format changed: stay blind ("").
print(last if last is not None else ("" if seen else 0))
' 2>/dev/null)
  echo "captain_ctx=${ctx}"
else
  echo "captain_ctx="
fi
# Busy workers as herdr reports them (the primary firstmate pane is reported separately). Status lines alone can
# miss a busy worker whose latest line carries no "working" verb; herdr's agent_status does not.
H=/home/__WSL_USER__/.local/bin/herdr
hj=$("$H" agent list 2>/dev/null)
w=$(printf '%s' "$hj" | python3 -c '
import json, sys
try:
    d = json.load(sys.stdin)
except Exception:
    print(""); sys.exit()
n = 0
for a in d.get("result", {}).get("agents", []):
    if a.get("cwd") == "__FM_HOME__":
        continue
    if a.get("agent_status") == "working":
        n += 1
print(n)
')
fs=$(printf '%s' "$hj" | python3 -c '
import json, sys
try:
    d = json.load(sys.stdin)
except Exception:
    print(""); sys.exit()
print(next((a.get("agent_status", "") for a in d.get("result", {}).get("agents", [])
            if a.get("cwd") == "__FM_HOME__"), ""))
')
if [ -z "$w" ]; then
  w=0
  for f in state/*.status; do [ -e "$f" ] || continue; tail -1 "$f" | grep -q '^working' && w=$((w+1)); done
fi
echo "working_tasks=$w"
echo "firstmate_status=$fs"

# A worker waiting on Owner's ruling reads as idle everywhere (herdr says done, its status file can be hours stale),
# so a "safe pause" must also require that firstmate is not holding a question for him.
pend=$(python3 __OPERATOR_WSL_DIR__/lh-pending.py 2>/dev/null)
echo "pending_decision=${pend:-unknown}"
