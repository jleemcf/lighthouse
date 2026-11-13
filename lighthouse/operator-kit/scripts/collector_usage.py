import datetime
import glob
import json
import math
import os
import re
import time

SOURCES = ("fm_input", "fm_task", "fm_reply", "fm_waiting", "fm_wake", "record_check",
           "sweep", "board", "steward", "instrument", "human", "other")
FIELDS = {"cacheRead": "cache_read_input_tokens", "cacheWrite": "cache_creation_input_tokens",
          "output": "output_tokens"}
try:
    with open(os.path.join(os.path.dirname(__file__), "config.json"), encoding="utf-8") as source:
        owner_name = json.load(source).get("ownerName") or "the captain"
except (OSError, ValueError):
    owner_name = "the captain"


def number(value):
    return int(value) if isinstance(value, (int, float)) and math.isfinite(value) and value >= 0 else 0


def wake_source(text, origin):
    matches = re.findall(r"(?:^|\n)(FM (?:INPUT|TASK|REPLY|WAITING|WAKE)|RECORD CHECK|LIGHTHOUSE|"
                         r"STEWARD WATCH|BOARD WATCH|" + re.escape(owner_name) +
                         r" \(|Staff \(|GATE \||COLLECTOR \|)", text)
    if matches:
        last = next((item for item in reversed(matches) if item != "GATE |"), matches[-1])
        if last.startswith("FM "): return last.lower().replace(" ", "_")
        if last == "RECORD CHECK": return "record_check"
        if last == "LIGHTHOUSE": return "sweep"
        if last == "STEWARD WATCH": return "steward"
        if last in ("GATE |", "COLLECTOR |"): return "instrument"
        return "board"
    if origin not in (None, "human") or re.search(r"<task-notification|<system-reminder|<command-name", text):
        return "other"
    return "human"


def configured_window(record, override=0):
    if override: return number(override)
    direct = record.get("compactionWindow") or record.get("autoCompactWindow")
    if number(direct): return number(direct)
    values = [os.environ.get("CLAUDE_CODE_AUTO_COMPACT_WINDOW")]
    cwd = record.get("cwd")
    files = ([os.path.join(cwd, ".claude", name) for name in ("settings.local.json", "settings.json")]
             if isinstance(cwd, str) else [])
    files.append(os.path.join(os.environ.get("CLAUDE_CONFIG_DIR") or os.path.expanduser("~/.claude"),
                              "settings.json"))
    for file in files:
        try:
            with open(file, encoding="utf-8") as source: settings = json.load(source)
            values.extend([settings.get("autoCompactWindow"),
                           (settings.get("env") or {}).get("CLAUDE_CODE_AUTO_COMPACT_WINDOW")])
        except (OSError, ValueError, AttributeError): pass
    for value in values:
        try:
            parsed = float(value)
            if math.isfinite(parsed) and parsed > 0: return int(parsed)
        except (ValueError, TypeError): pass
    return 0


