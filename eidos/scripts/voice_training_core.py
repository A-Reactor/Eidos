"""Local voice training: filesystem state and cancellable, shell-free tools."""
import importlib.util
import json
import os
import re
import shutil
import signal
import subprocess
import time
import wave
from pathlib import Path


def model_paths(root, version):
    base = Path(root) / 'GPT_SoVITS' / 'pretrained_models'
    if version == 'v2':
        return dict(gpt=base / 'gsv-v2final-pretrained/s1bert25hz-5kh-longer-epoch=12-step=369668.ckpt',
                    sovits=base / 'gsv-v2final-pretrained/s2G2333k.pth',
                    discriminator=base / 'gsv-v2final-pretrained/s2D2333k.pth')
    if version != 'v2ProPlus':
        raise ValueError('不支持的训练版本')
    canonical = base / 'v2Pro/s2Gv2ProPlus.pth'
    return dict(gpt=base / 's1v3.ckpt', sovits=canonical if canonical.is_file() else base / 's2Gv2ProPlus.pth',
                discriminator=base / 'v2Pro/s2Dv2ProPlus.pth',
                sv=base / 'sv/pretrained_eres2netv2w24s4ep4.ckpt')


def inspect_installation(root):
    root = Path(root)
    common = [root / 'GPT_SoVITS/pretrained_models/chinese-hubert-base/pytorch_model.bin',
              root / 'GPT_SoVITS/pretrained_models/chinese-roberta-wwm-ext-large/pytorch_model.bin']
    modules = ['torch', 'numpy', 'scipy', 'librosa', 'soundfile', 'yaml', 'pytorch_lightning', 'transformers', 'peft']
    missing_modules = [name for name in modules if importlib.util.find_spec(name) is None]
    versions = []
    for version in ('v2', 'v2ProPlus'):
        files = list(model_paths(root, version).values()) + common
        missing = [str(p.relative_to(root)) for p in files if not p.is_file()]
        versions.append(dict(id=version, ready=not missing and not missing_modules, missing=missing))
    return dict(root=str(root), python=os.sys.executable, ffmpeg=bool(shutil.which('ffmpeg')),
                mac=os.sys.platform == 'darwin', missingModules=missing_modules, versions=versions,
                asr={name: importlib.util.find_spec(name) is not None for name in ('funasr', 'faster_whisper')},
                configuredModel='自定义' if os.environ.get('GOVITS_SOVITS_MODEL') else 'v2')


