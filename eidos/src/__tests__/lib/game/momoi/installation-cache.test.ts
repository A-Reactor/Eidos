// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { checkVoiceInstallation, clearVoiceInstallationCache } from '@/lib/game/momoi/installation-client';
const report = { checks: [], languageResources: [{ id: 'ja', ready: true }], models: [{ languages: ['ja'], ready: true }] };
const input = { provider: 'legacy' as const, endpoint: '', models: [{ gptWeights: '/a.ckpt', sovitsWeights: '/a.pth' }] };
const signal = () => new AbortController().signal;
afterEach(() => { clearVoiceInstallationCache(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
it('reuses a recent generation check, separates weight pairs, and lets manual inspection force freshness', async () => {
  const fetcher = vi.fn(async () => Response.json(report)); vi.stubGlobal('fetch', fetcher);
  await checkVoiceInstallation(input, signal(), { maxAgeMs: 30_000 });
  await checkVoiceInstallation(input, signal(), { maxAgeMs: 30_000 });
  expect(fetcher).toHaveBeenCalledTimes(1);
  await checkVoiceInstallation({ ...input, models: [{ gptWeights: '/b.ckpt', sovitsWeights: '/b.pth' }] }, signal(), { maxAgeMs: 30_000 });
  expect(fetcher).toHaveBeenCalledTimes(2);
  await checkVoiceInstallation(input, signal()); expect(fetcher).toHaveBeenCalledTimes(3);
  const now = Date.now(); vi.spyOn(Date, 'now').mockReturnValue(now + 31_000);
  await checkVoiceInstallation(input, signal(), { maxAgeMs: 30_000 }); expect(fetcher).toHaveBeenCalledTimes(4);
});
it('never retains failures or canceled reports, and canceled cache hits do not proceed', async () => {
  const controller = new AbortController();
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ error: '检查失败' }, { status: 500 }))
    .mockImplementationOnce(async () => { controller.abort(); return Response.json(report); })
    .mockImplementation(async () => Response.json(report));
  vi.stubGlobal('fetch', fetcher);
  await expect(checkVoiceInstallation(input, signal(), { maxAgeMs: 30_000 })).rejects.toThrow('检查失败');
  await expect(checkVoiceInstallation(input, controller.signal, { maxAgeMs: 30_000 })).rejects.toThrow();
  await checkVoiceInstallation(input, signal(), { maxAgeMs: 30_000 });
  expect(fetcher).toHaveBeenCalledTimes(3);
  await expect(checkVoiceInstallation(input, AbortSignal.abort(), { maxAgeMs: 30_000 })).rejects.toThrow();
  expect(fetcher).toHaveBeenCalledTimes(3);
});
