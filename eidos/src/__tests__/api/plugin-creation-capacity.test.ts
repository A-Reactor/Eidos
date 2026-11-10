import { afterEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { buildRiftCityStartState } from '@/lib/test/fixtures';
vi.mock('@/lib/ai/world-generator', () => ({ generateWorldConversation: vi.fn() }));
import { generateWorldConversation } from '@/lib/ai/world-generator';
import { POST } from '@/app/api/world/create/route';
afterEach(() => vi.resetAllMocks());
it('creates a world with a plugin exceeding the old HTTP request limit and retains its full local source', async () => {
  vi.mocked(generateWorldConversation).mockResolvedValue(buildRiftCityStartState().world);
  const html = '<main>' + 'x'.repeat(2500000) + '</main>';
  const plugin = { format: 'eidos-gameplay-plugin', version: 1, id: 'large-plugin', name: '大型插件', description: '完整界面', tags: [], prompts: { creation: '', action: '', review: '' }, ui: { reading: 'replace', html } };
  const request = new NextRequest('http://localhost/api/world/create', { method: 'POST', body: JSON.stringify({ concept: '一个需要大型交互舞台的世界', skillIds: ['large-plugin'], gameplayPlugins: [plugin] }) });
  expect((await POST(request)).status).toBe(200);
  expect(vi.mocked(generateWorldConversation).mock.calls[0][0].gameplayPlugins![0].ui!.html).toBe(html);
});
