#!/usr/bin/env python3
"""The wake gate's report: what the rules and Jev did (or would have done) against what the operator actually did next.

    python gate-report.py [--home DIR] [--since 2026-09-21] [--window-min 3]

Reads gate-log.jsonl (one record per event), outbox.jsonl (the operator's own lines, written by the collector) and
gate-marks.jsonl (the operator's hand corrections from `shift.sh mark`). An event counts as ACTED ON when a tagged line
of the operator's that is not OPS, SHIFT or a routine FYI follows it within the window, or when it is marked acted.
Prints, per source and per decision: counts, the share the rules removed, the share Jev held or would hold, false holds
(held but acted on: the mistake that matters) and false wakes (woken but not acted on: the cheaper one), and a sweep of
the attention threshold so the cut can be read off the operator's own week. Read-only; never prints a key or a token.
"""
import argparse, collections, datetime, json, os, re, sys
ROUTINE = re.compile(r"routine|shipshape|nothing to do|nothing new|nothing changed|holding\b|re-?arm|expired|rewind"
                     r"|housekeeping|no change|unchanged", re.I)

def load(path):
    rows = []
    try:
        with open(path, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line: continue
                try: rows.append(json.loads(line))
                except Exception: pass
    except FileNotFoundError: pass
    return rows

def ts(s):
    try: return datetime.datetime.fromisoformat(str(s).replace("Z", "+00:00")).timestamp()
    except Exception: return None

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--home", default=os.path.dirname(os.path.abspath(__file__)))
    ap.add_argument("--since", default=None, help="YYYY-MM-DD; default: everything in the log")
    ap.add_argument("--window-min", type=float, default=3.0)
    a = ap.parse_args()
    events = [r for r in load(os.path.join(a.home, "gate-log.jsonl")) if r.get("id") and r.get("decision")]
    if a.since: events = [r for r in events if str(r.get("t", "")) >= a.since]
    lines = load(os.path.join(a.home, "outbox.jsonl"))
    marks = {m.get("id"): m.get("mark") for m in load(os.path.join(a.home, "gate-marks.jsonl"))}
    acted_times = sorted(t for t in (ts(l.get("t")) for l in lines
                                     if l.get("label") not in ("OPS", "SHIFT", None)
                                     and not (l.get("label") == "FYI" and ROUTINE.search(l.get("text") or ""))) if t)
    if not events:
        print("no events in the gate log" + (f" since {a.since}" if a.since else "")
              + "; is the gate in observe, shadow, rules or hold mode?"); return
    win = a.window_min * 60
    import bisect
    def acted(ev):
        if marks.get(ev["id"]) in ("acted", "noise"): return marks[ev["id"]] == "acted"
        t = ts(ev.get("t"))
        if t is None: return False
        i = bisect.bisect_right(acted_times, t)
        return i < len(acted_times) and acted_times[i] - t <= win
    for ev in events: ev["_acted"] = acted(ev); ev["_eff"] = ev.get("would") or ev.get("decision")
    first, last = events[0].get("t", "")[:16], events[-1].get("t", "")[:16]
    print(f"WAKE GATE REPORT  {first} -> {last}  events {len(events)}  operator lines {len(lines)}  "
          f"hand marks {len(marks)}  window {a.window_min:g} min")
    modes = collections.Counter(e.get("mode") for e in events)
    print("modes seen: " + ", ".join(f"{k} {v}" for k, v in modes.most_common()))
    print()
    print("BY DECISION (what happened, or in observe/shadow what would have)")
    dec = collections.defaultdict(lambda: [0, 0])
    for e in events: dec[e["_eff"]][0] += 1; dec[e["_eff"]][1] += e["_acted"]
    for k in ("wake", "pass", "hold", "drop"):
        if k in dec:
            n, ac = dec[k]; print(f"  {k:5s} {n:5d}  ({100*n/len(events):4.0f}%)   "
                                  f"acted on {ac:4d} ({100*ac/max(n,1):3.0f}%)")
    print()
    print("BY STAGE AND REASON")
    reasons = collections.Counter((e.get("stage"), re.sub(r'"[^"]*"|\d+(\.\d+)?', "…", str(e.get("reason"))))[:70]
                                  for e in events)
    for (stage, reason), n in reasons.most_common(25): print(f"  {stage:7s} {n:5d}  {reason}")
    print()
    print("BY SOURCE")
    for src, evs in sorted(collections.defaultdict(list, {s: [e for e in events if e.get("source") == s]
                                                          for s in set(e.get("source") for e in events)}).items()):
        c = collections.Counter(e["_eff"] for e in evs)
        print(f"  {src:10s} {len(evs):5d}   wake {c['wake']:4d}  pass {c['pass']:4d}  hold {c['hold']:4d}  "
              f"drop {c['drop']:4d}")
    print()
    judged = [e for e in events if isinstance(e.get("jev"), dict)]
    if judged:
        held = [e for e in judged if e["_eff"] == "hold"]; woke = [e for e in judged if e["_eff"] in ("wake", "pass")]
        fh = sum(e["_acted"] for e in held); fw = sum(not e["_acted"] for e in woke)
        print(f"JEV  judged {len(judged)}   "
              f"median latency {sorted(e['jev'].get('ms', 0) for e in judged)[len(judged)//2]} ms")
        print(f"  held {len(held):5d}   false holds (held but acted on) {fh:4d} ({100*fh/max(len(held),1):3.0f}%)   "
              f"<- the mistake that matters")
        print(f"  woke {len(woke):5d}   false wakes (woken, nothing done)  {fw:4d} ({100*fw/max(len(woke),1):3.0f}%)   "
              f"<- the cheaper one")
        print()
        print("ATTENTION THRESHOLD SWEEP (hold = routine or repeated progress, attention below T, confidence >= 0.6)")
        print("   T     held   false holds   woke   false wakes")
        for T in (0.3, 0.4, 0.5, 0.6, 0.7, 0.8):
            h = [e for e in judged if e["jev"].get("kind") in ("routine", "progress")
                 and not (e["jev"].get("kind") == "progress" and e["jev"].get("repeat", 1) < 0.5)
                 and e["jev"].get("attention", 1) < T and e["jev"].get("confidence", 0) >= 0.6]
            w = [e for e in judged if e not in h]
            print(f"  {T:.1f}  {len(h):6d}  {sum(e['_acted'] for e in h):11d}  {len(w):6d}  "
                  f"{sum(not e['_acted'] for e in w):11d}")
        print()
    dropped = [e for e in events if e["_eff"] == "drop"]
    if dropped:
        print(f"RULES DROPPED {len(dropped)}  of which acted on within the window {sum(e['_acted'] for e in dropped)} "
              f"(a rule to look at if this is not near zero)")
    print()
    print("marks: bash shift.sh mark <event id> acted|noise   (ids are in gate-log.jsonl; the newest are:)")
    for e in events[-5:]: print(f"  {e['id']:8s} {e.get('t','')[11:16]}Z {e['_eff']:5s} "
                                f"{'acted' if e['_acted'] else 'quiet'}  {str(e.get('line',''))[:80]}")

if __name__ == "__main__": main()
