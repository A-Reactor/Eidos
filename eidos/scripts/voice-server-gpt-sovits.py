#!/usr/bin/env python3
"""
MOMOI Voice Server — GPT-SoVITS 音色克隆引擎（默认模型 v2）

GPT-SoVITS 是音色克隆系统，始终需要参考音频来定义目标音色。
- 零样本模式：5s+ 参考音频即可克隆，无需训练
- 参考音频来源：请求体 base64 或磁盘音色档案 public/generated/{worldId}/voices/{speaker}.wav
- 无参考音频 → 返回错误，提示用户上传参考音频

设置:
  1. git clone https://github.com/RVC-Boss/GPT-SoVITS.git ../GPT-SoVITS
  2. cd ../GPT-SoVITS && pip install -r requirements.txt
  3. 下载预训练模型到 GPT_SoVITS/pretrained_models/
  4. huggingface-cli download lj1995/GPT-SoVITS gsv-v2final-pretrained/...
  5. 下载 BERT 模型: hfl/chinese-roberta-wwm-ext-large, TencentGameMate/chinese-hubert-base

API:
  GET  /health       → {"status":"ready"}
  POST /synthesize   → 需要 speaker+worldId 或 referenceAudio
"""

import io, os, sys, time, base64, logging, argparse, warnings, tempfile, threading, functools
os.environ.setdefault('PYTORCH_ENABLE_MPS_FALLBACK', '1')
from voice_training_models import ModelSelection
from voice_inference_runtime import VoiceInferenceRuntime
from pathlib import Path
import numpy as np
import soundfile
from flask import Flask, request, jsonify

warnings.filterwarnings("ignore")

logging.basicConfig(level=logging.INFO, format="[GPT-SoVITS] %(message)s")
log = logging.getLogger("gpt-sovits")
app = Flask(__name__)

import logging as _logging
_logging.getLogger("werkzeug").setLevel(_logging.WARNING)

# ============================================================
# Config
# ============================================================

GOVITS_HOME = Path(os.environ.get("GOVITS_HOME",
    Path(__file__).parent.parent.parent.parent / "GPT-SoVITS")).resolve()
VOICE_DIR = (Path(__file__).parent.parent / "public" / "generated").resolve()

MODELS_DIR = GOVITS_HOME / "GPT_SoVITS" / "pretrained_models"
GPT_MODEL = MODELS_DIR / "gsv-v2final-pretrained" / "s1bert25hz-5kh-longer-epoch=12-step=369668.ckpt"
SOVITS_MODEL = MODELS_DIR / "gsv-v2final-pretrained" / "s2G2333k.pth"

GPT_MODEL = Path(os.environ.get("GOVITS_GPT_MODEL", GPT_MODEL))
SOVITS_MODEL = Path(os.environ.get("GOVITS_SOVITS_MODEL", SOVITS_MODEL))
model_selection = ModelSelection(GPT_MODEL, SOVITS_MODEL)
inference_lock = threading.RLock()


def serialized_inference(function):
    @functools.wraps(function)
    def wrapped(*args, **kwargs):
        with inference_lock:
            return function(*args, **kwargs)
    return wrapped

# ============================================================
# Model state
# ============================================================

tts_pipeline = None
inference_runtime = None
model_loaded = False
model_error = None
_server_start_time: float = 0.0


