import { execFile } from 'node:child_process';
import path from 'node:path';
import { resolveVoicePython, voiceInstallationRoot, trainingDirectory } from './training-runtime';
import type { VoiceInstallation } from './languages';
export async function inspectVoiceInstallation(models: { gptWeights?: string; sovitsWeights?: string }[], signal: AbortSignal): Promise<VoiceInstallation> {
  const python = await resolveVoicePython();
  return new Promise((resolve, reject) => {
    const child = execFile(python, ['-B', path.join(process.cwd(), 'scripts/voice-installation-check.py'), '--root', voiceInstallationRoot()],
      { signal, timeout: 30_000, maxBuffer: 512 * 1024, env: { ...process.env, NUMBA_CACHE_DIR: path.join(trainingDirectory(), 'cache/numba') } },
      (error, stdout, stderr) => {
        if (error) { reject(new Error(`安装检查失败：${stderr.slice(-1000) || error.message}`)); return; }
        try { resolve(JSON.parse(stdout)); } catch { reject(new Error('安装检查程序返回了无效报告')); }
      });
    child.stdin?.end(JSON.stringify({ models }));
  });
}
