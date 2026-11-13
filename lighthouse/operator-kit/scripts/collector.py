#!/usr/bin/env python3
"""Collector: turn an operator's own Claude Code transcript into board events, deterministically.

    collector.py --transcript-dir <dir with *.jsonl> --board <board> --server <url> [--token T | LH_TOKEN]
                 [--cursor cursor.json] [--outbox outbox.jsonl] [--once]

Every few seconds (or once), read only what is new since the saved cursor, take assistant text entries only (never
tool results or user entries), and find checkpoint lines of the shape the operators already write to Owner:

    ⏱ 10:53 PM ET · FYI · lighthouse-testfile: firstmate has been idle since 10:01 PM
    ⏱ 10:55 PM ET · ACTION · signal-cleanup: merge or close PR 123
    ⏱ 11:02 PM ET · STATUS · sample-importer: the importer is finished and waiting for Owner's review of the branch

Label is one of ACTION, FYI, REPLY, RELAYED, STATUS, CONTEXT, TASK_CREATED, TASK_FINISHED, SHIFT, OPS, PROMPT; the
task is the card id (with or without the board prefix) or "general"; the text runs to the end of the line.
TASK_CREATED may carry key=value pairs before the colon: severity=low|medium|high complexity=small|medium|large
nature=bug|feature|ops|design|docs.
The event time is the transcript entry's own timestamp, never the text. Lines inside code fences or starting with
">" are ignored, so quoting a line never counts. Rows are appended to the outbox file, posted to the server, and
the cursor (file offsets plus seen entry uuids) is saved, so nothing is sent twice even across restarts or forked
transcripts. A malformed checkpoint line (starts with the clock but does not parse) is reported, never dropped.
Text beneath a checkpoint line, until the next one, is that line's body (structured detail: headings, bullets, quotes,
fenced commands) and travels with it. Text before any line is posted as a general FYI marked untagged: nothing the
operator says to Owner may miss the board. Bounded: only new bytes are read; the seen list keeps the last 20,000
uuids; the outbox rotates at 5 MB.
The transcript: besides the lines, every message the operator writes and every message Owner types into its chat
(not watcher notifications, not tool results) is posted whole to the board's transcript, so Owner can read the
conversation naked from the board. PROMPT lines carry to=firstmate; the prompt itself is the body.
Which of Owner's messages the operator is answering is read from the entry that woke it (the board watch's
"Owner (general): ..." or "Owner (board, card X): ..." lines): every line of the answer carries `re` naming those
conversations, so the server delivers it back where he wrote, whatever task the line names.
"""
import argparse, glob, json, os, re, sys, time, urllib.parse, urllib.request
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import collector_usage
import helper_generation
try:
    with open(os.path.join(os.path.dirname(__file__), "config.json"), encoding="utf-8") as source:
        owner_settings = json.load(source)
except (OSError, ValueError):
    owner_settings = {}
owner_label = owner_settings.get("ownerName") or "the captain"
zone_label = owner_settings.get("timeZoneLabel", "UTC")

# NOTICE: the watch operator's correction to another operator
LABELS = {"ACTION", "FYI", "REPLY", "RELAYED", "STATUS", "CONTEXT", "TASK_CREATED", "TASK_FINISHED", "SHIFT", "OPS",
          "PROMPT", "NOTICE"}
# asides that land mid-answer: they do not start a new turn
KEEPS_ANSWERING = ("[Image: original ", "Base directory for this skill", "(Re-invocation of /",
                   "<cross-session-message", "[Cross-session", "[Your previous response",
                   "This session is being continued from a previous conversation",
                   "<artifact-content-authored-by-others")
# user entries that are the harness talking, not Owner: a watcher, a skill's text, another session's message, a
# compaction summary; Claude Code's own marks: an interrupt, a skill's text re-sent, a ! command and its output; and its
# note on an image the operator read, "[Image: original WxH, displayed at ...]"
NOT_OWNER = ("[Image: original ", "<task-notification", "<system-reminder", "<command-name", "<local-command",
             "<cross-session-message", "[Cross-session", "Base directory for this skill", "[Your previous response",
             "This session is being continued from a previous conversation", "<artifact-content-authored-by-others",
             "[Request interrupted by user", "(Re-invocation of /", "<bash-input>", "<bash-stdout>", "<bash-stderr>",
             "<user-memory-input>")

