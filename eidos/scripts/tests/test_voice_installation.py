import sys
import unittest
import importlib.util
import tempfile
import os
from pathlib import Path
from types import SimpleNamespace
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from voice_installation import weight_languages, load_checkpoint


class WeightLanguageTests(unittest.TestCase):
    @unittest.skipUnless(importlib.util.find_spec('torch'), 'requires installed voice PyTorch')
    def test_inspection_rejects_executable_pickle_payloads(self):
        import torch
        with tempfile.TemporaryDirectory() as directory:
            marker = Path(directory) / 'must-not-exist'
            class Executable:
                def __reduce__(self):
                    return os.system, (f'touch {marker}',)
            target = Path(directory) / 'model.pth'
            torch.save({'weight': Executable()}, target)
            with self.assertRaises(Exception):
                load_checkpoint(torch, target)
            self.assertFalse(marker.exists())

    def test_checks_real_embedding_metadata_in_both_weights(self):
        def weights(size):
            shape = SimpleNamespace(shape=(size, 512))
            return ({'weight': {'model.ar_text_embedding.word_embeddings.weight': shape}},
                    {'weight': {'enc_p.text_embedding.weight': shape}, 'config': {'model': {'version': 'v2ProPlus'}}})
        self.assertEqual(weight_languages(*weights(322))['languages'], ['zh', 'ja', 'en'])
        self.assertEqual(weight_languages(*weights(732))['languages'], ['zh', 'ja', 'en', 'yue', 'ko'])

    def test_does_not_trust_names_or_unknown_architectures(self):
        with self.assertRaises(ValueError):
            weight_languages({'weight': {}}, {'config': {'model': {'version': 'v2ProPlus'}}, 'weight': {}})
        gpt = {'weight': {'model.ar_text_embedding.word_embeddings.weight': SimpleNamespace(shape=(322, 512))}}
        sovits = {'weight': {'enc_p.text_embedding.weight': SimpleNamespace(shape=(732, 192))}}
        with self.assertRaises(ValueError):
            weight_languages(gpt, sovits)

    def test_recognizes_official_lora_headers_without_inventing_support_for_unknown_weights(self):
        gpt = {'weight': {'model.ar_text_embedding.word_embeddings.weight': SimpleNamespace(shape=(732, 512))}}
        result = weight_languages(gpt, {'weight': {'cfm.to_k.lora_A.weight': 'tensor'}, 'lora_rank': 32, '_header_version': 'v3'})
        self.assertEqual(result, {'version': 'v3', 'languages': ['zh', 'ja', 'en', 'yue', 'ko']})
        with self.assertRaises(ValueError):
            weight_languages(gpt, {'weight': {}, 'lora_rank': 32})


if __name__ == '__main__':
    unittest.main()
