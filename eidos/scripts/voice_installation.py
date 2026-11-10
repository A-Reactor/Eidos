"""Read-only installation and checkpoint-language inspection for the game UI."""
import importlib.util
import io
import os
import shutil
import sys
from pathlib import Path


class CheckpointMetadata(dict):
    def __setstate__(self, state):
        self.update(state)


def weight_languages(gpt, sovits):
    try:
        gpt_size = gpt['weight']['model.ar_text_embedding.word_embeddings.weight'].shape[0]
        embedding = sovits['weight'].get('enc_p.text_embedding.weight')
        lora_version = sovits.get('_header_version') if sovits.get('lora_rank', 0) else None
        sovits_size = embedding.shape[0] if embedding is not None else 732 if lora_version in ('v3', 'v4') else None
    except (KeyError, TypeError, AttributeError) as error:
        raise ValueError('权重缺少可识别的语言嵌入，无法确认支持语言') from error
    if gpt_size != sovits_size or sovits_size not in (322, 732):
        raise ValueError('GPT 与 SoVITS 的语言嵌入不匹配或版本未知')
    version = 'v1' if sovits_size == 322 else sovits.get('_header_version') or sovits.get('config', {}).get('model', {}).get('version', 'v2')
    return dict(version=version, languages=['zh', 'ja', 'en'] + (['yue', 'ko'] if sovits_size == 732 else []))


def load_checkpoint(torch, filename):
    # Treat upstream HParams as inert data; checking installation must not execute pickle code.
    safe = [(CheckpointMetadata, 'utils.HParams')]
    with filename.open('rb') as source:
        prefix = source.read(2)
        if prefix in (b'00', b'01', b'02', b'03', b'04', b'05', b'06'):
            # Official Pro/LoRA exports replace the ZIP magic with a version tag.
            with torch.serialization.safe_globals(safe):
                data = torch.load(io.BytesIO(b'PK' + source.read()), map_location='cpu', weights_only=True)
            data['_header_version'] = {b'00': 'v1', b'01': 'v2', b'02': 'v3', b'03': 'v3', b'04': 'v4', b'05': 'v2Pro', b'06': 'v2ProPlus'}[prefix]
            return data
    with torch.serialization.safe_globals(safe):
        return torch.load(filename, map_location='cpu', weights_only=True, mmap=True)