def load_model():
    global tts_pipeline, inference_runtime, model_loaded, model_error
    model_error = None

    # GPT-SoVITS 内部模块用相对导入，cwd 必须是仓库根目录
    os.chdir(str(GOVITS_HOME))
    sys.path.insert(0, str(GOVITS_HOME))
    sys.path.insert(0, str(GOVITS_HOME / "GPT_SoVITS"))

    # Monkey-patch: torchaudio 2.11 默认用 torchcodec 后端，需要 FFmpeg 版本匹配。
    # 用 soundfile 替代，避免 torchcodec/FFmpeg 兼容问题。
    import torchaudio, soundfile, torch as _torch
    def _sf_load(uri, *_a, **_kw):
        audio, sr = soundfile.read(uri, dtype="float32")
        if audio.ndim == 1:
            audio = audio.reshape(1, -1)
        elif audio.ndim == 2:
            audio = audio.T
        return _torch.from_numpy(audio.copy()), sr
    torchaudio.load = _sf_load

    # 确保 fast_langdetect 缓存目录存在（否则会 FileNotFoundError）
    ld_dir = MODELS_DIR / "fast_langdetect"
    ld_dir.mkdir(parents=True, exist_ok=True)

    from GPT_SoVITS.TTS_infer_pack.TTS import TTS, TTS_Config

    if not GPT_MODEL.exists():
        raise FileNotFoundError(f"GPT 模型不存在: {GPT_MODEL}")
    if not SOVITS_MODEL.exists():
        raise FileNotFoundError(f"SoVITS 模型不存在: {SOVITS_MODEL}")

    log.info(f"GPT: {GPT_MODEL}")
    log.info(f"SoVITS: {SOVITS_MODEL}")

    def create_pipeline(device, is_half):
        selected = model_selection.active or model_selection.default
        tts_config = TTS_Config()
        from process_ckpt import get_sovits_version_from_path_fast
        tts_config.update_version(get_sovits_version_from_path_fast(selected[1])[1])
        tts_config.device = _torch.device(device)
        tts_config.is_half = is_half
        tts_config.t2s_weights_path, tts_config.vits_weights_path = selected
        # Eidos owns these choices; model switches must not rewrite upstream shared settings.
        tts_config.save_configs = lambda: None
        pipeline = TTS(tts_config)
        model_selection.active = selected
        return pipeline

    inference_runtime = VoiceInferenceRuntime(_torch, create_pipeline, os.environ.get('MOMOI_DEVICE', 'auto'))
    tts_pipeline = inference_runtime.run(lambda pipeline: pipeline)

    model_loaded = True
    log.info(f"GPT-SoVITS 就绪 · {inference_runtime.device.upper()}")


def run_inference(operation):
    global tts_pipeline
    previous = inference_runtime.device
    try:
        return inference_runtime.run(operation)
    finally:
        tts_pipeline = inference_runtime.pipeline
        if previous != inference_runtime.device:
            log.warning(inference_runtime.fallback_reason)


# ============================================================
# 参考音频
# ============================================================

def get_disk_ref_path(world_id: str, speaker: str) -> Path | None:
    """查找磁盘上的 NPC 音色档案"""
    if not world_id or not speaker:
        return None
    p = VOICE_DIR / world_id / "voices" / f"{speaker}.wav"
    if p.exists() and p.stat().st_size >= 3000:
        try:
            with open(p, "rb") as f:
                if f.read(4) == b"RIFF":
                    return p
        except OSError:
            pass
    return None


def get_default_ref_path() -> Path | None:
    """查找全局默认音色参考音频。
    优先级：1) VOICE_DIR 下的 default.wav  2) 遍历所有 world/voices 找第一个可用文件"""
    # 1. 全局默认
    default = VOICE_DIR / "default.wav"
    if default.exists() and default.stat().st_size >= 3000:
        return default
    # 2. 遍历所有已保存的参考音频，取第一个有效文件
    try:
        if VOICE_DIR.exists():
            for wav in sorted(VOICE_DIR.rglob("*.wav")):
                if wav.name == "default.wav":
                    continue  # 前面已检查
                if wav.stat().st_size >= 3000:
                    return wav
    except OSError:
        pass
    return None


def decode_base64_ref(b64: str) -> Path | None:
    """base64 WAV → 临时文件，返回路径"""
    import tempfile
    try:
        clean = b64.replace("data:audio/wav;base64,", "").replace(
            "data:audio/wave;base64,", "")
        raw = base64.b64decode(clean)
        if len(raw) < 3000:
            return None
        tmp = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
        tmp.write(raw)
        tmp.close()
        return Path(tmp.name)
    except Exception as e:
        log.warning(f"base64 解码失败: {e}")
        return None


def prepare_ref_audio(audio_path: Path) -> tuple[Path, float, bool]:
    """
    确保参考音频在 GPT-SoVITS 的 3~10 秒范围内。
    - < 3s: 报错
    - 3~10s: 直接使用
    - > 10s: 自动裁剪到中间 8 秒（中间段音色最稳定）

    返回 (路径, 时长秒, 是否裁剪过)
    """
    audio, sr = soundfile.read(str(audio_path))
    duration = len(audio) / sr

    if duration < 3.0:
        raise ValueError(f"参考音频仅 {duration:.1f}s，需要至少 3 秒。请上传更长的语音片段。")

    if duration <= 10.0:
        return audio_path, duration, False

    # > 10s：取中间 8 秒
    target_dur = 8.0
    start = int((duration - target_dur) / 2 * sr)
    end = start + int(target_dur * sr)
    trimmed = audio[start:end]

    tmp = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
    soundfile.write(str(tmp.name), trimmed, sr)
    tmp.close()

    log.info(f"参考音频 {duration:.1f}s → 裁剪到 {target_dur}s（中间段）")
    return Path(tmp.name), target_dur, True


