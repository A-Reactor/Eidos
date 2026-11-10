"""WAV loader compatibility for upstream SV extraction on TorchCodec-free hosts.

Only the SV subprocess enables this shim. Keep upstream scripts as their actual
entrypoints so multiprocessing trainers can import their main module correctly.
"""
import os

if os.environ.get('EIDOS_GPT_PROGRESS'):
    from lightning_progress import install_training_progress
    install_training_progress()

if os.environ.get('EIDOS_VOICE_PCM_IO') == '1':
    import soundfile
    import torch
    import torchaudio

    def load_pcm(uri, frame_offset=0, num_frames=-1, normalize=True, channels_first=True, **_kwargs):
        with soundfile.SoundFile(uri) as source:
            source.seek(frame_offset)
            data = source.read(frames=num_frames, dtype='float32', always_2d=True)
            rate = source.samplerate
        tensor = torch.from_numpy(data.T.copy() if channels_first else data.copy())
        return tensor, rate

    torchaudio.load = load_pcm
