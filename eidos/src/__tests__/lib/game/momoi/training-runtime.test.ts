import { afterEach, expect, it, vi } from 'vitest';
const probe = vi.hoisted(() => vi.fn());
vi.mock('node:util', () => ({ promisify: () => probe }));
vi.mock('node:fs', () => ({ default: { existsSync: (filename: string) => filename.endsWith('runtime/python.exe') } }));
const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
afterEach(() => { Object.defineProperty(process, 'platform', platform); vi.unstubAllEnvs(); vi.resetModules(); probe.mockReset(); });
it('finds the Windows GPT-SoVITS bundled Python instead of looking only for Unix interpreters', async () => {
  Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
  vi.stubEnv('MOMOI_PYTHON', '');
  probe.mockResolvedValue({ stdout: 'True\n' });
  const { resolveVoicePython } = await import('@/lib/game/momoi/training-runtime');
  expect(await resolveVoicePython()).toMatch(/runtime\/python\.exe$/);
  expect(probe).toHaveBeenCalledTimes(1);
});