# ============================================================
# 音频编码
# ============================================================

def encode_audio(waveform: np.ndarray, sample_rate: int) -> str:
    import wave
    wf = np.asarray(waveform).flatten().astype(np.float32)
    mx = np.max(np.abs(wf))
    if mx > 1.0:
        wf = wf / mx
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(int(sample_rate))
        w.writeframes((wf * 32767).astype(np.int16).tobytes())
    return base64.b64encode(buf.getvalue()).decode("utf-8")


# ============================================================
# Endpoints
# ============================================================

@app.route("/health", methods=["GET"])
def health():
    device = dict(device=inference_runtime.device, requestedDevice=inference_runtime.requested,
                  precision='float16' if inference_runtime.is_half else 'float32',
                  fallbackReason=inference_runtime.fallback_reason) if inference_runtime else {}
    if model_error:
        return jsonify({"status": "error", "error": model_error, "modelLoaded": "", "uptimeSeconds": 0, **device})
    if model_loaded:
        return jsonify({
            "status": "ready",
            "model": loaded_model_name(),
            "modelLoaded": loaded_model_name(),
            "uptimeSeconds": int(time.time() - _server_start_time) if _server_start_time else 0,
            **device,
        })
    return jsonify({"status": "loading_model", "modelLoaded": "", "uptimeSeconds": 0})


def loaded_model_name():
    if not model_selection.active:
        return ''
    try:
        from process_ckpt import get_sovits_version_from_path_fast
        return 'gpt-sovits-' + get_sovits_version_from_path_fast(model_selection.active[1])[1]
    except (OSError, KeyError, ValueError):
        return 'gpt-sovits-custom'


