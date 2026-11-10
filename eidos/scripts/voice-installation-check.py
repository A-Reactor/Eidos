#!/usr/bin/env python3
"""Read JSON models from stdin; emit exactly one JSON installation report."""
import argparse
import contextlib
import json
import sys
from voice_installation import inspect_voice_installation

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', required=True)
    args = parser.parse_args()
    data = json.load(sys.stdin)
    with contextlib.redirect_stdout(sys.stderr):
        report = inspect_voice_installation(args.root, data['models'])
    print(json.dumps(report, ensure_ascii=False))
