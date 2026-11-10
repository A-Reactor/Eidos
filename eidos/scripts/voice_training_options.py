"""Validated controls shared by configuration generation and worker startup."""
DEFAULTS = dict(sovitsEpochs=8, gptEpochs=15, sovitsBatchSize=1, gptBatchSize=1,
                sovitsSaveEvery=4, gptSaveEvery=5, textLearningRate=0.4, dpo=False, gptWorkers=1)


def training_options(job):
    raw = job.data.get('trainingOptions', {})
    if not isinstance(raw, dict):
        raise ValueError('训练参数格式无效')
    values = {**DEFAULTS, **raw}
    for key, minimum, maximum in [('sovitsEpochs', 1, 25), ('gptEpochs', 2, 50),
            ('sovitsBatchSize', 1, 64), ('gptBatchSize', 1, 40),
            ('sovitsSaveEvery', 1, 25), ('gptSaveEvery', 1, 50), ('gptWorkers', 1, 16)]:
        if type(values[key]) is not int or not minimum <= values[key] <= maximum:
            raise ValueError(f'{key} 须为 {minimum}–{maximum} 的整数')
    if type(values['textLearningRate']) not in (int, float) or not 0.2 <= values['textLearningRate'] <= 0.6 or type(values['dpo']) is not bool:
        raise ValueError('文本学习率比例或 DPO 参数无效')
    if values['sovitsEpochs'] % values['sovitsSaveEvery'] or values['gptEpochs'] % values['gptSaveEvery']:
        raise ValueError('保存间隔须整除训练轮数，确保最后一轮模型导出')
    return values
