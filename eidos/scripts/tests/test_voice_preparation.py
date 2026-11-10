import json
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from voice_training_core import Job, prepare, transcribe


class PreparationTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        (self.root / 'job.json').write_text(json.dumps(dict(id='task', status='preparing', language='ja', clips=[])))
        self.job = Job(self.root)

    def tearDown(self):
        self.tmp.cleanup()

    def test_child_progress_survives_parent_heartbeat_without_overwriting_job(self):
        child = Job(self.root)
        child.report_preparation('transcribing', 1, 3)
        self.job.update(log='parent heartbeat')
        self.assertEqual(json.loads((self.root / 'preparation-progress.json').read_text()),
                         dict(phase='transcribing', completed=1, total=3))
        self.assertEqual(Job(self.root).data['log'], 'parent heartbeat')

    def test_preparation_counts_finished_source_files_and_finishes_only_after_review_is_ready(self):
        self.job.update(autoTranscribe=False)
        sources = self.root / 'sources'
        sources.mkdir()
        for filename in ['one.wav', 'two.wav']:
            (sources / filename).touch()
        reports = []
        original = self.job.report_preparation
        def report(phase, completed=None, total=None):
            reports.append((phase, completed, total, self.job.data['status']))
            original(phase, completed, total)
        self.job.report_preparation = report
        with patch('voice_training_core.slice_audio', side_effect=lambda source, *_: [dict(id=source.stem, file=source.name, duration=5, text='', included=True)]):
            prepare(self.job, self.root)
        self.assertEqual([row[:3] for row in reports], [('slicing', 0, 2), ('slicing', 1, 2), ('slicing', 2, 2), ('complete', 1, 1)])
        self.assertEqual(reports[-1][3], 'review')
        self.assertEqual(len(Job(self.root).data['clips']), 2)

    def test_asr_reports_model_loading_and_each_completed_clip_in_both_backends(self):
        for language in ['zh', 'ja']:
            with self.subTest(language=language):
                self.job.update(language=language, clips=[dict(file='one.wav', text=''), dict(file='two.wav', text='')])
                reports = []
                original = Job.report_preparation
                def report(phase, completed=None, total=None):
                    reports.append((phase, completed, total))
                    original(self.job, phase, completed, total)
                self.job.report_preparation = report
                def model(*args, **kwargs):
                    self.assertEqual(reports[-1], ('loading-asr', None, None))
                    return SimpleNamespace(generate=lambda **_: [dict(text='中文')],
                        transcribe=lambda *a, **kw: ([SimpleNamespace(text='Japanese')], None))
                with patch.dict(sys.modules, {'funasr': SimpleNamespace(AutoModel=model), 'faster_whisper': SimpleNamespace(WhisperModel=model)}):
                    transcribe(self.job)
                self.assertEqual(reports, [('loading-asr', None, None), ('transcribing', 0, 2), ('transcribing', 1, 2), ('transcribing', 2, 2)])
                self.assertTrue(all(clip['text'] for clip in json.loads((self.root / 'transcripts.json').read_text())))

    def test_cancel_does_not_report_preparation_complete(self):
        self.job.update(autoTranscribe=False)
        (self.root / 'sources').mkdir()
        (self.root / 'sources' / 'one.wav').touch()
        (self.root / 'cancel').touch()
        with self.assertRaises(InterruptedError):
            prepare(self.job, self.root)
        self.assertNotEqual(json.loads((self.root / 'preparation-progress.json').read_text())['phase'], 'complete')


if __name__ == '__main__':
    unittest.main()