def observe(record, cursor, override=0, notify=True):
    if record.get("isSidechain"): return
    timestamp = record.get("timestamp")
    try: stamp = datetime.datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
    except (ValueError, TypeError, AttributeError): return
    if stamp.tzinfo is None: return
    day = stamp.astimezone(datetime.timezone.utc).date().isoformat()
    usage = cursor.setdefault("usage", {"days": {}})
    try: context_stamp = datetime.datetime.fromisoformat(usage.get("contextAt", "").replace("Z", "+00:00"))
    except (ValueError, TypeError, AttributeError): context_stamp = None
    current_context = context_stamp is None or stamp >= context_stamp
    days = usage["days"]
    daily = days.setdefault(day, {"requests": {}, "turns": {}})
    message = record.get("message") or {}
    if record.get("type") == "user" and not record.get("isMeta") and not record.get("isCompactSummary"):
        content = message.get("content")
        if isinstance(content, list) and any(item.get("type") == "tool_result" for item in content
                                             if isinstance(item, dict)): return
        text = content if isinstance(content, str) else " ".join(item.get("text", "") for item in (content or [])
                                                                if isinstance(item, dict))
        if text.startswith(("This session is being continued", "Base directory for this skill")): return
        identity = record.get("uuid")
        if identity and text.strip():
            origin = record.get("origin") or {}
            daily["turns"][identity] = wake_source(text, origin.get("kind") if isinstance(origin, dict) else None)
    if (record.get("type") == "system" and record.get("subtype") == "compact_boundary"
            and current_context):
        usage.pop("warned", None)
        usage["context"] = {"prompt": 0, "window": configured_window(record, override)}
        usage["contextAt"] = timestamp
    if record.get("type") == "assistant" and not record.get("isApiErrorMessage"):
        stats = message.get("usage")
        if message.get("model") == "<synthetic>" or not isinstance(stats, dict): return
        identity = message.get("id") or record.get("requestId") or record.get("uuid")
        if not identity: return
        current = {field: number(stats.get(field)) for field in (*FIELDS.values(), "input_tokens")}
        previous = daily["requests"].get(identity, {})
        daily["requests"][identity] = {field: max(value, previous.get(field, 0)) for field, value in current.items()}
        prompt = sum(current[field] for field in ("input_tokens", "cache_read_input_tokens",
                                                  "cache_creation_input_tokens"))
        if current_context:
            window = configured_window(record, override)
            usage["context"] = {"prompt": prompt, "window": window}
            usage["contextAt"] = timestamp
            usage["contextSession"] = record.get("sessionId") or "current"
            pickup(cursor, notify)
    for old in sorted(days)[:-7]: del days[old]


def pickup(cursor, notify=True):
    usage = cursor.get("usage") or {}
    context = usage.get("context") or {}
    session = usage.get("contextSession") or "current"
    if (context.get("window") and context.get("prompt", 0) > context["window"] * 0.85
            and usage.get("warned") != session):
        if notify:
            sequence = max(time.time_ns() // 1000000, number((usage.get("pickup") or {}).get("sequence")) + 1)
            usage["pickup"] = {"sequence": sequence, "prompt": context["prompt"], "window": context["window"]}
            print("COLLECTOR | write your pickup note: context has passed 85% of the compaction window", flush=True)
        usage["warned"] = session


def publish_pickup(cursor, marker):
    notice = (cursor.get("usage") or {}).get("pickup")
    if not notice: return
    try:
        try:
            with open(marker, encoding="utf-8") as source:
                if json.load(source) == notice: return
        except (OSError, ValueError): pass
        with open(marker + ".tmp", "w", encoding="utf-8") as target: json.dump(notice, target)
        os.replace(marker + ".tmp", marker)
    except OSError:
        print("COLLECTOR | cannot publish the pickup warning; trying again next tick", flush=True)


def initialize(directory, cursor, override=0):
    if "usage" in cursor: return
    cursor["usage"] = {"days": {}}
    today = datetime.datetime.now(datetime.timezone.utc).date().isoformat()
    for file in glob.glob(os.path.join(directory, "*.jsonl")):
        if os.path.basename(file).startswith("agent-"): continue
        with open(file, "r", encoding="utf-8", errors="replace") as source:
            for line in source:
                try: record = json.loads(line)
                except ValueError: continue
                if str(record.get("timestamp", ""))[:10] == today: observe(record, cursor, override, notify=False)
    cursor["usage"].pop("warned", None)


def pulse(cursor):
    usage = cursor.get("usage") or {}
    days = []
    for day, daily in sorted(usage.get("days", {}).items()):
        requests = list(daily["requests"].values())
        totals = {name: sum(record.get(field, 0) for record in requests) for name, field in FIELDS.items()}
        prompt = totals["cacheRead"] + totals["cacheWrite"] + sum(item.get("input_tokens", 0) for item in requests)
        days.append({"day": day, "requests": len(requests), **totals,
                     "avgPrompt": round(prompt / len(requests)) if requests else 0,
                     "turns": {source: list(daily["turns"].values()).count(source) for source in SOURCES}})
    return {"days": days, "context": usage.get("context", {"prompt": 0, "window": 0})}
