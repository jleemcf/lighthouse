"""Print yes when firstmate is holding a question for Owner, else no.
Tracks ask-then-answer across the whole transcript: read from the last message alone, firstmate's own watcher-drain
lines would overwrite the signal (a false 'answered').
Also tracks firstmate's question dialogs (the AskUserQuestion tool call): a dialog is pending until its tool_result
answers it. Phrases alone miss a question asked as a dialog.
Usage: lh-pending.py [transcript dir]   (default: firstmate's own transcript folder)"""
import json, glob, os, re, sys
# "awaiting your review" is a status line, not a question
ASK = re.compile(r"(?i)(awaiting your (?:word|decision|go|call|approval|answer|ruling|yes|no)\b"
                 r"|waiting on your (?:word|decision|go|call|approval)\b|holding for your"
                 r"|(?:need|needs|want|wants|waiting for|waiting on|for) your ruling|holding until you"
                 r"|rule\b[^.]{0,40}and i.?ll authorize)")
NOISE = ("Stop hook", "system-reminder", "task-notification", "local-command")
try:
    d = sys.argv[1] if len(sys.argv) > 1 else "/home/__WSL_USER__/.claude/projects/__FM_CONV_DIR__"
    f = sorted(glob.glob(d + "/*.jsonl"), key=os.path.getmtime)[-1]
except Exception:
    print("unknown"); raise SystemExit
pending = False
open_dialogs = set()   # AskUserQuestion tool_use ids not yet answered by a tool_result
for line in open(f, encoding="utf-8", errors="replace"):
    try:
        o = json.loads(line)
    except Exception:
        continue
    m = o.get("message") or {}
    c = m.get("content")
    if o.get("type") == "assistant":
        for x in c or []:
            if isinstance(x, dict) and x.get("type") == "text" and ASK.search(x.get("text", "")):
                pending = True
            if isinstance(x, dict) and x.get("type") == "tool_use" and x.get("name") == "AskUserQuestion":
                open_dialogs.add(x.get("id"))
    elif o.get("type") == "user":
        for x in (c if isinstance(c, list) else []):
            if isinstance(x, dict) and x.get("type") == "tool_result":
                open_dialogs.discard(x.get("tool_use_id"))
        s = c if isinstance(c, str) else " ".join(x.get("text", "") for x in (c or [])
                                                  if isinstance(x, dict) and x.get("type") == "text")
        if s.strip() and not any(n in s for n in NOISE):
            pending = False
print("yes" if (pending or open_dialogs) else "no")