def harness_text(text):
    return any(k in text for k in NOT_OWNER) or text.lstrip().startswith("NOTICE from ")
# a key's value runs to the next space or the colon, so a title with an apostrophe or a bracket still parses and the
# board cleans it and says so
LINE = re.compile(r"^\s*⏱\s*(?P<clock>\d{1,2}:\d{2}\s*(?:AM|PM)\s*" + re.escape(zone_label) +
                  r")\s*·\s*(?P<label>\*{0,2}[A-Z_]+\*{0,2})"
                  r"(?:\s*·\s*(?P<task>[A-Za-z0-9._@+~-]+)(?P<kv>(?:\s+[a-z]+=\S+?)*)\s*:)?\s*(?P<text>.*)$")
KEY_SPACE = re.compile(r"^(?:·\s*)?[A-Za-z0-9._@+~-]+(?:\s+[a-z]+=\S+)+\s+[^:]*:")

def parse_line(line):
    m = LINE.match(line)
    if not m: return None
    label = m.group("label").strip("*").upper().replace("-", "_")   # the operator bolds its labels in the chat
    if label not in LABELS:
        return {"error": f"unknown label {m.group('label').strip(chr(42))}", "line": line.strip()}
    # a task and keys, but a key's value held a space: never filed on General as if it named no task
    if not m.group("task") and KEY_SPACE.match(m.group("text")):
        return {"error": "a key's value holds a space (write rec=B, or join the words with _)", "line": line.strip()}
    row = {"label": label, "task": m.group("task") or "general", "text": m.group("text").strip()}
    for kv in (m.group("kv") or "").split():
        k, v = kv.split("=", 1); row[k] = v
    return row

def text_of(content):
    if isinstance(content, str): return content
    if not isinstance(content, list): return ""
    if any(isinstance(x, dict) and x.get("type") == "tool_result" for x in content): return ""
    return "\n".join(x.get("text", "") for x in content if isinstance(x, dict) and x.get("type") == "text")

def lines_of(text):
    """Yield (line, parseable): a line inside a fence or starting with '>' is never a checkpoint, so quoting one
    never counts."""
    fenced = False
    for raw in text.split("\n"):
        if raw.strip().startswith("```"): fenced = not fenced; yield (raw, False); continue
        yield (raw, not fenced and not raw.lstrip().startswith(">"))

# the route line may carry the message id first
WOKE = re.compile(r"^[ \t]*" + re.escape(owner_label) +
                  r" \((?:[a-z][a-z2-9]{5,6}, )?(general|board, card ([A-Za-z0-9._-]+))\):", re.MULTILINE)
HARNESS_TAG = r"</?(?:event|task-notification)(?:\s[^>]*)?>"
NOTICE_TARGET = re.compile(r"(?:^|" + HARNESS_TAG + r")[ \t]*NOTICE from [^\n]*"
                           r" \(coordinator, not the owner\) \|[^\n]*"
                           r"\[(?:message [a-z][a-z2-9]{5,6}, )?(?:card ([A-Za-z0-9._-]+)|General);"
                           r" act only within the owner's existing approvals;"
                           r" ask the owner on the board for anything else;"
                           r" answer on this inbox card with board_reply or a REPLY line\]", re.MULTILINE)
def woke_targets(text):
    """The conversations Owner wrote in, as printed by the board watch in the entry that woke the operator."""
    out = []
    # Notice prose can quote brackets or harness tags; only the watch's trailing bracket gives its target.
    owner_text = re.sub(r"(^|" + HARNESS_TAG + r")[ \t]*NOTICE from [^\n]*", r"\1", text or "",
                        flags=re.MULTILINE)
    # Harness wrappers can place an owner header beside an XML tag, outside a notice's untrusted text.
    headers = re.sub(HARNESS_TAG, "\n", owner_text)
    for m in WOKE.finditer(headers):
        t = m.group(2) or "general"
        if t not in out: out.append(t)
    for m in NOTICE_TARGET.finditer(text or ""):
        target = m.group(1) or "general"
        if target not in out: out.append(target)
    return out

