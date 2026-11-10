#!/usr/bin/env python3
"""Fetch author-published ProPlus weights, verifying their published LFS SHA256."""
import hashlib
import json
import shutil
import subprocess
import sys
from pathlib import Path

FILES = ('s1v3.ckpt', 'v2Pro/s2Gv2ProPlus.pth', 'v2Pro/s2Dv2ProPlus.pth',
         'sv/pretrained_eres2netv2w24s4ep4.ckpt')


def digest(path):
    with path.open('rb') as source:
        return hashlib.file_digest(source, 'sha256').hexdigest()


def main():
    root = Path(sys.argv[1]).resolve()
    destination = root / 'GPT_SoVITS/pretrained_models'
    metadata = subprocess.check_output(['curl', '-fsSL', '--retry', '3',
        'https://huggingface.co/api/models/lj1995/GPT-SoVITS/tree/main?recursive=true&limit=1000'])
    entries = {entry['path']: entry for entry in json.loads(metadata)}
    for name in FILES:
        entry = entries[name]
        sha, size = entry['lfs']['oid'], entry['size']
        target = destination / name
        target.parent.mkdir(parents=True, exist_ok=True)
        if target.is_file() and target.stat().st_size == size and digest(target) == sha:
            print(f'已验证 {name}', flush=True)
            continue
        flat = destination / Path(name).name
        partial = target.with_suffix(target.suffix + '.download')
        if flat != target and flat.is_file() and flat.stat().st_size == size and digest(flat) == sha:
            shutil.copyfile(flat, partial)
        else:
            print(f'下载 {name} ({size / 1024**2:.1f} MiB)', flush=True)
            subprocess.run(['curl', '-fL', '--retry', '3', '--connect-timeout', '30',
                '--max-time', '1800', '-o', str(partial),
                f'https://huggingface.co/lj1995/GPT-SoVITS/resolve/main/{name}'], check=True)
        if partial.stat().st_size != size or digest(partial) != sha:
            raise RuntimeError(f'{name} 校验失败，保留 .download 便于检查；不会替换正式文件')
        partial.replace(target)
        print(f'已安装并校验 {name}: {sha}', flush=True)


if __name__ == '__main__':
    main()