class Job:
    def __init__(self, directory):
        self.directory = Path(directory)
        self.path = self.directory / 'job.json'
        self.data = json.loads(self.path.read_text(encoding='utf-8'))

    def update(self, **values):
        now = int(time.time() * 1000)
        if 'stage' in values and values['stage'] != self.data.get('stage'):
            values['stageStartedAt'] = now
            values['stageElapsedSeconds'] = 0
            if values['stage'] != '训练 GPT':
                self.data.pop('trainingProgress', None)
        elif self.data.get('stageStartedAt'):
            values['stageElapsedSeconds'] = max(0, (now - self.data['stageStartedAt']) // 1000)
        self.data.update(values, updatedAt=int(time.time() * 1000))
        temporary = self.directory / 'job.worker.tmp'
        temporary.write_text(json.dumps(self.data, ensure_ascii=False), encoding='utf-8')
        temporary.replace(self.path)

    def report_preparation(self, phase, completed=None, total=None):
        # ASR runs in a child process; its progress must not race the parent's job/log heartbeat.
        progress = dict(phase=phase)
        if completed is not None and total is not None:
            progress.update(completed=completed, total=total)
        temporary = self.directory / f'preparation-progress.{os.getpid()}.tmp'
        temporary.write_text(json.dumps(progress), encoding='utf-8')
        temporary.replace(self.directory / 'preparation-progress.json')

    def check(self):
        if (self.directory / 'cancel').exists():
            raise InterruptedError('任务已取消；素材与校对内容已保留')

    def run(self, args, cwd=None, env=None, timeout=24 * 60 * 60):
        self.check()
        log_path = self.directory / 'worker.log'
        with log_path.open('ab', buffering=0) as output:
            offset = log_path.stat().st_size
            output.write(('\n> ' + ' '.join(map(str, args)) + '\n').encode())
            child = subprocess.Popen(list(map(str, args)), cwd=cwd, env=env, stdout=output,
                                     stderr=subprocess.STDOUT, start_new_session=os.name != 'nt')
            start = time.monotonic()
            try:
                while child.poll() is None:
                    self.check()
                    if time.monotonic() - start > timeout:
                        raise TimeoutError('任务超过时间上限，请检查日志后重试')
                    raw = self.log_tail(log_path, 5000, offset)
                    epoch = re.findall(r'(?:Epoch\s*:?\s*|Train Epoch:\s*)(\d+)', raw)
                    progress = self.training_progress()
                    self.update(log=raw[-4000:], **({'trainingProgress': progress, 'epoch': progress['epoch']} if progress else
                        {'epoch': int(epoch[-1])} if epoch and self.data.get('stage') != '训练 GPT' else {}))
                    time.sleep(1)
                if child.returncode:
                    raise TrainingToolError(child.returncode, self.log_tail(log_path, 32000, offset))
            finally:
                if child.poll() is None:
                    if os.name == 'nt':
                        subprocess.run(['taskkill', '/PID', str(child.pid), '/T', '/F'], capture_output=True)
                    else:
                        os.killpg(child.pid, signal.SIGTERM)
                        try:
                            child.wait(timeout=5)
                        except subprocess.TimeoutExpired:
                            os.killpg(child.pid, signal.SIGKILL)
                    child.wait()
                progress = self.training_progress()
                self.update(log=self.log_tail(log_path, 4000, offset), **({'trainingProgress': progress, 'epoch': progress['epoch']} if progress else {}))

    def training_progress(self):
        if self.data.get('stage') != '训练 GPT' or not self.data.get('runDirectory'):
            return None
        filename = Path(self.data['runDirectory']) / 'gpt-progress.json'
        return json.loads(filename.read_text(encoding='utf-8')) if filename.is_file() else None

    @staticmethod
    def log_tail(path, size, offset=0):
        with path.open('rb') as log:
            log.seek(max(offset, path.stat().st_size - size))
            return log.read(size).decode('utf-8', errors='replace')


class TrainingToolError(RuntimeError):
    def __init__(self, code, output):
        super().__init__(f'训练工具退出码 {code}，请查看任务日志')
        self.output = output


def slice_audio(source, output, run=None):
    """Prefer silence boundaries; cap clips to 10 s even for continuous speech."""
    source, output = Path(source), Path(output)
    output.mkdir(parents=True, exist_ok=True)
    converted = output / f'{source.stem}-pcm.wav'
    args = ['ffmpeg', '-nostdin', '-v', 'error', '-y', '-i', source, '-ac', '1', '-ar', '32000', '-c:a', 'pcm_s16le', converted]
    if run:
        run(args, timeout=600)
    else:
        subprocess.run(list(map(str, args)), check=True, capture_output=True, timeout=600)
    with wave.open(str(converted), 'rb') as audio:
        rate = audio.getframerate()
        total = audio.getnframes()
        if total / rate > 15 * 60:
            raise ValueError('单份素材最多 15 分钟')
        samples = audio.readframes(total)
    import array
    values = array.array('h', samples)
    if os.sys.byteorder != 'little':
        values.byteswap()
    clips, start = [], 0
    while start < total:
        target = min(start + 8 * rate, total)
        if total - target < 3 * rate:
            target = total if total - start <= 10 * rate else total - 3 * rate
        # Find a quiet 100 ms window near the target, without cutting very short clips.
        if target < total:
            candidates = range(max(start + 3 * rate, target - rate), min(total, target + rate), rate // 10)
            quiet = [i for i in candidates if max(map(abs, values[i:i + rate // 10]), default=0) < 300]
            if quiet:
                target = min(quiet, key=lambda i: abs(i - target))
        if target - start < rate:
            break
        filename = f'{source.stem}-{len(clips):03d}.wav'
        with wave.open(str(output / filename), 'wb') as out:
            out.setparams((1, 2, rate, 0, 'NONE', 'not compressed'))
            out.writeframes(samples[start * 2:target * 2])
        clips.append(dict(id=Path(filename).stem, file=filename, duration=(target - start) / rate, text='', included=True))
        start = target
    converted.unlink()
    return clips


def prepare(job, root):
    job.update(status='preparing', stage='切分音频', error='')
    clips = []
    sources = sorted((job.directory / 'sources').iterdir())
    job.report_preparation('slicing', 0, len(sources))
    for index, source in enumerate(sources):
        job.check()
        clips.extend(slice_audio(source, job.directory / 'clips', job.run))
        job.report_preparation('slicing', index + 1, len(sources))
    if not clips or len(clips) > 200:
        raise ValueError('请提供可解码的人声音频，切片总数须在 1–200 段之间')
    job.update(clips=clips, duration=sum(c['duration'] for c in clips))
    if job.data.get('autoTranscribe', True):
        job.update(stage='自动转写')
        job.report_preparation('loading-asr')
        job.run([os.sys.executable, '-B', Path(__file__).parent / 'voice-training-worker.py', 'asr',
                 '--directory', job.directory, '--root', root], timeout=3600)
        clips = json.loads((job.directory / 'transcripts.json').read_text(encoding='utf-8'))
    job.update(status='review', stage='校对台词', clips=clips)
    job.report_preparation('complete', 1, 1)


def transcribe(job):
    clips = job.data['clips']
    language = job.data['language']
    job.check()
    job.report_preparation('loading-asr')
    if language == 'zh':
        from funasr import AutoModel
        model = AutoModel(model='paraformer-zh', vad_model='fsmn-vad', punc_model='ct-punc', device='cpu', disable_update=True)
        job.report_preparation('transcribing', 0, len(clips))
        for index, clip in enumerate(clips):
            job.check()
            result = model.generate(input=str(job.directory / 'clips' / clip['file']))
            clip['text'] = result[0].get('text', '') if result else ''
            job.report_preparation('transcribing', index + 1, len(clips))
    else:
        from faster_whisper import WhisperModel
        model = WhisperModel('small', device='cpu', compute_type='int8', download_root=str(job.directory.parent / 'cache/whisper'))
        job.report_preparation('transcribing', 0, len(clips))
        for index, clip in enumerate(clips):
            job.check()
            segments, _ = model.transcribe(str(job.directory / 'clips' / clip['file']), language=language)
            clip['text'] = ''.join(segment.text for segment in segments).strip()
            job.report_preparation('transcribing', index + 1, len(clips))
    (job.directory / 'transcripts.json').write_text(json.dumps(clips, ensure_ascii=False), encoding='utf-8')