def scan(tdir, cursor, transcript=None):
    """Yield (entry_ts, uuid, line) for new assistant text since the cursor; update cursor in place. When a list is
    given as transcript, every whole message of the operator and every message Owner typed is appended to it."""
    order = list(cursor.setdefault("seen", [])); seen = set(order)
    # the seen list keeps its order, so trimming drops the oldest uuids (a set would drop a random handful, recent
    # ones included)
    def mark(u):
        if u and u not in seen: seen.add(u); order.append(u)
    # the high-water mark: the newest entry already read. An entry stamped more than half an hour before it is history
    # from a file rewritten or copied (a redaction, a resume), never new words: posting it again would repeat old
    # messages, and a replay after a compaction would re-open asks Owner had answered
    hwm = cursor.get("hwm") or ""
    cutoff = ""
    if hwm:
        try:
            import datetime as _dt
            cutoff = (_dt.datetime.fromisoformat(hwm.replace("Z", "+00:00"))
                      - _dt.timedelta(minutes=30)).strftime("%Y-%m-%dT%H:%M:%S")
        except Exception: cutoff = ""
    for f in sorted(glob.glob(os.path.join(tdir, "*.jsonl")), key=os.path.getmtime):
        off = cursor.setdefault("offsets", {}).get(f, 0)
        size = os.path.getsize(f)
        # rewritten in place, shorter (a redaction): its history was read already; read on from the new end
        if size < off:
            print(f"COLLECTOR | {os.path.basename(f)} shrank ({off} -> {size} bytes); "
                  f"its history is not read again"); sys.stdout.flush()
            cursor["offsets"][f] = size; continue
        if size == off: continue
        with open(f, "rb") as fh:
            fh.seek(off); buf = fh.read(size - off)
        cut = buf.rfind(b"\n") + 1
        cursor["offsets"][f] = off + cut
        for raw in buf[:cut].decode("utf-8", errors="replace").split("\n"):
            if not raw.strip(): continue
            try: o = json.loads(raw)
            except Exception: continue
            if cursor.get('recoveryFloor') and (o.get('timestamp') or '') <= cursor['recoveryFloor']:
                continue
            if not os.path.basename(f).startswith("agent-"):
                collector_usage.observe(o, cursor, cursor.get("usage_window", 0))
            if o.get("type") == "user":
                # A real user entry (Owner, or a watcher notification) starts a turn; a tool result does not. The
                # board watch's lines in it say which of Owner's messages the operator is now answering, so every
                # line of the answer, whatever task it names, is delivered back there.
                c = (o.get("message") or {}).get("content")
                if isinstance(c, list) and any(isinstance(x, dict) and x.get("type") == "tool_result" for x in c):
                    continue
                s = c if isinstance(c, str) else " ".join(x.get("text", "") for x in (c or [])
                                                          if isinstance(x, dict) and x.get("type") == "text")
                # a compaction: the brief may be gone from the operator's memory
                if (s.lstrip().startswith("This session is being continued from a previous conversation")
                        and o.get("uuid") not in seen):
                    try:
                        cts = o.get("timestamp") or time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
                        try: prev = open("compacted.txt", encoding="utf-8").read().strip()
                        except Exception: prev = ""
                        # only a newer compaction, never history read again
                        if cts > prev and not (cutoff and cts[:19] < cutoff):
                            with open("compacted.txt", "w", encoding="utf-8") as cf: cf.write(cts + "\n")
                    except Exception: pass
                origin = (o.get("origin") or {}).get("kind") if isinstance(o.get("origin"), dict) else None
                # Claude Code marks who sent a user entry: only "human" is Owner (a scheduled start, a watcher, a peer
                # are not)
                targets, harness = woke_targets(s), (harness_text(s) or bool(o.get("isCompactSummary"))
                                                     or (origin is not None and origin != "human"))
                aside = any(k in s for k in KEEPS_ANSWERING)
                # a turn he started by typing here: what the operator says in it answers him
                if targets or not aside: cursor["chat_turn"] = o.get("uuid") if (s.strip() and not harness) else None
                # a new turn (Owner, or a watcher's wake) resets whom the operator answers; only a skill load or a
                # peer's message landing mid-answer keeps it, or every later turn would be copied to Owner's card
                if targets or not aside: cursor["answering"] = targets
                # Owner typed this into the operator's chat
                if transcript is not None and s.strip() and not harness and o.get("uuid") not in seen:
                    mark(o.get("uuid"))
                    transcript.append({"role": "owner", "t": o.get("timestamp") or "", "uuid": o.get("uuid"),
                                       "text": s.strip()[:6000], "origin": origin})
                continue
            if o.get("type") == "attachment" and (o.get("attachment") or {}).get("type") == "queued_command":
                # A message that arrived while the operator was mid-task (a watcher line, or Owner typing) is folded
                # into the running turn as a queued command, not a new user entry. The operator now answers it too,
                # so its targets join the ones already being answered: an answer to Owner's General message goes
                # back to General too, not only to the cards the operator was working on.
                pr = (o.get("attachment") or {}).get("prompt")
                s = pr if isinstance(pr, str) else " ".join(x.get("text", "") for x in (pr or [])
                                                            if isinstance(x, dict) and x.get("type") == "text")
                more = woke_targets(s)
                if more:
                    cursor["answering"] = (list(cursor.get("answering") or [])
                                           + [x for x in more if x not in (cursor.get("answering") or [])])
                qorigin = (((o.get("attachment") or {}).get("origin") or {}).get("kind")
                           if isinstance((o.get("attachment") or {}).get("origin"), dict) else None)
                # he typed mid-task: the operator now answers him too
                if s.strip() and not harness_text(s) and (qorigin is None or qorigin == "human"):
                    cursor["chat_turn"] = o.get("uuid")
                # Owner typed this mid-task
                if (transcript is not None and s.strip() and not harness_text(s)
                        and (qorigin is None or qorigin == "human") and o.get("uuid") not in seen):
                    mark(o.get("uuid"))
                    transcript.append({"role": "owner", "t": o.get("timestamp") or "", "uuid": o.get("uuid"),
                                       "text": s.strip()[:6000], "origin": qorigin})
                continue
            # what the operator said through the board's tools, so the net does not post it twice
            if o.get("type") == "assistant" and isinstance((o.get("message") or {}).get("content"), list):
                for x in o["message"]["content"]:
                    if isinstance(x, dict) and x.get("type") == "tool_use" and "board_" in str(x.get("name", "")):
                        inp = x.get("input") or {}
                        for k in ("text", "question", "outcome", "purpose", "prompt", "context", "note", "reason"):
                            if isinstance(inp.get(k), str) and inp[k].strip():
                                cursor.setdefault("tooltext", []).append(inp[k].strip()[:2000])
                cursor["tooltext"] = cursor.get("tooltext", [])[-60:]
            if o.get("type") != "assistant" or o.get("uuid") in seen: continue
            ets = o.get("timestamp") or ""
            if cutoff and ets and ets[:19] < cutoff: mark(o.get("uuid")); continue   # history, not new words
            # Claude Code's own message (an API error, a session limit), not the operator's words
            if o.get("isApiErrorMessage") or (o.get("message") or {}).get("model") == "<synthetic>":
                mark(o.get("uuid"))
                continue
            u = o.get("uuid")
            mark(u)
            if ets > (cursor.get("hwm") or ""): cursor["hwm"] = ets
            t = text_of((o.get("message") or {}).get("content"))
            # A timed line starts a message; everything beneath it until the next timed line is its body (headings,
            # bullets, a quote block to paste, a fenced command), kept with the line, so replies stay structured, not
            # blocks of paragraph. Text before any line is prose: it still reaches the board, as a general FYI marked
            # untagged, because nothing the operator says to Owner may be lost.
            items = []
            for raw, parseable in lines_of(t):
                if parseable and "⏱" in raw:
                    items.append(["line", raw, []])
                elif raw.strip():
                    if items and items[-1][0] == "line": items[-1][2].append(raw.rstrip())
                    elif items and items[-1][0] == "prose": items[-1][2].append(raw.strip())
                    else: items.append(["prose", "", [raw.strip()]])
                elif items and items[-1][0] == "line" and items[-1][2]:
                    items[-1][2].append("")
            answering = list(cursor.get("answering") or [])
            # the whole message, for the transcript
            if transcript is not None and t.strip():
                transcript.append({"role": "operator", "t": o.get("timestamp") or "", "uuid": u,
                                   "text": t.strip()[:6000]})
            for kind, text, body in items:
                if kind == "line":
                    yield (o.get("timestamp") or "", u, text, "line", "\n".join(body).strip(), answering)
                # prose has no body: that place carries the chat entry it answers, when he typed one
                else: yield (o.get("timestamp") or "", u, "\n".join(body).strip(), "prose",
                             cursor.get("chat_turn") or "", answering)
    cursor["seen"] = order[-20000:]

