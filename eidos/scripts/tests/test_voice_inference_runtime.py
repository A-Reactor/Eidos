import sys
import unittest
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from voice_inference_runtime import VoiceInferenceRuntime


def hardware(cuda=False, mps=False):
    return SimpleNamespace(cuda=SimpleNamespace(is_available=lambda: cuda),
                           backends=SimpleNamespace(mps=SimpleNamespace(is_available=lambda: mps)))


class InferenceRuntimeTests(unittest.TestCase):
    def test_automatic_selection_prefers_cuda_then_mps_then_cpu(self):
        for cuda, mps, expected in [(True, True, 'cuda'), (False, True, 'mps'), (False, False, 'cpu')]:
            with self.subTest(device=expected):
                observed = []
                runtime = VoiceInferenceRuntime(hardware(cuda, mps), lambda device, half: observed.append((device, half)) or device)
                self.assertEqual(runtime.run(lambda pipeline: pipeline), expected)
                self.assertEqual(observed, [(expected, expected == 'cuda')])

    def test_explicit_cpu_is_honored_on_accelerated_hardware(self):
        runtime = VoiceInferenceRuntime(hardware(True, True), lambda device, half: (device, half), 'cpu')
        self.assertEqual(runtime.run(lambda pipeline: pipeline), ('cpu', False))

    def test_invalid_or_unavailable_explicit_devices_are_explained(self):
        for device in ('mps', 'cuda', 'invalid'):
            with self.subTest(device=device), self.assertRaises(ValueError):
                VoiceInferenceRuntime(hardware(), lambda *_: None, device)

    def test_mps_load_failure_retries_on_cpu_and_reports_the_reason(self):
        calls = []
        def create(device, half):
            calls.append((device, half))
            if device == 'mps':
                raise RuntimeError('MPS backend out of memory')
            return device
        runtime = VoiceInferenceRuntime(hardware(mps=True), create)
        self.assertEqual(runtime.run(lambda pipeline: pipeline), 'cpu')
        self.assertEqual(calls, [('mps', False), ('cpu', False)])
        self.assertIn('MPS', runtime.fallback_reason)
        self.assertEqual(runtime.device, 'cpu')

    def test_inference_fallback_retries_once_and_keeps_the_request(self):
        calls = []
        runtime = VoiceInferenceRuntime(hardware(mps=True), lambda device, half: device)
        def infer(pipeline):
            calls.append(pipeline)
            if pipeline == 'mps':
                raise NotImplementedError('operator is not currently implemented for MPS')
            return 'the same utterance on CPU'
        self.assertEqual(runtime.run(infer), 'the same utterance on CPU')
        self.assertEqual(runtime.run(lambda pipeline: pipeline), 'cpu')
        self.assertEqual(calls, ['mps', 'cpu'])

    def test_cuda_out_of_memory_falls_back_to_float32_cpu(self):
        runtime = VoiceInferenceRuntime(hardware(cuda=True), lambda device, half: (device, half))
        def infer(pipeline):
            if pipeline[0] == 'cuda':
                raise RuntimeError('CUDA out of memory')
            return pipeline
        self.assertEqual(runtime.run(infer), ('cpu', False))

    def test_missing_models_and_other_request_errors_do_not_trigger_fallback(self):
        for error in (FileNotFoundError('missing.pth'), ValueError('bad language'), RuntimeError('bad tensor shape')):
            with self.subTest(error=type(error).__name__):
                runtime = VoiceInferenceRuntime(hardware(mps=True), lambda *_: 'mps')
                with self.assertRaises(type(error)):
                    runtime.run(lambda _: (_ for _ in ()).throw(error))
                self.assertEqual(runtime.device, 'mps')
                self.assertEqual(runtime.fallback_reason, '')

    def test_cpu_failure_after_fallback_is_propagated_without_looping(self):
        calls = []
        runtime = VoiceInferenceRuntime(hardware(mps=True), lambda device, _: device)
        def infer(device):
            calls.append(device)
            raise RuntimeError('MPS unsupported' if device == 'mps' else 'CPU failed')
        with self.assertRaisesRegex(RuntimeError, 'CPU failed'):
            runtime.run(infer)
        self.assertEqual(calls, ['mps', 'cpu'])


if __name__ == '__main__':
    unittest.main()