@app.route("/synthesize", methods=["POST"])
@serialized_inference
def synthesize():
    global tts_pipeline, model_loaded, model_error

    if not model_loaded:
        try:
            load_model()
        except Exception as e:
            model_error = str(e)
            return jsonify({"error": str(e)}), 503

    data = request.get_json(force=True)
    try:
        selected = [data.get('gptWeights'), data.get('sovitsWeights')]
        if any(value is not None and (not isinstance(value, str) or len(value) > 2000 or '\x00' in value) for value in selected):
            raise ValueError('模型权重路径无效')
        run_inference(lambda pipeline: model_selection.apply(pipeline, *selected))
    except Exception as error:
        return jsonify({'error': f'模型加载失败：{error}'}), 400
    text = data.get("text", "").strip()
    if not text:
        return jsonify({"error": "Missing 'text' field"}), 400
    if len(text) > 10000:
        return jsonify({"error": "Dialogue exceeds 10000 characters"}), 400

    speaker = data.get("speaker", "")
    world_id = data.get("worldId", "")
    reference_audio_b64 = data.get("referenceAudio", None)
    reference_path = data.get('referencePath')
    prompt_text = data.get("promptText", None)

    # ---- 解析参考音频 ----
    ref_path = None
    ref_source = None
    tmp_files = []  # 需清理的临时文件

    # 1. 请求体 base64（优先级最高）
    if reference_audio_b64:
        tmp = decode_base64_ref(reference_audio_b64)
        if tmp:
            tmp_files.append(tmp)
            ref_path = tmp
            ref_source = "base64"
        else:
            return jsonify({'error': '参考音频无效，请重新上传有效录音或重新应用训练音色'}), 400

    if ref_path is None and reference_path:
        if not isinstance(reference_path, str) or len(reference_path) > 10000 or '\x00' in reference_path:
            return jsonify({'error': '参考音频路径无效'}), 400
        ref_path = Path(reference_path)
        if not ref_path.is_file():
            return jsonify({'error': '参考音频文件不存在，请重新选择录音或应用训练音色'}), 400
        ref_source = 'path'

    # 2. 磁盘音色档案
    if ref_path is None:
        disk = get_disk_ref_path(world_id, speaker)
        if disk:
            ref_path = disk
            ref_source = "disk"

    # 3. 无参考音频 → 尝试使用默认音色
    if ref_path is None and data.get("useDefaultVoice", False):
        ref_path = get_default_ref_path()
        if ref_path:
            ref_source = "default"
            log.info(f"[SYNTH] 使用默认音色: {ref_path}")

    # 4. 依然无参考音频 → 无法合成
    if ref_path is None:
        return jsonify({
            "error": "缺少参考音频",
            "detail": "GPT-SoVITS 需要参考音频来定义音色，请在「模型与音色」中上传参考音频，或应用已训练的音色。",
            "hint": "参考音频建议为 3–10 秒的单人干净录音；上传参考本身不会训练模型。",
        }), 400

    # 4. 自动裁剪到 3~10s 范围（GPT-SoVITS 硬限制）
    try:
        ref_path, ref_dur, was_trimmed = prepare_ref_audio(ref_path)
        if was_trimmed:
            tmp_files.append(ref_path)  # 裁剪后的临时文件需要清理
    except (ValueError, OSError, RuntimeError) as e:
        for temporary in tmp_files:
            temporary.unlink(missing_ok=True)
        return jsonify({"error": f'参考音频无法使用：{e}'}), 400

    log.info(
        f"[SYNTH] '{text[:40]}...' speaker={speaker} ref={ref_source} "
        f"dur={ref_dur:.1f}s{' trimmed' if was_trimmed else ''}"
    )

    t0 = time.time()
    try:
        def generate(pipeline):
            model_selection.apply(pipeline, *selected)
            reference_language = data.get('referenceLanguage', data.get('language', 'zh'))
            # Upstream caches text features by text only; language changes also require recomputing them.
            if pipeline.prompt_cache.get('prompt_lang') != reference_language:
                pipeline.prompt_cache['prompt_text'] = None
            gen = pipeline.run({
                "text": text,
                "text_lang": data.get("language", "zh"),
                "ref_audio_path": str(ref_path),
                "prompt_lang": reference_language,
                "prompt_text": prompt_text or "",
                "ref_text_free": not bool(prompt_text),
                "top_k": 5,
                "top_p": 1.0,
                "temperature": 1.0,
                "text_split_method": "cut5",
                "batch_size": 1,
                "speed_factor": 1.0,
                "split_bucket": True,
                "return_fragment": False,
            })
            # Consume the whole generator before returning, so fallback cannot leak partial audio.
            for chunk in gen:
                pass
            return chunk
        sr, audio_np = run_inference(generate)
        audio_np = np.asarray(audio_np).flatten().astype(np.float32)
        audio_b64 = encode_audio(audio_np, int(sr))
        duration_ms = int(len(audio_np) / sr * 1000)
        inference_ms = int((time.time() - t0) * 1000)

        log.info(f"[SYNTH] ✅ {inference_ms}ms audio={duration_ms}ms")
        return jsonify({
            "audio": audio_b64,
            "sampleRate": int(sr),
            "durationMs": duration_ms,
            "model": loaded_model_name(),
            "voiceCloned": True,
            "emotionApplied": data.get("emotion", "neutral"),
            "inferenceTimeMs": inference_ms,
            "device": inference_runtime.device,
        })

    except Exception as e:
        log.error(f"[SYNTH] ❌ {int((time.time()-t0)*1000)}ms: {e}")
        return jsonify({"error": str(e)}), 500

    finally:
        for f in tmp_files:
            try:
                os.unlink(str(f))
            except OSError:
                pass


# ============================================================
# Main
# ============================================================

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=7872)
    parser.add_argument("--lazy", action="store_true")
    parser.add_argument("--host", type=str, default="127.0.0.1")
    parser.add_argument("--device", choices=['auto', 'cpu', 'cuda', 'mps'], default=os.environ.get('MOMOI_DEVICE', 'auto'))
    args = parser.parse_args()
    os.environ['MOMOI_DEVICE'] = args.device

    log.info(f"GPT-SoVITS home: {GOVITS_HOME}")
    log.info(f"Voice profiles: {VOICE_DIR}")

    if not args.lazy:
        log.info("预加载模型...")
        try:
            load_model()
        except Exception as e:
            model_error = str(e)
            log.warning(f"预加载失败: {e}")

    _server_start_time = time.time()
    log.info(f"启动端口 {args.port}")
    # Health checks must remain responsive during synthesis; inference itself is serialized above.
    app.run(host=args.host, port=args.port, threaded=True)
