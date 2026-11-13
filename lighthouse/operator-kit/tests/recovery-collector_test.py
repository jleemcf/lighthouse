import importlib.util
import errno
import json
import os
import pathlib
import tempfile
import time
import unittest
from unittest.mock import patch

scripts = pathlib.Path(__file__).resolve().parent.parent / 'scripts'
spec = importlib.util.spec_from_file_location('recovery_collector', scripts / 'collector.py')
collector = importlib.util.module_from_spec(spec)
spec.loader.exec_module(collector)
generation = collector.helper_generation


class RecoveryCollector(unittest.TestCase):
    def test_transient_generation_reads_retry_only_within_confirmed_expiry(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            active = root / 'active.json'
            lease = root / 'lease.json'
            identity = dict(id='helper', generation='generation', sessionId='session', epoch=1,
                            installationId='installation', board='fixture-board')
            active.write_text(json.dumps(identity), encoding='utf-8')
            record = dict(identity, registry=str(active), directory=directory, expiresAt=time.time() * 1000 + 3000)
            lease.write_text(json.dumps(record), encoding='utf-8')
            with patch.dict(os.environ, LH_HELPER_LEASE=str(lease), LH_HELPER_ID='helper'):
                self.assertEqual(generation.headers(), {'X-Lighthouse-Epoch': '1'})
                for code in [errno.EPERM, errno.EACCES, errno.EBUSY]:
                    with patch.object(generation, '_json', side_effect=OSError(code, 'transient read')):
                        self.assertEqual(generation.headers(), {'X-Lighthouse-Epoch': '1'})
                lease.write_text('{', encoding='utf-8')
                self.assertEqual(generation.headers(), {'X-Lighthouse-Epoch': '1'})
                (root / '2.generation.json').write_text('{}', encoding='utf-8')
                with self.assertRaises(SystemExit):
                    generation.headers()
                (root / '2.generation.json').unlink()
                record['expiresAt'] = 0
                lease.write_text(json.dumps(record), encoding='utf-8')
                with self.assertRaises(SystemExit):
                    generation.headers()
                with patch.object(generation, '_json', side_effect=OSError(errno.EBUSY, 'transient read')):
                    with self.assertRaises(SystemExit):
                        generation.headers()

    def test_no_transcript_replay_after_cross_home_cursor_import(self):
        with tempfile.TemporaryDirectory() as directory:
            transcript = pathlib.Path(directory) / 'transcript.jsonl'
            rows = [dict(type='assistant', uuid=identity, timestamp=stamp,
                         message=dict(role='assistant', content=[dict(type='text', text='New prose')]))
                    for identity, stamp in [('known', '2026-11-12T11:59:00Z'),
                                            ('older-trimmed', '2026-11-12T11:58:00Z'),
                                            ('new', '2026-11-12T12:01:00Z')]]
            transcript.write_text('\n'.join(json.dumps(row) for row in rows) + '\n', encoding='utf-8')
            cursor = dict(seen=['known'], offsets={}, hwm='2026-11-12T12:00:00Z',
                          recoveryFloor='2026-11-12T12:00:00Z')
            messages = []
            list(collector.scan(directory, cursor, messages))
            self.assertEqual([row['uuid'] for row in messages], ['new'])
            self.assertEqual(list(collector.scan(directory, cursor, [])), [])

    def test_scoped_headers_and_cursor_stop_when_the_generation_is_retired(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            active = root / 'active.json'
            lease = root / 'lease.json'
            identity = dict(id='helper-original', generation='generation-original', sessionId='session-original',
                            epoch=1, installationId='installation-original', board='fixture-board')
            active.write_text(json.dumps(identity), encoding='utf-8')
            lease.write_text(json.dumps(dict(identity, registry=str(active), directory=directory,
                                            expiresAt=int(time.time() * 1000) + 60000)), encoding='utf-8')
            with patch.dict(os.environ, LH_HELPER_LEASE=str(lease), LH_HELPER_ID='helper-original'):
                self.assertEqual(generation.headers(), {'X-Lighthouse-Epoch': '1'})
                target = root / 'cursor.json'
                collector.save_cursor(str(target), {'seen': ['known']}, None)
                saved = json.loads(target.read_text(encoding='utf-8'))
                self.assertEqual(saved['scope']['helperId'], 'helper-original')
                (root / '2.generation.json').write_text('{}', encoding='utf-8')
                with self.assertRaises(SystemExit):
                    collector.save_cursor(str(target), {'seen': ['replay']}, None)
                with self.assertRaises(SystemExit):
                    collector.post('http://127.0.0.1:1', 'fixture-credential', 'fixture-board', [])
                self.assertEqual(json.loads(target.read_text(encoding='utf-8')), saved)

    def test_feature_off_has_no_new_headers_or_cursor_scope(self):
        with patch.dict(os.environ, {}, clear=True), tempfile.TemporaryDirectory() as directory:
            self.assertEqual(generation.headers(), {})
            target = pathlib.Path(directory) / 'cursor.json'
            collector.save_cursor(str(target), {'seen': ['known']}, None)
            self.assertEqual(json.loads(target.read_text(encoding='utf-8')), {'seen': ['known']})


if __name__ == '__main__':
    unittest.main()
