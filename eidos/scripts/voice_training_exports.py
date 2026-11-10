"""Register exported voice pairs; recover only a proven post-training MPI teardown failure."""
import re
from pathlib import Path
from voice_training_options import training_options


def owned_run(job):
    run = Path(job.data['runDirectory']).resolve()
    if run.parent != job.directory.resolve() or not re.fullmatch(r'run(?:-\d+)?', run.name):
        raise ValueError('训练输出目录无效，不能核验外部模型')
    return run


def mpi_completed(output, epochs):
    matches = re.findall(r'Trainer\.fit.*stopped:.*max_epochs=(\d+).*reached', output.replace('`', ''))
    return bool(matches and int(matches[-1]) == epochs and 'MPI_Finalize' in output and 'internal_Finalize' in output
                and 'Traceback (most recent call last)' not in output)


def validate_final_pair(job, gpt, sovits):
    import torch
    from voice_installation import load_checkpoint, weight_languages
    options = training_options(job)
    gpt_data, sovits_data = load_checkpoint(torch, gpt), load_checkpoint(torch, sovits)
    if gpt_data.get('info') != f"GPT-e{options['gptEpochs']}" or not str(sovits_data.get('info', '')).startswith(f"{options['sovitsEpochs']}epoch_"):
        raise ValueError('未找到目标轮数的最终模型，不能恢复成品')
    metadata = weight_languages(gpt_data, sovits_data)
    if metadata['version'] != job.data['version']:
        raise ValueError('导出权重版本与训练任务不匹配')


def complete_exports(job, strict=False, warning=''):
    run = owned_run(job)
    def exports(kind, pattern):
        return sorted((run / kind).glob(pattern), key=lambda p: p.stat().st_mtime)
    gpt, sovits = exports('gpt', '*.ckpt'), exports('sovits', '*.pth')
    if not gpt or not sovits or min(gpt[-1].stat().st_size, sovits[-1].stat().st_size) < 1024:
        raise ValueError('未找到完整的 GPT / SoVITS 导出权重，请检查日志')
    if strict:
        validate_final_pair(job, gpt[-1], sovits[-1])
    clips = [c for c in job.data['clips'] if c.get('included', True)]
    reference = next(c for c in clips if 3 <= c['duration'] <= 10 and c['text'].strip())
    reference_path = job.directory / 'clips' / reference['file']
    if strict and (not reference_path.is_file() or reference_path.stat().st_size < 44):
        raise ValueError('参考录音已丢失，不能恢复成品')
    def checkpoint(path):
        match = re.search(r'[-_]e(\d+)', path.stem)
        return dict(name=path.name, path=str(path), epoch=int(match[1]) if match else None)
    options = training_options(job)
    job.update(status='complete', stage='训练完成', error='', warning=warning, epoch=options['gptEpochs'],
               gptElapsedSeconds=max(0, int(gpt[-1].stat().st_mtime - sovits[-1].stat().st_mtime)),
               checkpoints=dict(gpt=[checkpoint(p) for p in gpt], sovits=[checkpoint(p) for p in sovits]),
               result=dict(gptWeights=str(gpt[-1]), sovitsWeights=str(sovits[-1]), referencePath=str(reference_path),
                           referenceText=reference['text'], referenceId=reference['id']))


def recover_exported_voice(job, output=None):
    owned_run(job)
    job.check()
    if output is None:
        raw = (job.directory / 'worker.log').read_text(encoding='utf-8', errors='replace')
        output = raw.rsplit('\n> ', 1)[-1]
    if not mpi_completed(output, training_options(job)['gptEpochs']):
        raise ValueError('不能核验为训练完成后的 MPI 清理异常，请查看日志；未更改成品状态')
    complete_exports(job, strict=True, warning='训练与导出已完成，但环境在 MPI 退出清理时报错；最终权重已核验，可试听使用。')
