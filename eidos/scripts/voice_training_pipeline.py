"""Adapt official GPT-SoVITS training scripts without modifying their checkout."""
import copy
import json
import os
import time
from pathlib import Path
from voice_training_core import inspect_installation, model_paths
from voice_training_options import training_options
from voice_training_core import TrainingToolError
from voice_training_exports import complete_exports, mpi_completed, recover_exported_voice


def verified_clips(job):
    clips = [c for c in job.data['clips'] if c.get('included', True)]
    if not clips or any(not c['text'].strip() or '|' in c['text'] or '\n' in c['text'] for c in clips):
        raise ValueError('请校对所有保留片段的台词；不能留空或包含换行和竖线')
    if not any(3 <= c['duration'] <= 10 for c in clips):
        raise ValueError('至少需要一段 3–10 秒的参考音频')
    return clips


def training_configs(job, root, cuda, s2_template, s1_template):
    options = training_options(job)
    paths = model_paths(root, job.data['version'])
    run = Path(job.data.get('runDirectory', job.directory / 'run'))
    features = run / 'features'
    s2, s1 = copy.deepcopy(s2_template), copy.deepcopy(s1_template)
    s2['train'].update(batch_size=options['sovitsBatchSize'], epochs=options['sovitsEpochs'], fp16_run=cuda,
                       pretrained_s2G=str(paths['sovits']), pretrained_s2D=str(paths['discriminator']),
                       if_save_latest=True, if_save_every_weights=True,
                       save_every_epoch=options['sovitsSaveEvery'], text_low_lr_rate=options['textLearningRate'], gpu_numbers='0', grad_ckpt=False)
    s2['model']['version'] = job.data['version']
    s2['data']['exp_dir'] = str(features)
    # Upstream creates s2_ckpt_dir but saves G/D to this versioned feature subdirectory.
    s2.update(s2_ckpt_dir=str(features / f"logs_s2_{job.data['version']}"),
              save_weight_dir=str(run / 'sovits'), name='voice', version=job.data['version'])
    s1['train'].update(batch_size=options['gptBatchSize'], epochs=options['gptEpochs'], precision='16-mixed' if cuda else '32',
                       save_every_n_epoch=options['gptSaveEvery'], if_save_latest=True,
                       if_save_every_weights=True, if_dpo=options['dpo'], half_weights_save_dir=str(run / 'gpt'), exp_name='voice')
    # Upstream always enables persistent workers/prefetching, which rejects zero workers.
    s1['data']['num_workers'] = options['gptWorkers']
    s1.update(pretrained_s1=str(paths['gpt']), train_semantic_path=str(features / '6-name2semantic.tsv'),
              train_phoneme_path=str(features / '2-name2text.txt'), output_dir=str(run / 'gpt-checkpoints'))
    return s2, s1


def merged(source, target, header=''):
    lines = source.read_text(encoding='utf-8').strip().splitlines()
    if not lines:
        raise RuntimeError(f'官方特征提取没有输出：{source.name}，请检查日志与素材')
    target.write_text(header + '\n'.join(lines) + '\n', encoding='utf-8')