QUIET = re.compile(r"^\s*\(quiet\)[\s.]*$", re.I)   # a whole message of "(quiet)" is for the harness, not the board
# the operator's picture for Owner, the mirror of what it receives from him; [file: ...] too: a CSV, a text file, a PDF
IMAGE = re.compile(r"\[(?:image|file):\s*([^\]\n]+?)\s*\]")
# svg: the statechart skill's charts; the board cleans it and shows it only as an image
IMAGE_TYPES = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif",
               ".webp": "image/webp", ".svg": "image/svg+xml", ".csv": "text/csv", ".txt": "text/plain",
               ".pdf": "application/pdf"}
def upload(server, token, path):
    """Send one image file to the board; returns its attachment id."""
    ext = os.path.splitext(path)[1].lower(); ctype = IMAGE_TYPES.get(ext)
    if not ctype: raise ValueError("not a file the board takes (png, jpg, gif, webp, svg, csv, txt, pdf)")
    with open(path, "rb") as f: data = f.read()
    if len(data) > 10 * 1024 * 1024: raise ValueError("over 10 MB")
    req = urllib.request.Request(server.rstrip("/") + "/api/attachments", data=data,
                                 headers={"Content-Type": ctype, "X-Name": urllib.parse.quote(os.path.basename(path)),
                                          "Authorization": "Bearer " + token,
                                          **helper_generation.headers()}, method="POST")
    with urllib.request.urlopen(req, timeout=60) as r: return json.loads(r.read().decode())["id"]
