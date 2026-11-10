#!/usr/bin/env python3
"""Persistent local training worker; invoked by the Next server, never a shell."""
import argparse
import json
import os
import signal
import sys
from pathlib import Path
from voice_training_core import Job, inspect_installation, prepare, transcribe


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=['inspect', 'prepare', 'train', 'asr', 'recover'])
    parser.add_argument('--root', required=True)
    parser.add_argument('--directory')
    args = parser.parse_args()
    if args.action == 'inspect':
        print(json.dumps(inspect_installation(args.root), ensure_ascii=False))
        return
    job = Job(args.directory)
    if args.action == 'asr':
        transcribe(job)
        return
    def stop(_signal, _frame):
        (job.directory / 'cancel').touch()
        raise InterruptedError('任务已取消')
    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    try:
        if args.action == 'prepare':
            prepare(job, args.root)
        elif args.action == 'recover':
            from voice_training_exports import recover_exported_voice
            recover_exported_voice(job)
        else:
            from voice_training_pipeline import train
            train(job, args.root)
    except InterruptedError as error:
        job.update(status='cancelled', stage='已取消', error=str(error))
    except Exception as error:
        import traceback
        traceback.print_exc()
        job.update(status='failed', error=str(error))
        sys.exit(1)
    finally:
        lock = job.directory.parent / 'active.json'
        try:
            if json.loads(lock.read_text()).get('id') == job.data['id']:
                lock.unlink()
        except FileNotFoundError:
            pass


if __name__ == '__main__':
    main()
