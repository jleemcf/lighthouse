#!/usr/bin/env python3
"""Fixture tests for lh-pending.py: synthetic firstmate transcripts in a temp dir. Run: python pending_test.py
The script carries install placeholders in its default path; the tests pass an explicit transcript dir instead."""
import json, os, subprocess, sys, tempfile, time

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPT = os.path.join(HERE, "..", "scripts", "lh-pending.py")
fails = 0


def check(name, ok):
    global fails
    print(("ok   " if ok else "FAIL ") + name)
    fails += 0 if ok else 1


def entry(kind, content, ts):
    return {"type": kind, "timestamp": ts, "message": {"role": kind, "content": content}}


def run(rows):
    with tempfile.TemporaryDirectory() as d:
        f = os.path.join(d, "s.jsonl")
        with open(f, "w", encoding="utf-8") as h:
            for r in rows:
                h.write(json.dumps(r) + "\n")
        out = subprocess.run([sys.executable, SCRIPT, d], capture_output=True, text=True)
        return out.stdout.strip()


ask = {"type": "tool_use", "id": "toolu_1", "name": "AskUserQuestion",
       "input": {"questions": [{"question": "What is the goal?"}]}}
answer = {"type": "tool_result", "tool_use_id": "toolu_1",
          "content": "Your questions have been answered: goal=smoke test"}
other_tool = {"type": "tool_use", "id": "toolu_2", "name": "Read", "input": {"file_path": "x"}}
other_result = {"type": "tool_result", "tool_use_id": "toolu_2", "content": "file text"}

check("quiet transcript is no", run([entry("assistant", [{"type": "text", "text": "Working on it."}], "t1")]) == "no")
check("question dialog without an answer is yes",
      run([entry("assistant", [{"type": "text", "text": "One question."}, ask], "t1")]) == "yes")
check("answered dialog is no", run([entry("assistant", [ask], "t1"), entry("user", [answer], "t2")]) == "no")
check("another tool's result does not answer the dialog",
      run([entry("assistant", [ask, other_tool], "t1"), entry("user", [other_result], "t2")]) == "yes")
check("phrase ask is still yes",
      run([entry("assistant", [{"type": "text", "text": "Holding for your ruling on the merge."}], "t1")]) == "yes")
check("a human reply clears a phrase ask",
      run([entry("assistant", [{"type": "text", "text": "Holding for your ruling."}], "t1"),
           entry("user", "merge it", "t2")]) == "no")
check("watcher-drain noise does not clear a phrase ask",
      run([entry("assistant", [{"type": "text", "text": "Holding for your ruling."}], "t1"),
           entry("user", "<system-reminder>Stop hook fired</system-reminder>", "t2")]) == "yes")
check("dialog answered, then a new phrase ask, is yes",
      run([entry("assistant", [ask], "t1"), entry("user", [answer], "t2"),
           entry("assistant", [{"type": "text", "text": "Awaiting your word on the deploy."}], "t3")]) == "yes")

print(f"{fails} failures")
sys.exit(1 if fails else 0)