def attach_images(row, server, token):
    """Every [image: <path>] in the line and its body: the file goes up, its id rides with the row, the marker leaves
    the text; a file that cannot be sent stays named in the text with the reason, so Owner sees what he was meant to
    see."""
    ids = []
    def swap(m):
        path = m.group(1).strip().strip('"').strip("'")
        if not server: return m.group(0)
        try: ids.append(upload(server, token, path)); return ""
        except Exception as e: return f"[image {os.path.basename(path)} could not be sent: {e}]"
    for k in ("text", "body"):
        if row.get(k) and IMAGE.search(row[k]): row[k] = re.sub(r"[ \t]{2,}", " ", IMAGE.sub(swap, row[k])).strip()
    if ids: row["attachments"] = ids
    return row

def post(server, token, board, rows):
    req = urllib.request.Request(server.rstrip("/") + f"/api/boards/{board}/events",
                                 data=json.dumps({"rows": rows}).encode(),
                                 headers={"Content-Type": "application/json", "Authorization": "Bearer " + token,
                                          **helper_generation.headers()},
                                 method="POST")
    with urllib.request.urlopen(req, timeout=20) as r: return json.loads(r.read().decode())

def post_transcript(server, token, board, rows):
    req = urllib.request.Request(server.rstrip("/") + f"/api/boards/{board}/transcript",
                                 data=json.dumps({"rows": rows}).encode(),
                                 headers={"Content-Type": "application/json", "Authorization": "Bearer " + token,
                                          **helper_generation.headers()},
                                 method="POST")
    with urllib.request.urlopen(req, timeout=20) as r: return json.loads(r.read().decode())

