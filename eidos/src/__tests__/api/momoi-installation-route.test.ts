import { beforeEach, expect, it, vi } from 'vitest';
const inspect = vi.hoisted(() => vi.fn());
vi.mock('@/lib/game/momoi/installation-server', () => ({ inspectVoiceInstallation: inspect }));
import { POST } from '@/app/api/momoi/installation/route';
const send = (body: unknown, headers = {}) => POST(new Request('http://localhost/api/momoi/installation', { method: 'POST', body: JSON.stringify(body), headers }));
beforeEach(() => { inspect.mockReset(); });
it('checks explicitly selected weights without accepting unrelated settings or cross-site requests', async () => {
  inspect.mockResolvedValue({ checks: [], languageResources: [], models: [{ languages: ['zh', 'ja'], ready: true }] });
  expect((await send({ provider: 'legacy', models: [{ gptWeights: '/g.ckpt', sovitsWeights: '/s.pth' }] })).status).toBe(200);
  expect(inspect.mock.calls[0][0]).toEqual([{ gptWeights: '/g.ckpt', sovitsWeights: '/s.pth' }]);
  inspect.mockClear();
  expect((await send({ provider: 'legacy', models: [{}] }, { origin: 'https://foreign.test' })).status).toBe(403);
  expect((await send({ provider: 'legacy', models: [{ gptWeights: '/g.ckpt' }] })).status).toBe(400);
  expect((await send({ provider: 'legacy', models: [{}], apiKey: 'secret' })).status).toBe(400);
  expect(inspect).not.toHaveBeenCalled();
});
it('reports unverifiable remote services instead of guessing supported languages', async () => {
  const response = await send({ provider: 'gpt-sovits', endpoint: 'https://voice.example', models: [{ gptWeights: '/g.ckpt', sovitsWeights: '/s.pth' }] });
  const report = await response.json();
  expect(report.models[0]).toMatchObject({ ready: false, languages: [] });
  expect(report.models[0].error).toContain('远程');
  expect(inspect).not.toHaveBeenCalled();
});
it('limits concurrent inspection processes and releases the slot after errors', async () => {
  let finish!: (value: unknown) => void;
  inspect.mockReturnValue(new Promise(resolve => { finish = resolve; }));
  const first = send({ provider: 'legacy', models: [{}] });
  const second = send({ provider: 'legacy', models: [{}] });
  await vi.waitFor(() => expect(inspect).toHaveBeenCalledTimes(2));
  expect((await send({ provider: 'legacy', models: [{}] })).status).toBe(429);
  finish({ checks: [], languageResources: [], models: [] });
  await Promise.all([first, second]);
  inspect.mockRejectedValue(new Error('Python missing'));
  const report = await (await send({ provider: 'legacy', models: [{}] })).json();
  expect(report.checks[0]).toMatchObject({ ready: false, detail: 'Python missing' });
});