def inspect_voice_installation(root, models):
    root = Path(root).resolve()
    checks = []
    def check(label, ready, detail):
        checks.append(dict(label=label, ready=bool(ready), detail=detail))
    check('Python', True, sys.executable)
    check('GPT-SoVITS', (root / 'GPT_SoVITS/TTS_infer_pack/TTS.py').is_file(), str(root))
    check('FFmpeg', shutil.which('ffmpeg'), shutil.which('ffmpeg') or '请安装 FFmpeg 并加入 PATH')
    modules = ['torch', 'numpy', 'scipy', 'librosa', 'soundfile', 'transformers', 'peft', 'pytorch_lightning', 'flask']
    missing = [name for name in modules if importlib.util.find_spec(name) is None]
    check('推理依赖', not missing, '依赖已安装' if not missing else '缺少：' + '、'.join(missing))
    from voice_training_core import inspect_installation
    training = inspect_installation(root)
    check('训练依赖', not training['missingModules'], '依赖已安装' if not training['missingModules'] else '缺少：' + '、'.join(training['missingModules']))
    for version in training['versions']:
        check(f"{version['id']} 训练文件（可选）", not version['missing'], '文件齐全' if not version['missing'] else '缺少：' + '、'.join(version['missing']))
    asr_missing = [name for name, installed in training['asr'].items() if not installed]
    check('自动转写组件', not asr_missing, '组件已安装；首次转写仍可能下载资源' if not asr_missing else '缺少：' + '、'.join(asr_missing))
    base = root / 'GPT_SoVITS/pretrained_models'
    for label, filename in [('中文 BERT', base / 'chinese-roberta-wwm-ext-large/pytorch_model.bin'),
                            ('HuBERT', base / 'chinese-hubert-base/pytorch_model.bin')]:
        if not filename.is_file() and filename.with_name('model.safetensors').is_file():
            filename = filename.with_name('model.safetensors')
        check(label, filename.is_file(), str(filename))
    language_modules = dict(zh=['pypinyin', 'cn2an', 'onnxruntime'], ja=['pyopenjtalk'], en=['g2p_en'],
                            yue=['ToJyutping', 'cn2an'], ko=['jamo', 'ko_pron', 'g2pk2'])
    languages = []
    for language, required in language_modules.items():
        absent = [name for name in required if importlib.util.find_spec(name) is None]
        if language == 'zh' and not (root / 'GPT_SoVITS/text/G2PWModel/g2pW.onnx').is_file():
            absent.append('G2PW 模型')
        if language == 'ja' and not absent:
            import pyopenjtalk
            dictionary = getattr(pyopenjtalk, 'OPEN_JTALK_DICT_DIR', b'')
            if isinstance(dictionary, bytes):
                dictionary = os.fsdecode(dictionary)
            if not dictionary or not (Path(dictionary) / 'sys.dic').is_file():
                absent.append('OpenJTalk 词典')
        if language == 'en' and not absent:
            import nltk
            for resource in ('corpora/cmudict', 'taggers/averaged_perceptron_tagger_eng'):
                try:
                    nltk.data.find(resource)
                except LookupError:
                    absent.append(resource)
        languages.append(dict(id=language, ready=not absent, detail='资源已安装' if not absent else '缺少：' + '、'.join(absent)))
    torch = None
    try:
        import torch
        gpu = 'cuda' if torch.cuda.is_available() else 'mps' if torch.backends.mps.is_available() else 'cpu'
        check('可用推理设备', True, gpu.upper())
    except ImportError:
        check('可用推理设备', False, '安装 PyTorch 后可检查 GPU')
    default_gpt = base / 'gsv-v2final-pretrained/s1bert25hz-5kh-longer-epoch=12-step=369668.ckpt'
    default_sovits = base / 'gsv-v2final-pretrained/s2G2333k.pth'
    results = []
    for model in models:
        try:
            if torch is None:
                raise ValueError('缺少 PyTorch，无法检查权重')
            gpt = Path(model.get('gptWeights') or os.environ.get('GOVITS_GPT_MODEL') or default_gpt)
            sovits = Path(model.get('sovitsWeights') or os.environ.get('GOVITS_SOVITS_MODEL') or default_sovits)
            gpt = gpt if gpt.is_absolute() else root / gpt
            sovits = sovits if sovits.is_absolute() else root / sovits
            sovits_data = load_checkpoint(torch, sovits)
            metadata = weight_languages(load_checkpoint(torch, gpt), sovits_data)
            extra = []
            if sovits_data.get('lora_rank'):
                parent = base / ('s2Gv3.pth' if metadata['version'] == 'v3' else 'gsv-v4-pretrained/s2Gv4.pth')
                if not parent.is_file():
                    extra.append(f'LoRA 底模 {parent.name}')
            del sovits_data
            if str(metadata['version']) in ('v2Pro', 'v2ProPlus') and not (base / 'sv/pretrained_eres2netv2w24s4ep4.ckpt').is_file():
                extra.append('Pro 声纹模型')
            ready = not extra and all(item['ready'] for item in checks if item['label'] in ('GPT-SoVITS', 'FFmpeg', '推理依赖', '中文 BERT', 'HuBERT'))
            results.append(dict(**metadata, ready=ready, error='缺少：' + '、'.join(extra) if extra else ''))
        except Exception as error:
            results.append(dict(languages=[], ready=False, error=str(error)))
    return dict(checks=checks, languageResources=languages, models=results)
