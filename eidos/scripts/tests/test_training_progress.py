import json
import sys
import tempfile
import unittest
import os
import subprocess
import time
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from voice_training_core import Job


class TrainingProgressTests(unittest.TestCase):
    def test_real_lightning_callback_emits_final_progress_without_terminal_output(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'progress.json'
            runtime = Path(__file__).resolve().parents[1] / 'voice_runtime'
            source = '''import torch
from torch.utils.data import DataLoader
from pytorch_lightning import Trainer, LightningModule
class Model(LightningModule):
 def __init__(self):
  super().__init__(); self.layer=torch.nn.Linear(1,1)
 def training_step(self,batch,_index): return self.layer(batch).square().mean()
 def configure_optimizers(self): return torch.optim.SGD(self.parameters(),lr=.01)
Trainer(max_epochs=2,accelerator='cpu',devices=1,logger=False,enable_checkpointing=False,enable_model_summary=False).fit(Model(),DataLoader(torch.ones(4,1),batch_size=1))
'''
            env = {**os.environ, 'PYTHONPATH': str(runtime), 'EIDOS_GPT_PROGRESS': str(path),
                   'EIDOS_STAGE_STARTED_AT': str(int(time.time() * 1000)), 'NUMBA_CACHE_DIR': str(Path(directory) / 'numba'), 'MPLCONFIGDIR': str(Path(directory) / 'mpl')}
            result = subprocess.run([sys.executable, '-u', '-B', '-c', source], env=env, capture_output=True, text=True, timeout=45)
            data = json.loads(path.read_text())
            self.assertEqual((data['state'], data['epoch'], data['completedEpochs'], data['batch'], data['batches']), ('complete', 2, 2, 4, 4))
            self.assertIn('[Eidos GPT] Epoch 2/2 completed', result.stdout)
            if result.returncode:
                # Some Conda hosts reproduce the reported MPI teardown failure even on this tiny CPU job.
                # Progress is still authoritative; every other nonzero exit remains a test failure.
                from voice_training_exports import mpi_completed
                self.assertTrue(mpi_completed(result.stdout + result.stderr, 2), result.stderr[-2000:])

    def test_callback_reports_one_based_epochs_real_batches_and_cumulative_time(self):
        import time
        from voice_runtime.progress_reporter import ProgressReporter
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'gpt-progress.json'
            reporter = ProgressReporter(path, 15, int((time.time() - 20) * 1000))
            reporter.epoch_start(4, 96)
            reporter.batch_end(96)
            data = json.loads(path.read_text())
            self.assertEqual((data['epoch'], data['epochs'], data['batch'], data['batches']), (5, 15, 96, 96))
            self.assertEqual(data['completedEpochs'], 4)
            self.assertGreaterEqual(data['elapsedSeconds'], 20)
            reporter.epoch_end(4)
            self.assertEqual(json.loads(path.read_text())['completedEpochs'], 5)
            reporter.finish()
            self.assertEqual(json.loads(path.read_text())['completedEpochs'], 5)

    def test_gpt_stage_does_not_reuse_epoch_from_previous_child(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)
            (path / 'job.json').write_text(json.dumps(dict(id='progress', status='training', stage='训练 GPT', epoch=0, epochTotal=15)))
            (path / 'worker.log').write_text('====> Epoch: 8\n')
            job = Job(path)
            job.run([sys.executable, '-c', 'import time; time.sleep(1.1)'])
            self.assertEqual(job.data['epoch'], 0)

    def test_worker_count_is_bounded_and_reaches_gpt_config(self):
        from voice_training_pipeline import training_configs
        from voice_training_options import training_options
        job = SimpleNamespace(data=dict(version='v2', trainingOptions=dict(gptWorkers=4)), directory=Path('/tmp/progress-test'))
        _, config = training_configs(job, Path('/official'), False, dict(train={}, model={}, data={}), dict(train={}, data={}))
        self.assertEqual(config['data']['num_workers'], 4)
        for workers in (0, -1, 17, True, '4'):
            job.data['trainingOptions']['gptWorkers'] = workers
            with self.assertRaises(ValueError): training_options(job)