def carried(text, cursor):
    """True when the words were already said through a board tool: the text lies wholly inside something a tool carried,
    or a tool carried four or more words that make up most of it. Whole words only: "Done." is not inside "abandoned",
    and a tool's "ok" never hides a paragraph."""
    w = re.findall(r"\w+", (text or "").lower())
    if not w: return True
    t = " " + " ".join(w) + " "
    for x in cursor.get("tooltext", []):
        xw = re.findall(r"\w+", (x or "").lower())
        if not xw: continue
        y = " " + " ".join(xw) + " "
        if t in y: return True
        if len(xw) >= 4 and y in t and len(xw) >= 0.8 * len(w): return True
    return False

def post_chat(server, token, board, rows):
    req = urllib.request.Request(server.rstrip("/") + f"/api/boards/{board}/chat",
                                 data=json.dumps({"rows": rows}).encode(),
                                 headers={"Content-Type": "application/json", "Authorization": "Bearer " + token,
                                          **helper_generation.headers()},
                                 method="POST")
    with urllib.request.urlopen(req, timeout=20) as r: return json.loads(r.read().decode())

def run_once(a, cursor):
    rows, errors, transcript = [], [], []
    qf, qt = getattr(a, "quiet_from", None), getattr(a, "quiet_to", None)
    tools = getattr(a, "protocol", "lines") == "tools"
    def take(ts, uid, line, kind, body, answering):
        # "(quiet)": the harness wants a visible reply (a re-arm), the board wants nothing
        if kind == "prose" and QUIET.match(line or ""): return
        # written between shift.sh stop and the next start ("The shift is stopped..."): never meant for the board
        if kind == "prose" and qf and qf < (ts or "") <= qt:
            a.quiet_skipped = getattr(a, "quiet_skipped", 0) + 1; return
        if kind == "prose":
            r = {"label": "FYI", "task": "general", "text": line[:4000], "untagged": True}
            # said in a turn he started by typing in this chat: an answer to him there, not drift
            if body: r["chatReply"] = body
        else:
            r = parse_line(line)
            if r and "error" not in r and body: r["body"] = body[:8000]
            if r and "error" not in r and answering: r["re"] = answering
        if r is None: return
        # a timed line that does not parse (a forgotten label): reported, and posted as an untagged note marked
        # malformed, so Owner still sees it and the conduct report counts it; the reason travels, so the board can
        # tell the operator
        if "error" in r:
            errors.append(r); rows.append({"label": "FYI", "task": "general", "text": r.get("line", "")[:4000],
                                           "untagged": True, "malformed": True, "reason": r["error"][:200], "t": ts,
                                           "uuid": uid}); return
        r["t"] = ts; r["uuid"] = uid; rows.append(attach_images(r, a.server, a.token))
    # Tool mode: only what no tool call carried is posted, as a note (TOOLCALL-DESIGN §9). Each message is held one
    # round, so a tool call written just after its own prose has been read before the prose is judged.
    fresh = []
    for item in scan(a.transcript_dir, cursor, transcript):
        if tools: fresh.append(list(item))
        else: take(*item)
    if tools:
        held, cursor["held"] = cursor.get("held", []), fresh
        for ts, uid, line, kind, body, answering in held:
            if carried(line if kind == "prose" else (line + " " + (body or "")), cursor): continue
            take(ts, uid, line, kind, body, answering)
    if a.outbox:
        # rotate: the outbox never grows without bound
        if os.path.exists(a.outbox) and os.path.getsize(a.outbox) > 5 * 1024 * 1024:
            os.replace(a.outbox, a.outbox + "." + time.strftime("%Y%m%d-%H%M%S"))
        with open(a.outbox, "a", encoding="utf-8") as f:
            for r in rows: f.write(json.dumps(r, ensure_ascii=False) + "\n")
    result = None
    if rows and a.server:
        result = post(a.server, a.token, a.board, rows)
    # Owner's words typed in this chat become board messages with ids, so the operator can answer them by id
    if a.server and tools:
        # origin: Claude Code's own mark on the entry, passed through as it is; only "human" lets the words authorise
        # a relay
        said = cursor.get("chat_pending", []) + [{"uuid": x.get("uuid"), "t": x.get("t"), "text": x.get("text"),
                                                  "origin": x.get("origin")}
                                                 for x in transcript if x.get("role") == "owner" and x.get("uuid")]
        if said:
            try: post_chat(a.server, a.token, a.board, said); cursor["chat_pending"] = []
            # kept and sent again next round (the board takes each entry once): never lost
            except Exception as e:
                cursor["chat_pending"] = said[-200:]
                print(f"COLLECTOR | chat words not posted yet ({e}); kept for the next round"); sys.stdout.flush()
    if transcript and a.server:
        try: post_transcript(a.server, a.token, a.board, transcript)
        except Exception as e:
            print(f"COLLECTOR | transcript not posted ({e}); the lines still went"); sys.stdout.flush()
    return rows, errors, result

