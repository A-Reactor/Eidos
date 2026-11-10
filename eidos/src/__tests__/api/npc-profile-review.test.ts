import { afterEach, expect, it, vi } from 'vitest';
import { POST } from '@/app/api/game/npc/profile/route';
const material = { proposal: { npcName: '蓝色鱼', description: '保留来历，补充喜欢软白饭的习惯。', reason: '管理员明确要求补充设定' },
  playerInput: '搜索资料补充蓝色鱼的人设，并提交给KEI审核', worldId: 'test-world', worldName: '测试世界', worldOverview: '管理员测试',
  currentDescription: '一条会说话的鱼。', sources: [{ label: '资料', url: 'https://example.com/profile' }],
  _settings: { keiProviderId: 'deepseek', keiApiKey: 'fixture-key', keiEndpoint: 'https://api.deepseek.com/v1', keiModel: 'kei-review-fixture' } };
const request = (body: unknown, origin?: string) => new Request('http://localhost/api/game/npc/profile', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(origin ? { origin } : {}) }, body: JSON.stringify(body) });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it.each([true, false])('uses the actual KEI adapter and returns its structured approval=%s without applying any profile', async approved => {
  const fetcher = vi.fn().mockResolvedValue(Response.json({ choices: [{ message: { content: JSON.stringify({ approved, reason: approved ? '符合明确改编要求' : '需保留原有身份信息' }) }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 } }));
  vi.stubGlobal('fetch', fetcher);
  const response = await POST(request(material)), result = await response.json();
  expect(response.status).toBe(200);
  expect(result.approved).toBe(approved);
  expect(result.usage.totalTokens).toBe(120);
  expect(result).not.toHaveProperty('operationId');
  const sent = JSON.parse(fetcher.mock.calls[0][1].body);
  expect(sent.model).toBe('kei-review-fixture');
  expect(sent.messages.at(-1).content).toContain(material.playerInput);
  expect(sent.messages.at(-1).content).toContain(material.currentDescription);
  expect(sent.messages.at(-1).content).toContain('https://example.com/profile');
});
it.each(['{"approved":"true","reason":"口头通过"}', '已通过，无法提供JSON'])('rejects a malformed model approval and retains billed usage: %s', async content => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ choices: [{ message: { content } }], usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 } })));
  const result = await (await POST(request(material))).json();
  expect(result.approved).toBe(false);
  expect(result.usage.totalTokens).toBe(120);
});
it('rejects incomplete proposals and cross-site requests before calling a provider', async () => {
  const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
  expect((await POST(request({ ...material, proposal: { ...material.proposal, speechProfile: { baseline: '不完整' } } }))).status).toBe(400);
  expect((await POST(request(material, 'https://unrelated.example'))).status).toBe(403);
  expect(fetcher).not.toHaveBeenCalled();
});
it('returns an actionable failure when KEI is unreachable instead of reporting that editing succeeded', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('fixture provider unavailable')));
  const response = await POST(request(material)), result = await response.json();
  expect(response.status).toBe(502);
  expect(result.approved).toBe(false);
  expect(result.reason).toContain('fixture provider unavailable');
});
