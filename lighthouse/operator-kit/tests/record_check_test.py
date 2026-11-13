#!/usr/bin/env python3
"""Fixture tests for record-check.py: a fake firstmate home in a temp dir, run several times.
Run: python record_check_test.py"""
import importlib.util, io, json, os, subprocess, sys, tempfile
from unittest.mock import patch

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPT = os.path.join(HERE, "..", "scripts", "record-check.py")
fails = 0


def check(name, ok):
    global fails
    print(("ok   " if ok else "FAIL ") + name)
    fails += 0 if ok else 1


def run(home, cursor, cards=None):
    cmd = [sys.executable, SCRIPT, "--home", home, "--cursor", cursor] + (["--cards", cards] if cards else [])
    out = subprocess.run(cmd, capture_output=True, text=True)
    return out.stdout, out.returncode


with tempfile.TemporaryDirectory() as d:
    os.makedirs(os.path.join(d, "data"))
    os.makedirs(os.path.join(d, "state"))
    with open(os.path.join(d, "data", "backlog.md"), "w") as f:
        f.write("## In flight\n- [ ] testfile - Add machines/example/TEST-TASK.md marker file (repo: x) (kind: ship)\n"
                "- [ ] other - Another thing (repo: x)\n## Queued\n- [ ] later - Later work\n"
                "## Done\n- [x] finished - Old work\n")
    open(os.path.join(d, "state", "testfile.status"), "w").write("working: started\ndone: PR ready\n")
    open(os.path.join(d, "state", "testfile.meta"), "w").write("pr=https://github.com/example/lighthouse/pull/26\n")
    open(os.path.join(d, "state", "other.status"), "w").write("working: on it\n")
    cards = os.path.join(d, "cards.json")
    cursor = os.path.join(d, "cursor.json")
    json.dump([{"id": "lighthouse-test-task", "title": "Add a marker file to the repo",
                "description": "The pull request (PR #26) is open."}], open(cards, "w"))

    out, rc = run(d, cursor, cards)
    check("exit 0", rc == 0)
    check("first run reports every item", out.count("RECORD CHECK | ") == 5 and "(first run)" in out)
    check("an item the board mentions by its PR is 'yes'",
          "| testfile | inflight | done: PR ready | on board: yes" in out)
    check("an item nobody mentions is 'no'", "| other | inflight | working: on it | on board: no" in out)
    check("a checked item is done", "| finished | done |" in out)
    check("cursor written", os.path.exists(cursor))

    out, rc = run(d, cursor, cards)
    check("no change: only the summary line", out.strip() == "RECORD CHECK | 0 changed of 4 items")

    open(os.path.join(d, "state", "other.status"), "a").write("paused: waiting on CI\n")
    out, rc = run(d, cursor, cards)
    check("only the changed item is reported", out.count("RECORD CHECK | ") == 2
          and "| other | inflight | paused: waiting on CI | on board: no" in out)

    open(os.path.join(d, "data", "backlog.md"), "w").write(
        "## In flight\n- [ ] other - Another thing\n## Queued\n## Done\n")
    out, rc = run(d, cursor, cards)
    check("a vanished item is reported as gone", "| testfile | gone from the backlog |" in out)

    open(os.path.join(d, "state", "other.status"), "a").write("note: again\n")
    out, rc = run(d, cursor)
    check("without a board the mention column is unknown", "on board: unknown" in out)

    previous = open(cursor, encoding="utf-8").read()
    open(os.path.join(d, "state", "other.status"), "a").write("paused: output failed\n")
    spec = importlib.util.spec_from_file_location("record_check", SCRIPT)
    record_check = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(record_check)

    class ClosedOutput(io.StringIO):
        def flush(self):
            raise BrokenPipeError("fixture closed output")

    failed = False
    with patch.object(sys, "argv", [SCRIPT, "--home", d, "--cursor", cursor]), \
            patch.object(sys, "stdout", ClosedOutput()):
        try:
            record_check.main()
        except BrokenPipeError:
            failed = True
    check("closed output fails before cursor commit", failed and open(cursor, encoding="utf-8").read() == previous)
    out, rc = run(d, cursor)
    check("failed output is retried", rc == 0 and "paused: output failed" in out)

print(f"{fails} failures")
sys.exit(1 if fails else 0)