def post_instruments(server, token, board, last, cursor=None):
    """Once a minute: the gate's heartbeat, the operator's own compaction and this collector's pid, so the conduct
    report can say whether the instruments are alive. A pulse, never an event; failures are ignored."""
    if time.time() - last < 60: return last
    body = {"outbox": {"pid": os.getpid(), "since": START_ISO}}
    if cursor is not None: body["usage"] = collector_usage.pulse(cursor)
    try: body["gate"] = json.load(open("gate-heartbeat.json", encoding="utf-8"))
    except Exception: pass
    try: body["compactedAt"] = open("compacted.txt", encoding="utf-8").read().strip()[:40]
    except Exception: pass
    try:
        req = urllib.request.Request(server.rstrip("/") + "/api/boards/" + board + "/instruments",
                                     data=json.dumps(body).encode("utf-8"),
                                     headers={"Content-Type": "application/json", "Authorization": "Bearer " + token,
                                              **helper_generation.headers()},
                                     method="POST")
        urllib.request.urlopen(req, timeout=10).read()
    except Exception: pass
    return time.time()
START_ISO = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

# the byte offset of a transcript's first entry written at or after `since` (UTC, to the second)
def first_entry_since(f, since):
    if time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(os.path.getmtime(f))) < since: return os.path.getsize(f)
    pos = 0
    with open(f, "rb") as fh:
        for raw in fh:
            try: ts = str(json.loads(raw).get("timestamp") or "")
            except Exception: ts = ""
            if ts and ts[:19] >= since: return pos
            pos += len(raw)
    return pos

def load_cursor(path, tdir):
    """The saved cursor; an unreadable one is kept aside and rebuilt, never fatal: a power loss can leave it as null
    bytes, and a collector that died at every start would leave the board silent.
    The rebuild reads again from ten minutes before the cursor was last written: the board drops the lines it already
    has."""
    if not os.path.exists(path): return {}
    try:
        with open(path, encoding="utf-8") as fh: return json.load(fh)
    except ValueError as e:   # a JSONDecodeError, or text that is not UTF-8
        if helper_generation.active():
            raise SystemExit('COLLECTOR | cursor unavailable; reconcile before starting a new generation')
        since = time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(os.path.getmtime(path) - 600))
        aside = path + ".corrupt-" + time.strftime("%Y%m%d-%H%M%S")
        os.replace(path, aside)
        cursor = {"offsets": {f: first_entry_since(f, since) for f in glob.glob(os.path.join(tdir, "*.jsonl"))}}
        print(f"COLLECTOR | the cursor could not be read ({str(e)[:80]}); kept as {os.path.basename(aside)}. "
              f"Reading again from {since}Z, ten minutes before it was last saved; "
              f"the board drops lines it already has")
        sys.stdout.flush()
        return cursor

# only when it changed, and on disk before it replaces the old one, so a power loss leaves one whole copy
def save_cursor(path, cursor, last):
    current = helper_generation.scope()
    if current: cursor['scope'] = current
    s = json.dumps(cursor)
    if s == last: return last
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh: fh.write(s); fh.flush(); os.fsync(fh.fileno())
    helper_generation.check()
    os.replace(tmp, path)
    return s

