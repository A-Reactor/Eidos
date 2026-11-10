export interface TrainingOptions {
  sovitsEpochs: number; gptEpochs: number;
  sovitsBatchSize: number; gptBatchSize: number;
  sovitsSaveEvery: number; gptSaveEvery: number;
  textLearningRate: number; dpo: boolean;
  gptWorkers: number;
}
export const DEFAULT_TRAINING_OPTIONS: TrainingOptions = {
  sovitsEpochs: 8, gptEpochs: 15, sovitsBatchSize: 1, gptBatchSize: 1,
  sovitsSaveEvery: 4, gptSaveEvery: 5, textLearningRate: 0.4, dpo: false, gptWorkers: 1,
};
export function trainingOptions(value?: unknown): TrainingOptions {
  if (value !== undefined && (!value || typeof value !== 'object' || Array.isArray(value))) throw new Error('训练参数格式无效');
  const options = { ...DEFAULT_TRAINING_OPTIONS, ...value as Partial<TrainingOptions> };
  for (const [key, min, max] of [
    ['sovitsEpochs', 1, 25], ['gptEpochs', 2, 50], ['sovitsBatchSize', 1, 64],
    ['gptBatchSize', 1, 40], ['sovitsSaveEvery', 1, 25], ['gptSaveEvery', 1, 50],
    ['gptWorkers', 1, 16],
  ] as const) {
    if (!Number.isInteger(options[key]) || options[key] < min || options[key] > max) throw new Error(`${key} 须为 ${min}–${max} 的整数`);
  }
  if (typeof options.textLearningRate !== 'number' || !Number.isFinite(options.textLearningRate) || options.textLearningRate < 0.2 || options.textLearningRate > 0.6 || typeof options.dpo !== 'boolean') throw new Error('文本学习率比例须为 0.2–0.6，DPO 须为开关值');
  if (options.sovitsEpochs % options.sovitsSaveEvery || options.gptEpochs % options.gptSaveEvery) throw new Error('保存间隔须整除对应训练轮数，确保导出最后一轮模型');
  return options;
}