def train(job, root):
    import yaml
    import torch
    root = Path(root)
    clips = verified_clips(job)
    options = training_options(job)
    report = inspect_installation(root)
    version = next(v for v in report['versions'] if v['id'] == job.data['version'])
    if not version['ready']:
        raise ValueError('训练环境不完整：' + '、'.join(report['missingModules'] + version['missing']))
    run = job.directory / f'run-{time.time_ns()}'
    features = run / 'features'
    features.mkdir(parents=True)
    job.update(status='training', stage='提取文本特征', runDirectory=str(run), error='', epoch=0)
    labels = run / 'train.list'
    labels.write_text('\n'.join(f"{job.directory / 'clips' / c['file']}|voice|{job.data['language']}|{c['text'].strip()}" for c in clips), encoding='utf-8')
    cuda = torch.cuda.is_available()
    template = 's2.json' if job.data['version'] == 'v2' else 's2v2ProPlus.json'
    s2, s1 = training_configs(job, root, cuda,
        json.loads((root / 'GPT_SoVITS/configs' / template).read_text()),
        yaml.safe_load((root / 'GPT_SoVITS/configs/s1longer-v2.yaml').read_text()))
    s2_file, s1_file = run / 's2.json', run / 's1.yaml'
    s2_file.write_text(json.dumps(s2), encoding='utf-8')
    s1_file.write_text(yaml.safe_dump(s1), encoding='utf-8')
    # Semantic extraction supplies version explicitly; the trainer reads it from model.
    semantic_config = copy.deepcopy(s2)
    semantic_config['model'].pop('version', None)
    semantic_file = run / 'semantic.json'
    semantic_file.write_text(json.dumps(semantic_config), encoding='utf-8')
    # Official exporters write directly into these paths without creating them.
    Path(s2['save_weight_dir']).mkdir(parents=True)
    Path(s1['train']['half_weights_save_dir']).mkdir(parents=True)
    models = root / 'GPT_SoVITS/pretrained_models'
    paths = model_paths(root, job.data['version'])
    env = {**os.environ, 'version': job.data['version'], 'inp_text': str(labels),
           'inp_wav_dir': str(job.directory / 'clips'), 'exp_name': 'voice', 'opt_dir': str(features),
           'i_part': '0', 'all_parts': '1', '_CUDA_VISIBLE_DEVICES': '0', 'is_half': str(cuda),
           'bert_pretrained_dir': str(models / 'chinese-roberta-wwm-ext-large'),
           'cnhubert_base_dir': str(models / 'chinese-hubert-base'),
           'pretrained_s2G': str(paths['sovits']), 's2config_path': str(semantic_file),
           'sv_path': str(paths.get('sv', '')), 'USE_LIBUV': '0',
           'NUMBA_CACHE_DIR': str(run / 'numba-cache'),
           'PYTHONPATH': os.pathsep.join([str(Path(__file__).parent / 'voice_runtime'), str(root), str(root / 'GPT_SoVITS'), os.environ.get('PYTHONPATH', '')])}
    def official(script, args=()):
        gpt = script.endswith('s1_train.py')
        job.run([os.sys.executable, '-u', '-B', root / script, *args], cwd=root,
                env={**env, 'EIDOS_VOICE_PCM_IO': '1' if script.endswith('2-get-sv.py') else '0',
                     'EIDOS_GPT_PROGRESS': str(run / 'gpt-progress.json') if gpt else '',
                     'EIDOS_STAGE_STARTED_AT': str(job.data.get('stageStartedAt', int(time.time() * 1000)))})
    official('GPT_SoVITS/prepare_datasets/1-get-text.py')
    merged(features / '2-name2text-0.txt', features / '2-name2text.txt')
    job.update(stage='提取语音特征')
    official('GPT_SoVITS/prepare_datasets/2-get-hubert-wav32k.py')
    if job.data['version'] == 'v2ProPlus':
        official('GPT_SoVITS/prepare_datasets/2-get-sv.py')
    job.update(stage='提取语义特征')
    official('GPT_SoVITS/prepare_datasets/3-get-semantic.py')
    merged(features / '6-name2semantic-0.tsv', features / '6-name2semantic.tsv', 'item_name\tsemantic_audio\n')
    # Some upstream tools swallow per-file failures: require every reviewed clip's features.
    expected = {c['file'] for c in clips}
    actual = {line.split('\t')[0] for line in (features / '6-name2semantic.tsv').read_text().splitlines()[1:]}
    if expected - actual:
        raise RuntimeError('部分音频未提取到语义特征，请检查日志；不会使用不完整数据训练')
    job.update(stage='训练 SoVITS', epoch=0, epochTotal=options['sovitsEpochs'])
    official('GPT_SoVITS/s2_train.py', ['--config', str(s2_file)])
    job.update(stage='训练 GPT', epoch=0, epochTotal=options['gptEpochs'])
    try:
        official('GPT_SoVITS/s1_train.py', ['--config_file', str(s1_file)])
    except TrainingToolError as error:
        if not mpi_completed(error.output, options['gptEpochs']):
            raise
        recover_exported_voice(job, error.output)
        return
    complete_exports(job)