def main():
    # the log this runs into is a Windows code-page file when launched hidden: a printed line carrying the clock
    # character (U+23F1) would raise UnicodeEncodeError and the collector would die within seconds of every start
    for s in (sys.stdout, sys.stderr):
        try: s.reconfigure(encoding="utf-8", errors="replace")
        except Exception: pass
    ap = argparse.ArgumentParser()
    ap.add_argument("--transcript-dir", required=True); ap.add_argument("--board", required=True)
    ap.add_argument("--server"); ap.add_argument("--token", default=os.environ.get("LH_TOKEN", ""))
    ap.add_argument("--cursor", default="collector-cursor.json"); ap.add_argument("--outbox", default="outbox.jsonl")
    ap.add_argument("--interval", type=int, default=5); ap.add_argument("--once", action="store_true")
    ap.add_argument("--compaction-window", type=int, default=0)
    # tools: the operator acts through board tools; this is the net (TOOLCALL-DESIGN §9)
    ap.add_argument("--protocol", default="lines", choices=["lines", "tools"])
    a = ap.parse_args()
    helper_generation.check()
    if helper_generation.active() and a.protocol != 'tools':
        raise SystemExit('COLLECTOR | generation recovery is tools-only')
    cursor = load_cursor(a.cursor, a.transcript_dir); saved = None
    if not cursor:
        # first run: start at the end of every existing file; never replay history
        for f in glob.glob(os.path.join(a.transcript_dir, "*.jsonl")):
            cursor.setdefault("offsets", {})[f] = os.path.getsize(f)
    cursor["usage_window"] = a.compaction_window
    collector_usage.initialize(a.transcript_dir, cursor, a.compaction_window)
    collector_usage.pickup(cursor)
    pickup_marker = os.path.join(os.path.dirname(os.path.abspath(a.cursor)), "usage-pickup.json")
    collector_usage.publish_pickup(cursor, pickup_marker)
    # a deliberate stop leaves shift-stopped.txt beside the cursor (shift.sh stop): untagged prose from then until this
    # start is skipped, once
    marker = os.path.join(os.path.dirname(os.path.abspath(a.cursor)), "shift-stopped.txt")
    a.quiet_from = a.quiet_to = None
    try:
        if os.path.exists(marker):
            a.quiet_from = open(marker, encoding="utf-8").read().strip() or None
            a.quiet_to = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    except Exception: a.quiet_from = a.quiet_to = None
    pulsed = 0
    while True:
        helper_generation.check()
        if a.server and a.token: pulsed = post_instruments(a.server, a.token, a.board, pulsed, cursor)
        try:
            rows, errors, result = run_once(a, cursor)
        except Exception as e:
            # the server away for a moment (a restart, a network blip): keep the cursor where it was and try again
            # next tick, never die
            print(f"COLLECTOR | not posted ({e}); trying again in {a.interval} s"); sys.stdout.flush()
            cursor = load_cursor(a.cursor, a.transcript_dir); saved = None
            if a.once: break
            time.sleep(a.interval); continue
        saved = save_cursor(a.cursor, cursor, saved)
        helper_generation.check()
        collector_usage.publish_pickup(cursor, pickup_marker)
        if getattr(a, "quiet_skipped", 0):
            print(f"COLLECTOR | skipped {a.quiet_skipped} message(s) with no timed line written "
                  f"while the shift was off")
            a.quiet_skipped = 0
        try:
            if a.quiet_from and os.path.exists(marker): os.remove(marker)   # once: the next stop writes a new one
        except Exception: pass
        for r in rows: print(f"COLLECTOR | {r['label']} {r['task']} | {r['text'][:120]}")
        for e in errors: print(f"COLLECTOR ERROR | {e['error']} | {e['line'][:120]}")
        if result:
            bad = [x for x in result.get("results", []) if not x.get("ok")]
            if bad:
                print(f"COLLECTOR | server refused {len(bad)} row(s): " + "; ".join(x.get("reason", "") for x in bad))
        sys.stdout.flush()
        if a.once: break
        time.sleep(a.interval)

if __name__ == "__main__":
    main()
