#!/usr/bin/env python3
"""Populate Chinese/Japanese preprocessing and ASR caches, then smoke-test them."""
import argparse
import json
import os
import sys
from pathlib import Path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', required=True)
    parser.add_argument('--cache', required=True)
    args = parser.parse_args()
    root, cache = Path(args.root).resolve(), Path(args.cache).resolve()
    cache.mkdir(parents=True, exist_ok=True)
    os.environ['HF_HOME'] = str(cache / 'huggingface')
    os.environ['MODELSCOPE_CACHE'] = str(cache / 'modelscope')
    os.environ['HF_HUB_DISABLE_PROGRESS_BARS'] = '1'
    os.environ['TOKENIZERS_PARALLELISM'] = 'false'
    os.chdir(root)
    sys.path[:0] = [str(root / 'GPT_SoVITS'), str(root)]
    from text.cleaner import clean_text
    report = {}
    for lang, sentence in [('zh', '今天我们一起去银行，看看这个世界。'), ('ja', 'こんにちは。一緒に物語の続きを始めましょう。')]:
        phones, _, normalized = clean_text(sentence, lang, 'v2ProPlus')
        if not phones:
            raise RuntimeError(f'{lang} 未生成音素')
        report[lang] = dict(phonemes=len(phones), normalized=normalized)
        print(f'{lang} 文本预处理通过：{len(phones)} 音素', flush=True)
    import numpy as np
    from funasr import AutoModel
    print('下载/加载中文 Paraformer、VAD、标点模型…', flush=True)
    chinese = AutoModel(model='paraformer-zh', vad_model='fsmn-vad', punc_model='ct-punc', device='cpu', disable_update=True)
    chinese.generate(input=np.zeros(32000, dtype=np.float32))
    report['chineseASR'] = 'loaded and silence inference passed'
    del chinese
    from faster_whisper import WhisperModel
    print('下载/加载日文多语言 Whisper small…', flush=True)
    japanese = WhisperModel('small', device='cpu', compute_type='int8', download_root=str(cache / 'whisper'))
    segments, _ = japanese.transcribe(np.zeros(32000, dtype=np.float32), language='ja', beam_size=1)
    list(segments)
    report['japaneseASR'] = 'loaded and silence inference passed'
    (cache / 'languages-verified.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(report, ensure_ascii=False), flush=True)


if __name__ == '__main__':
    main()
