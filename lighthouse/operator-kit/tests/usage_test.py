import contextlib
import datetime
import importlib.util
import io
import json
import os
import pathlib
import tempfile
import types
import unittest
from unittest.mock import patch

SCRIPTS = pathlib.Path(__file__).resolve().parents[1] / "scripts"
SPEC = importlib.util.spec_from_file_location("collector", SCRIPTS / "collector.py")
collector = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(collector)
usage = collector.collector_usage


def assistant(identity, timestamp, output=10, **fields):
    return {"type": "assistant", "uuid": identity + "-" + str(output), "timestamp": timestamp,
            "sessionId": "test-session", "message": {"id": identity, "model": "fixture-model",
            "content": [{"type": "text", "text": "PRIVATE transcript text"}],
            "usage": {"input_tokens": 100, "cache_read_input_tokens": 700,
                      "cache_creation_input_tokens": 100, "output_tokens": output}}, **fields}


class UsageTests(unittest.TestCase):
    def test_copied_compaction_history_cannot_reset_live_context_or_rearm_pickup(self):
        with tempfile.TemporaryDirectory() as directory, contextlib.redirect_stdout(io.StringIO()) as output:
            cursor = {}
            usage.observe(assistant("live", "2026-11-10T12:00:00Z"), cursor, 1000)
            sequence = cursor["usage"]["pickup"]["sequence"]
            historical = assistant("old", "2026-11-10T10:01:00Z")
            historical["message"]["usage"] = {"input_tokens": 100}
            records = [{"type": "system", "subtype": "compact_boundary",
                        "timestamp": "2026-11-10T13:00:00+03:00"}, historical]
            file = pathlib.Path(directory) / "copied.jsonl"
            file.write_text("\n".join(json.dumps(record) for record in records) + "\n", encoding="utf-8")
            cursor["usage_window"] = 1000
            list(collector.scan(directory, cursor))
            self.assertEqual(cursor["usage"]["context"], {"prompt": 900, "window": 1000})
            self.assertEqual(cursor["usage"]["contextAt"], "2026-11-10T12:00:00Z")
            self.assertEqual(cursor["usage"]["warned"], "test-session")
            self.assertEqual(cursor["usage"]["pickup"]["sequence"], sequence)
            usage.observe(assistant("still-live", "2026-11-10T12:01:00Z"), cursor, 1000)
            self.assertEqual(output.getvalue().count("write your pickup note"), 1)
            usage.observe({"type": "system", "subtype": "compact_boundary",
                           "timestamp": "2026-11-10T12:02:00Z"}, cursor, 1000)
            usage.observe(assistant("after-compaction", "2026-11-10T12:03:00Z"), cursor, 1000)
            self.assertEqual(output.getvalue().count("write your pickup note"), 2)

    def test_daily_requests_streaming_forks_and_wake_sources_are_numeric_only(self):
        with tempfile.TemporaryDirectory() as directory:
            records = [
                {"type": "user", "uuid": "wake", "timestamp": "2026-11-09T23:59:00Z",
                 "message": {"content": "<task-notification>\nFM REPLY 10:00 | PRIVATE\n</task-notification>"}},
                assistant("response", "2026-11-09T23:59:01Z", 3),
                assistant("response", "2026-11-09T23:59:02Z", 10),
                assistant("side", "2026-11-09T23:59:03Z", isSidechain=True),
                assistant("error", "2026-11-09T23:59:04Z", isApiErrorMessage=True),
                {"type": "user", "uuid": "tool-result", "timestamp": "2026-11-09T23:59:05Z",
                 "message": {"content": [{"type": "tool_result", "content": "PRIVATE"}]}},
                {"type": "attachment", "uuid": "queued", "timestamp": "2026-11-09T23:59:06Z",
                 "attachment": {"type": "queued_command", "prompt": "PRIVATE"}},
                assistant("next-day", "2026-11-10T00:00:01Z"),
            ]
            file = pathlib.Path(directory) / "session.jsonl"
            file.write_text("\n".join(json.dumps(record) for record in records) + "\n", encoding="utf-8")
            cursor = {}
            list(collector.scan(directory, cursor))
            first = usage.pulse(cursor)["days"][0]
            self.assertEqual((first["requests"], first["cacheRead"], first["cacheWrite"], first["output"],
                              first["avgPrompt"]), (1, 700, 100, 10, 900))
            self.assertEqual(first["turns"]["fm_reply"], 1)
            self.assertEqual(sum(first["turns"].values()), 1)
            (pathlib.Path(directory) / "fork.jsonl").write_text(file.read_text(encoding="utf-8"), encoding="utf-8")
            list(collector.scan(directory, cursor))
            self.assertEqual([day["requests"] for day in usage.pulse(cursor)["days"]], [1, 1])
            self.assertNotIn("PRIVATE", json.dumps(usage.pulse(cursor)))
            self.assertNotIn(directory, json.dumps(usage.pulse(cursor)))

    def test_pickup_warning_reads_the_existing_window_and_never_changes_it(self):
        with tempfile.TemporaryDirectory() as directory:
            settings = pathlib.Path(directory) / ".claude" / "settings.local.json"
            settings.parent.mkdir()
            text = json.dumps({"autoCompactWindow": 1000})
            settings.write_text(text, encoding="utf-8")
            cursor = {}
            output = io.StringIO()
            with patch.dict(os.environ, {"CLAUDE_CODE_AUTO_COMPACT_WINDOW": ""}), contextlib.redirect_stdout(output):
                usage.observe(assistant("first", "2026-11-10T12:00:00Z", cwd=directory), cursor)
                usage.observe(assistant("second", "2026-11-10T12:01:00Z", cwd=directory), cursor)
                usage.observe({"type": "system", "subtype": "compact_boundary",
                               "timestamp": "2026-11-10T12:02:00Z"}, cursor)
                usage.observe(assistant("third", "2026-11-10T12:03:00Z", cwd=directory), cursor)
            self.assertEqual(output.getvalue().count("write your pickup note"), 2)
            self.assertEqual(settings.read_text(encoding="utf-8"), text)
            self.assertEqual(usage.pulse(cursor)["context"], {"prompt": 900, "window": 1000})

    def test_pickup_marker_is_numeric_persisted_and_rearmed_by_compaction(self):
        with tempfile.TemporaryDirectory() as directory, contextlib.redirect_stdout(io.StringIO()):
            marker = pathlib.Path(directory) / "usage-pickup.json"
            cursor = {}
            usage.observe(assistant("first", "2026-11-10T12:00:00Z"), cursor, 1000)
            usage.publish_pickup(cursor, str(marker))
            first = json.loads(marker.read_text(encoding="utf-8"))
            self.assertEqual(set(first), {"sequence", "prompt", "window"})
            self.assertTrue(all(isinstance(value, int) for value in first.values()))
            self.assertEqual((first["prompt"], first["window"]), (900, 1000))
            usage.observe(assistant("second", "2026-11-10T12:01:00Z"), cursor, 1000)
            usage.publish_pickup(cursor, str(marker))
            self.assertEqual(json.loads(marker.read_text(encoding="utf-8")), first)
            usage.observe({"type": "system", "subtype": "compact_boundary",
                           "timestamp": "2026-11-10T12:02:00Z"}, cursor, 1000)
            usage.observe(assistant("third", "2026-11-10T12:03:00Z"), cursor, 1000)
            usage.publish_pickup(cursor, str(marker))
            self.assertGreater(json.loads(marker.read_text(encoding="utf-8"))["sequence"], first["sequence"])
            self.assertNotIn("pickup", usage.pulse(cursor))

    def test_instrument_pulse_survives_an_events_post_failure(self):
        with tempfile.TemporaryDirectory() as directory, contextlib.redirect_stdout(io.StringIO()):
            arguments = ["collector.py", "--transcript-dir", directory, "--board", "fixture", "--once",
                         "--cursor", str(pathlib.Path(directory) / "cursor.json"),
                         "--server", "http://127.0.0.1:1", "--token", "fixture"]
            with patch.object(collector.sys, "argv", arguments), \
                    patch.object(collector, "post_instruments", return_value=1) as pulse, \
                    patch.object(collector, "run_once", side_effect=OSError("fixture event refusal")):
                collector.main()
            self.assertEqual(pulse.call_count, 1)

    def test_collector_once_publishes_warning_next_to_cursor_without_repeating_on_restart(self):
        with tempfile.TemporaryDirectory() as directory:
            today = datetime.datetime.now(datetime.timezone.utc).isoformat()
            (pathlib.Path(directory) / "session.jsonl").write_text(
                json.dumps(assistant("today", today)) + "\n", encoding="utf-8")
            arguments = ["collector.py", "--transcript-dir", directory, "--board", "fixture", "--once",
                         "--cursor", str(pathlib.Path(directory) / "cursor.json"),
                         "--outbox", str(pathlib.Path(directory) / "outbox.jsonl"),
                         "--compaction-window", "1000", "--token", "fixture"]
            for expected in (1, 0):
                output = io.StringIO()
                with patch.object(collector.sys, "argv", arguments), contextlib.redirect_stdout(output):
                    collector.main()
                self.assertEqual(output.getvalue().count("write your pickup note"), expected)
                marker = json.loads((pathlib.Path(directory) / "usage-pickup.json").read_text(encoding="utf-8"))
                self.assertEqual((marker["prompt"], marker["window"]), (900, 1000))

    def test_upgrade_seeds_today_without_posting_history_or_double_counting(self):
        with tempfile.TemporaryDirectory() as directory:
            today = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT12:00:00Z")
            file = pathlib.Path(directory) / "session.jsonl"
            file.write_text(json.dumps(assistant("today", today)) + "\n", encoding="utf-8")
            cursor = {"offsets": {str(file): file.stat().st_size}}
            usage.initialize(directory, cursor)
            self.assertEqual(list(collector.scan(directory, cursor)), [])
            self.assertEqual(usage.pulse(cursor)["days"][0]["requests"], 1)
            usage.initialize(directory, cursor)
            self.assertEqual(usage.pulse(cursor)["days"][0]["requests"], 1)

    def test_pulse_carries_numeric_usage_without_transcript_or_identifiers(self):
        cursor = {}
        usage.observe(assistant("private-request-id", "2026-11-10T12:00:00Z"), cursor)
        captured = []
        def send(request, **kwargs):
            captured.append(json.loads(request.data))
            return types.SimpleNamespace(read=lambda: b"{}")
        with patch.object(collector.urllib.request, "urlopen", send):
            collector.post_instruments("http://127.0.0.1:1", "fixture", "t", 0, cursor)
        self.assertEqual(captured[0]["usage"]["days"][0]["requests"], 1)
        self.assertNotIn("private-request-id", json.dumps(captured))
        self.assertNotIn("PRIVATE", json.dumps(captured))


if __name__ == "__main__":
    unittest.main()
