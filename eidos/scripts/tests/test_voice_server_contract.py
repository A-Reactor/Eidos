import base64
import importlib.util
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import numpy as np
import soundfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
spec = importlib.util.spec_from_file_location('voice_server_contract', Path(__file__).resolve().parents[1] / 'voice-server-gpt-sovits.py')
server = importlib.util.module_from_spec(spec)
spec.loader.exec_module(server)


class VoiceServerContractTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.reference = Path(self.tmp.name) / 'reference.wav'
        soundfile.write(self.reference, np.zeros(4 * 32000), 32000)
        self.inputs = []
        def run(inputs):
            self.inputs.append(inputs)
            yield 32000, np.sin(np.arange(3200) / 10).astype(np.float32)
        self.pipeline = SimpleNamespace(run=run, prompt_cache={})
        self.patches = [patch.object(server, 'model_loaded', True),
                        patch.object(server, 'run_inference', lambda operation: operation(self.pipeline)),
                        patch.object(server.model_selection, 'apply', lambda *args: None),
                        patch.object(server, 'loaded_model_name', lambda: 'test'),
                        patch.object(server, 'inference_runtime', SimpleNamespace(device='cpu'))]
        for item in self.patches: item.start()
        self.client = server.app.test_client()

    def tearDown(self):
        for item in reversed(self.patches): item.stop()
        self.tmp.cleanup()

    def test_explicit_local_reference_path_is_used_with_its_transcript(self):
        response = self.client.post('/synthesize', json=dict(text='你好', language='zh', referenceLanguage='ja',
            referencePath=str(self.reference), promptText='こんにちは'))
        self.assertEqual(response.status_code, 200, response.json)
        self.assertEqual(self.inputs[0]['ref_audio_path'], str(self.reference))
        self.assertEqual(self.inputs[0]['prompt_lang'], 'ja')
        self.assertEqual(self.inputs[0]['prompt_text'], 'こんにちは')
        self.assertGreater(len(base64.b64decode(response.json['audio'])), 44)

    def test_explicit_broken_reference_does_not_fall_back_to_another_voice(self):
        with patch.object(server, 'get_default_ref_path', return_value=self.reference):
            for reference in [dict(referenceAudio='broken'), dict(referencePath=str(self.reference) + '.missing')]:
                response = self.client.post('/synthesize', json=dict(text='你好', useDefaultVoice=True, **reference))
                self.assertEqual(response.status_code, 400)
                self.assertIn('参考音频', response.json['error'])
        self.assertEqual(self.inputs, [])

    def test_changed_reference_language_invalidates_cached_text_features(self):
        self.pipeline.prompt_cache = dict(prompt_text='同一句', prompt_lang='zh')
        response = self.client.post('/synthesize', json=dict(text='你好', language='zh', referenceLanguage='ja',
            referencePath=str(self.reference), promptText='同一句'))
        self.assertEqual(response.status_code, 200)
        self.assertIsNone(self.pipeline.prompt_cache['prompt_text'])
