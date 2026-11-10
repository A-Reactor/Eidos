import fs from 'node:fs';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import type { TrainingEnvironment } from './training-model';
const execute = promisify(execFile);
export const voiceInstallationRoot = () => path.resolve(process.env.GOVITS_HOME || path.join(process.cwd(), '..', '..', 'GPT-SoVITS'));
export const trainingDirectory = () => path.resolve(process.env.MOMOI_TRAINING_DIR || path.join(process.cwd(), '.momoi-training'));
export const trainingWorker = () => path.join(process.cwd(), 'scripts/voice-training-worker.py');
let python: Promise<string> | undefined;
export function resolveVoicePython(): Promise<string> {
  return python ??= (async () => {
    if (process.env.MOMOI_PYTHON) return process.env.MOMOI_PYTHON;
    const windows = process.platform === 'win32';
    const candidates = windows ? [path.resolve(process.cwd(), '../.venv-voice/Scripts/python.exe'), path.join(voiceInstallationRoot(), 'runtime/python.exe'), path.join(voiceInstallationRoot(), '.venv/Scripts/python.exe'),
      ...(process.env.CONDA_PREFIX ? [path.join(process.env.CONDA_PREFIX, 'python.exe')] : []), 'python', 'python3'] :
      [path.resolve(process.cwd(), '../.venv-voice/bin/python'), path.join(voiceInstallationRoot(), '.venv/bin/python'), 'python3',
        ...(process.env.CONDA_PREFIX ? [path.join(process.env.CONDA_PREFIX, 'bin/python')] : []), '/opt/anaconda3/bin/python3'];
    for (const candidate of candidates) {
      if (path.isAbsolute(candidate) && !fs.existsSync(candidate)) continue;
      try {
        const { stdout } = await execute(candidate, ['-B', '-c', "import importlib.util; print(bool(importlib.util.find_spec('torch')))"] , { timeout: 5000 });
        if (stdout.trim() === 'True') return candidate;
      } catch { /* Probe the next installed interpreter; the environment report explains missing modules. */ }
    }
    return windows ? 'python' : 'python3';
  })();
}
export async function inspectTrainingEnvironment(): Promise<TrainingEnvironment> {
  const executable = await resolveVoicePython();
  const { stdout } = await execute(executable, ['-B', trainingWorker(), 'inspect', '--root', voiceInstallationRoot()], { timeout: 10_000, maxBuffer: 256 * 1024 });
  return JSON.parse(stdout);
}
export async function launchTrainingWorker(directory: string, action: string) {
  const executable = await resolveVoicePython();
  const log = fs.openSync(path.join(directory, 'runner.log'), 'a');
  try {
    const child = spawn(executable, ['-u', '-B', trainingWorker(), action, '--directory', directory, '--root', voiceInstallationRoot()], {
      cwd: process.cwd(), detached: true, stdio: ['ignore', log, log],
      env: { ...process.env, PYTHONPATH: [voiceInstallationRoot(), path.join(voiceInstallationRoot(), 'GPT_SoVITS'), process.env.PYTHONPATH].filter(Boolean).join(path.delimiter),
        HF_HOME: path.join(trainingDirectory(), 'cache/huggingface'), MODELSCOPE_CACHE: path.join(trainingDirectory(), 'cache/modelscope'),
        NUMBA_CACHE_DIR: path.join(trainingDirectory(), 'cache/numba'), PYTHONDONTWRITEBYTECODE: '1' },
    });
    await new Promise<void>((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
    child.unref();
  } finally { fs.closeSync(log); }
}
