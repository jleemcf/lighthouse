#!/usr/bin/env python3
"""Record check: a quiet look at one firstmate home's records, for the operator's sweep tick. Reads only.

    record-check.py --home <firstmate home> [--cursor <file>]
                    [--cards <cards.json> | --server <url> --board <id> [--token <t>]]

The board never reads firstmate's records: the operator opens, moves and closes tasks in its own words. This check
exists so that a change the operator missed is noticed. It fingerprints every backlog item (section, last status
line, pull request from the meta file), compares with the previous run, and prints one line per item that changed
since, saying whether any card on the board mentions the item's id or its pull request.
It writes nothing but its cursor file. The operator reads the lines and decides; nothing here touches the board.

Output, one line per changed item:
    RECORD CHECK | <id> | <section> | <last status line> | on board: yes|no|unknown
and a final line  RECORD CHECK | <n> changed of <m> items  (first run: every item counts as changed).
"""
import argparse, json, os, re, sys, urllib.request

ITEM = re.compile(r"^- \[(?P<done>[ xX])\] (?P<id>[A-Za-z0-9._-]+) - (?P<rest>.*)$")
TAG = re.compile(r"\((?P<k>repo|kind|priority|since|hold)[: ]\s*(?P<v>[^)]*)\)")


def parse_backlog(path):
    items, section = [], None
    if not os.path.exists(path):
        return items
    for raw in open(path, encoding="utf-8", errors="replace"):
        line = raw.rstrip("\n")
        h = re.match(r"^##\s+(In flight|Queued|Done)\s*$", line, re.I)
        if h:
            section = h.group(1).lower().replace(" ", "")
            continue
        m = ITEM.match(line)
        if m and section:
            rest = m.group("rest")
            items.append({"id": m.group("id"),
                          "section": "done" if m.group("done").lower() == "x" else section,
                          "title": TAG.sub("", rest).strip().rstrip(" -")})
    return items


def last_status(path):
    if not os.path.exists(path):
        return ""
    lines = [l.strip() for l in open(path, encoding="utf-8", errors="replace") if l.strip()]
    return lines[-1] if lines else ""


def read_meta(path):
    meta = {}
    if os.path.exists(path):
        for l in open(path, encoding="utf-8", errors="replace"):
            if "=" in l:
                k, v = l.rstrip("\n").split("=", 1)
                meta[k.strip()] = v.strip()
    return meta


def fingerprint(home, it):
    st = last_status(os.path.join(home, "state", it["id"] + ".status"))
    meta = read_meta(os.path.join(home, "state", it["id"] + ".meta"))
    return {"section": it["section"], "last": st[:200], "pr": meta.get("pr", ""), "title": it["title"]}


def card_text(c):
    parts = [c.get("id", ""), c.get("title", ""), c.get("description", "")]
    parts += [d.get("ask", "") for d in (c.get("decisions") or []) if isinstance(d, dict)]
    parts += [e.get("text", "") for e in (c.get("log") or []) if isinstance(e, dict)]
    return "\n".join(str(x) for x in parts)


def mentioned(cards, tid, fp):
    if cards is None:
        return "unknown"
    needles = [tid]
    m = re.search(r"/pull/(\d+)$", fp.get("pr", "") or "")
    if m:
        needles += ["PR #" + m.group(1), "PR " + m.group(1), "#" + m.group(1), fp["pr"]]
    for c in cards:
        t = card_text(c)
        if any(n and n in t for n in needles):
            return "yes"
    return "no"


def load_cards(a):
    if a.cards:
        d = json.load(open(a.cards, encoding="utf-8"))
        return list(d.values()) if isinstance(d, dict) else d
    if a.server:
        token = a.token or os.environ.get("LH_TOKEN", "")
        req = urllib.request.Request(a.server.rstrip("/") + "/api/state", headers={"Authorization": "Bearer " + token})
        try:
            st = json.load(urllib.request.urlopen(req, timeout=15))
        except Exception as e:
            print(f"RECORD CHECK | board unreadable: {e}")
            return None
        return [c for c in st.get("cards", {}).values() if not a.board or c.get("board") == a.board]
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--home", required=True, help="firstmate home (holds data/backlog.md and state/)")
    ap.add_argument("--cursor",
                    help="fingerprints from the previous run (default: record-check-cursor.json beside this script)")
    ap.add_argument("--cards",
                    help="a JSON file of cards (a list, or the cards object from /api/state); "
                         "for tests and offline use")
    ap.add_argument("--server", help="board server base URL; reads /api/state with the token")
    ap.add_argument("--board", help="board id to compare against on the server")
    ap.add_argument("--token", help="operator token (else the LH_TOKEN environment variable)")
    a = ap.parse_args()
    cursor = a.cursor or os.path.join(os.path.dirname(os.path.abspath(__file__)), "record-check-cursor.json")
    prev = json.load(open(cursor, encoding="utf-8")) if os.path.exists(cursor) else None
    items = parse_backlog(os.path.join(a.home, "data", "backlog.md"))
    cards = load_cards(a)
    cur, changed = {}, []
    for it in items:
        fp = fingerprint(a.home, it)
        cur[it["id"]] = fp
        if prev is None or prev.get(it["id"]) != fp:
            changed.append((it, fp))
    for tid in (prev or {}):
        if tid not in cur:
            print(f"RECORD CHECK | {tid} | gone from the backlog | | on board: {mentioned(cards, tid, prev[tid])}")
    for it, fp in changed:
        print(f"RECORD CHECK | {it['id']} | {fp['section']} | {fp['last'] or 'no status line'} | "
              f"on board: {mentioned(cards, it['id'], fp)}")
    print(f"RECORD CHECK | {len(changed)} changed of {len(items)} items" + (" (first run)" if prev is None else ""))
    sys.stdout.flush()
    json.dump(cur, open(cursor, "w", encoding="utf-8"), indent=1)


if __name__ == "__main__":
    main()
