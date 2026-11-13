"""Owner's rulings as numbered records for the board and the steward (STEWARD-ASSISTANT-DESIGN.md section 5).

DIRECTION.md stays the record of his words; this turns its numbered rulings into the bundled fallback rulings.json.
Each record: number, title, the dated attribution as written, the full text, and
whether his words came in his own voice or were relayed. Run after DIRECTION.md changes:

    python lighthouse/server/make-rulings.py [--show]
    python lighthouse/server/make-rulings.py --source policies.md --out <board home>/rulings.json [--profile FILE]
"""
import argparse, io, json, os, re

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "..", "DIRECTION.example.md")
OUT = os.path.join(HERE, "rulings.json")
ITEM = re.compile(r"^(\d+)\. \*\*(.+?)\*\*\s*(.*)$")
START = re.compile(r"^(\d+)\. \*\*")
RELAYED = re.compile(r"relayed|through (?:the |his )?\w+ operator|by his \w+ operator", re.I)

def parse(text, profile=None):
    profile = profile or {}
    lines = text.split("\n")
    i = 0
    while i < len(lines):   # first, a bold title that wraps onto the next lines is joined into one line
        if START.match(lines[i]) and not ITEM.match(lines[i]):
            k = i + 1
            while k < len(lines) and "**" not in lines[k] and k - i < 4: k += 1
            if k < len(lines) and "**" in lines[k]:
                lines[i] = lines[i] + " " + " ".join(x.strip() for x in lines[i + 1:k + 1]); del lines[i + 1:k + 1]
        i += 1
    section, sec_of = "", []
    for ln in lines:
        if ln.startswith("## ") or ln.startswith("### "): section = ln
        sec_of.append(section)
    out, seen, i = [], set(), 0
    while i < len(lines):
        m = ITEM.match(lines[i]); sec = sec_of[i]
        sections = profile.get("sections", [])
        keep = m and (not sections or any(sec.startswith(rule["prefix"])
                    and int(m.group(1)) >= rule.get("minimum", 1) for rule in sections))
        if not keep: i += 1; continue
        n, title, rest = int(m.group(1)), m.group(2).strip(), m.group(3).strip()
        body = [rest] if rest else []
        j = i + 1
        while j < len(lines) and not ITEM.match(lines[j]) and not lines[j].startswith("#"):
            body.append(lines[j].strip()); j += 1
        full = re.sub(r"\s+", " ", " ".join(body)).strip()
        att = re.match(r"^\(([^)]*)\)", full)
        head = att.group(1) if att else full[:300]
        if n not in seen:
            seen.add(n)
            rec = {"n": n, "title": title.rstrip(".:"), "attribution": att.group(1) if att else "", "text": full,
                   "source": "relayed" if RELAYED.search(head) else "own"}
            if n in profile.get("scene", []): rec["scene"] = True
            if str(n) in profile.get("supersededBy", {}):
                rec["supersededBy"] = profile["supersededBy"][str(n)]
            out.append(rec)
        i = j
    return sorted(out, key=lambda r: r["n"])

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source")
    parser.add_argument("--out", default=OUT)
    parser.add_argument("--profile")
    parser.add_argument("--show", action="store_true")
    args = parser.parse_args()
    profile_path = args.profile
    profile = json.load(io.open(profile_path, encoding="utf-8")) if profile_path else {}
    source = args.source or SRC
    rulings = parse(io.open(source, encoding="utf-8").read(), profile)
    io.open(args.out, "w", encoding="utf-8", newline="\n").write(
        json.dumps({"from": os.path.basename(source), "count": len(rulings), "rulings": rulings},
                   ensure_ascii=False, indent=1))
    nums = [r["n"] for r in rulings]
    last = max(nums, default=0)
    missing = [k for k in range(1, last + 1) if k not in nums]
    print(f"{len(rulings)} rulings, 1..{last}" + (f"; missing {missing}" if missing else ""))
    if args.show:
        for r in rulings: print(r["n"], r["source"], "|", r["title"][:60], "|", r["attribution"][:50])
