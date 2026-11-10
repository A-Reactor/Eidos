import json
import math
import struct
import sys
import tempfile
import unittest
import wave
from types import SimpleNamespace
from unittest.mock import patch
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from voice_training_core import Job, slice_audio, inspect_installation
from voice_training_pipeline import train, training_configs, verified_clips
from voice_training_models import ModelSelection
from voice_training_options import training_options


class TrainingTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def job(self, **extra):
        data = dict(id='abc', name='角色', version='v2', language='zh', status='preparing', clips=[], **extra)
        (self.root / 'job.json').write_text(json.dumps(data))
        return Job(self.root)

    def test_slices_real_audio_with_bounded_lengths_and_total_duration(self):
        source = self.root / 'source.wav'
        with wave.open(str(source), 'wb') as out:
            out.setparams((1, 2, 32000, 0, 'NONE', 'not compressed'))
            out.writeframes(b''.join(struct.pack('<h', int(3000 * math.sin(i * 0.08))) for i in range(32000 * 23)))
        clips = slice_audio(source, self.root / 'clips')
        self.assertEqual([round(c['duration']) for c in clips], [8, 8, 7])
        self.assertTrue(all((self.root / 'clips' / c['file']).is_file() for c in clips))

    def test_job_state_is_durable_and_cancel_is_checked_before_subprocess(self):
        job = self.job()
        job.update(status='review', clips=[dict(id='clip-0', text='你好')])
        self.assertEqual(Job(self.root).data['clips'][0]['text'], '你好')
        (self.root / 'cancel').touch()
        with self.assertRaises(InterruptedError):
            job.run([sys.executable, '-c', "raise Exception('must not run')"])

    def test_subprocess_failure_keeps_log_and_does_not_report_success(self):
        job = self.job()
        with self.assertRaises(RuntimeError):
            job.run([sys.executable, '-c', "print('model missing'); raise SystemExit(4)"])
        self.assertIn('model missing', (self.root / 'worker.log').read_text())

    def test_configs_use_isolated_outputs_and_cpu_precision(self):
        job = self.job()
        s2, s1 = training_configs(job, self.root / 'official', False,
            {'train': {}, 'data': {}, 'model': {}}, {'train': {}, 'data': {}})
        self.assertFalse(s2['train']['fp16_run'])
        self.assertEqual(s1['train']['precision'], '32')
        self.assertEqual(s1['train']['batch_size'], 1)
        self.assertGreaterEqual(s1['data']['num_workers'], 1)
        self.assertTrue(s2['save_weight_dir'].startswith(str(self.root)))
        self.assertTrue(s1['train']['half_weights_save_dir'].startswith(str(self.root)))
        self.assertNotEqual(s2['save_weight_dir'], s1['train']['half_weights_save_dir'])

    def test_official_script_contract_produces_both_exports(self):
        job = self.job()
        job.update(clips=[dict(id='ref', file='ref.wav', duration=5, text='你好', included=True)])
        root = self.root / 'official'
        configs = root / 'GPT_SoVITS/configs'
        configs.mkdir(parents=True)
        (configs / 's2.json').write_text(json.dumps(dict(train={}, data={}, model={})))
        (configs / 's1longer-v2.yaml').write_text(json.dumps(dict(train={}, data={})))
        scripts = {
            'prepare_datasets/1-get-text.py': "from pathlib import Path; import os; (Path(os.environ['opt_dir'])/'2-name2text-0.txt').write_text('ref.wav\\tphones\\t0\\t你好')",
            'prepare_datasets/2-get-hubert-wav32k.py': 'pass',
            # Match upstream's explicit version argument, catching conflicting config keys.
            'prepare_datasets/3-get-semantic.py': "import os,json; from pathlib import Path\nc=json.loads(Path(os.environ['s2config_path']).read_text())\ndef construct(*, version): pass\nconstruct(version='v2', **c['model'])\n(Path(os.environ['opt_dir'])/'6-name2semantic-0.tsv').write_text('ref.wav\\t1 2 3')",
            # Upstream exporters expect their destination directories to exist already.
            's2_train.py': "import sys,json; from pathlib import Path\nc=json.loads(Path(sys.argv[2]).read_text())\nassert c['model']['version'] in ('v2', 'v2ProPlus')\n# Official config loading creates only s2_ckpt_dir. The trainer saves to a versioned path.\nPath(c['s2_ckpt_dir']).mkdir(parents=True,exist_ok=True)\ncheckpoints=Path(c['data']['exp_dir'])/('logs_s2_'+c['model']['version'])\n(checkpoints/'G_233333333333.pth').write_bytes(b'generator')\n(checkpoints/'D_233333333333.pth').write_bytes(b'discriminator')\n(Path(c['save_weight_dir'])/'voice.pth').write_bytes(b'x'*2048)",
            's1_train.py': "import sys,json; from pathlib import Path\nc=json.loads(Path(sys.argv[2]).read_text())\n(Path(c['train']['half_weights_save_dir'])/'voice.ckpt').write_bytes(b'x'*2048)",
        }
        for filename, source in scripts.items():
            target = root / 'GPT_SoVITS' / filename
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(source)
        modules = dict(torch=SimpleNamespace(cuda=SimpleNamespace(is_available=lambda: False)),
                       yaml=SimpleNamespace(safe_load=json.loads, safe_dump=json.dumps))
        (configs / 's2v2ProPlus.json').write_text(json.dumps(dict(train={}, data={}, model={})))
        (root / 'GPT_SoVITS/prepare_datasets/2-get-sv.py').write_text('pass')
        previous_run = None
        for version in ('v2', 'v2ProPlus'):
            with self.subTest(version=version):
                job.update(version=version)
                with patch.dict(sys.modules, modules), patch('voice_training_pipeline.inspect_installation', return_value={'versions': [dict(id=version, ready=True)]}):
                    train(job, root)
                self.assertEqual(job.data['status'], 'complete')
                self.assertTrue(Path(job.data['result']['gptWeights']).is_file())
                self.assertTrue(Path(job.data['result']['sovitsWeights']).is_file())
                self.assertEqual(job.data['result']['referenceId'], 'ref')
                self.assertEqual(len(job.data['checkpoints']['gpt']), 1)
                run = Path(job.data['runDirectory'])
                self.assertEqual((run / f'features/logs_s2_{version}/G_233333333333.pth').read_bytes(), b'generator')
                self.assertEqual((run / f'features/logs_s2_{version}/D_233333333333.pth').read_bytes(), b'discriminator')
                if previous_run:
                    self.assertNotEqual(run, previous_run)
                    self.assertTrue((previous_run / 's2.json').is_file())
                    self.assertTrue((previous_run / 'sovits/voice.pth').is_file())
                previous_run = run

    def test_custom_controls_reach_both_trainers_without_implicit_cpu_batch_changes(self):
        job = self.job(trainingOptions=dict(sovitsEpochs=12, gptEpochs=20, sovitsBatchSize=2,
            gptBatchSize=3, sovitsSaveEvery=4, gptSaveEvery=5, textLearningRate=0.3, dpo=True))
        s2, s1 = training_configs(job, self.root, False, dict(train={}, data={}, model={}), dict(train={}, data={}))
        self.assertEqual((s2['train']['epochs'], s2['train']['batch_size'], s2['train']['save_every_epoch']), (12, 2, 4))
        self.assertEqual(s2['train']['text_low_lr_rate'], 0.3)
        self.assertEqual((s1['train']['epochs'], s1['train']['batch_size'], s1['train']['save_every_n_epoch']), (20, 3, 5))
        self.assertTrue(s1['train']['if_dpo'])
        for values in [dict(gptEpochs=0), dict(sovitsEpochs=True), dict(gptEpochs=16), dict(textLearningRate=float('nan'))]:
            job.data['trainingOptions'] = values
            with self.assertRaises(ValueError): training_options(job)

    def test_review_requires_text_and_a_reference_clip(self):
        job = self.job()
        job.data['clips'] = [dict(id='a', file='a.wav', duration=5, text='', included=True)]
        with self.assertRaises(ValueError):
            verified_clips(job)
        job.data['clips'][0]['text'] = '你好'
        self.assertEqual(verified_clips(job)[0]['text'], '你好')
        job.data['clips'][0]['duration'] = 1
        with self.assertRaises(ValueError):
            verified_clips(job)

    def test_incomplete_proplus_is_not_reported_as_ready(self):
        models = self.root / 'GPT_SoVITS' / 'pretrained_models'
        models.mkdir(parents=True)
        (models / 's2Gv2ProPlus.pth').write_bytes(b'partial')
        info = inspect_installation(self.root)
        pro = next(v for v in info['versions'] if v['id'] == 'v2ProPlus')
        self.assertFalse(pro['ready'])
        self.assertIn('s1v3.ckpt', ' '.join(pro['missing']))
        self.assertIn('s2Dv2ProPlus.pth', ' '.join(pro['missing']))

    def test_model_selection_restores_default_and_reloads_after_partial_failure(self):
        class Pipeline:
            calls = []
            fail = False
            def init_t2s_weights(self, path): self.calls.append(('gpt', path))
            def init_vits_weights(self, path):
                self.calls.append(('sovits', path))
                if self.fail: raise RuntimeError('bad weights')
        p = Pipeline()
        selection = ModelSelection('base.ckpt', 'base.pth')
        selection.apply(p, 'alice.ckpt', 'alice.pth')
        selection.apply(p)
        self.assertEqual(p.calls[-2:], [('sovits', 'base.pth'), ('gpt', 'base.ckpt')])
        p.fail = True
        with self.assertRaises(RuntimeError): selection.apply(p, 'bad.ckpt', 'bad.pth')
        p.fail = False
        selection.apply(p)
        self.assertEqual(p.calls[-2:], [('sovits', 'base.pth'), ('gpt', 'base.ckpt')])

    def test_model_change_invalidates_prompt_features_and_uses_the_new_version_for_gpt(self):
        class Pipeline:
            def __init__(self):
                self.version = 'v2'
                self.prompt_cache = {'ref_audio_path': '/same.wav', 'prompt_semantic': 'old', 'refer_spec': ['old'],
                                     'prompt_text': '同一句', 'prompt_lang': 'zh', 'phones': [1], 'bert_features': 'old',
                                     'norm_text': '同一句', 'aux_ref_audio_paths': [], 'raw_audio': 'old', 'raw_sr': 32000}
            def init_t2s_weights(self, path): self.gpt_version = self.version
            def init_vits_weights(self, path): self.version = 'v2ProPlus'
        pipeline = Pipeline()
        selection = ModelSelection('base.ckpt', 'base.pth')
        selection.apply(pipeline, 'pro.ckpt', 'pro.pth')
        self.assertEqual(pipeline.gpt_version, 'v2ProPlus')
        self.assertIsNone(pipeline.prompt_cache['ref_audio_path'])
        self.assertIsNone(pipeline.prompt_cache['prompt_semantic'])
        self.assertIsNone(pipeline.prompt_cache['prompt_text'])
        self.assertEqual(pipeline.prompt_cache['refer_spec'], [])
        self.assertNotIn('raw_audio', pipeline.prompt_cache)


if __name__ == '__main__':
    unittest.main()
