import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from voice_training_core import Job


class ExportRecoveryTests(unittest.TestCase):
    def test_restores_only_complete_compatible_final_exports_after_mpi_finalize(self):
        import torch
        from voice_training_exports import recover_exported_voice
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory); run = base / 'run-123'
            (run / 'gpt').mkdir(parents=True); (run / 'sovits').mkdir()
            (base / 'clips').mkdir(); (base / 'clips/ref.wav').write_bytes(b'RIFF' + b'x' * 100)
            data = dict(id='recover', status='failed', stage='训练 GPT', version='v2', runDirectory=str(run),
                        clips=[dict(id='ref', file='ref.wav', duration=5, text='你好', included=True)])
            (base / 'job.json').write_text(json.dumps(data))
            log = '`Trainer.fit` stopped: `max_epochs=15` reached.\nFatal error in internal_Finalize: MPI_Finalize failed'
            (base / 'worker.log').write_text(log)
            torch.save(dict(weight={'model.ar_text_embedding.word_embeddings.weight': torch.zeros(732, 2)}, info='GPT-e15'), run / 'gpt/voice-e15.ckpt')
            torch.save(dict(weight={'enc_p.text_embedding.weight': torch.zeros(732, 2)}, config=dict(model=dict(version='v2')), info='8epoch_768iteration'), run / 'sovits/voice_e8_s768.pth')
            job = Job(base); recover_exported_voice(job)
            self.assertEqual(job.data['status'], 'complete')
            self.assertIn('MPI', job.data['warning'])
            self.assertEqual(job.data['epoch'], 15)
            final_gpt = run / 'gpt/voice-e15.ckpt'
            original = final_gpt.read_bytes()
            torch.save(dict(weight={'model.ar_text_embedding.word_embeddings.weight': torch.zeros(732, 2)}, info='GPT-e10'), final_gpt)
            with self.assertRaisesRegex(ValueError, '目标轮数'): recover_exported_voice(Job(base))
            final_gpt.write_bytes(original)
            (base / 'worker.log').write_text('RuntimeError: CUDA out of memory')
            with self.assertRaisesRegex(ValueError, '核验'): recover_exported_voice(Job(base))
            (base / 'worker.log').write_text(log)
            (run / 'gpt/voice-e15.ckpt').write_bytes(b'broken file')
            with self.assertRaises(Exception): recover_exported_voice(Job(base))

    def test_does_not_recover_an_external_directory(self):
        from voice_training_exports import recover_exported_voice
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            (base / 'job.json').write_text(json.dumps(dict(id='bad', status='failed', stage='训练 GPT', version='v2', runDirectory='/outside/run-123', clips=[])))
            with self.assertRaisesRegex(ValueError, '目录'): recover_exported_voice(Job(base))
