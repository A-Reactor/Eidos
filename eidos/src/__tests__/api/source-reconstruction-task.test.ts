import { expect, it, vi } from 'vitest';
import { POST } from '@/app/api/world/source/task/route';
import { createSourceTaskRequest } from '@/lib/game/source-reconstruction/task-protocol';
import { createSourceCorpus } from '@/lib/ai/source-archive';
import { indexSources, sourceRevision } from '@/lib/game/source-reconstruction/source-index';
vi.mock('@/lib/ai/client', () => ({ callAi: vi.fn() }));
it('rejects malformed or stale source tasks before calling the model', async () => {
  const send = (body: unknown) => POST(new Request('http://localhost/api/world/source/task', { method: 'POST', body: JSON.stringify(body) }));
  expect((await send({ stage: 'extract' })).status).toBe(400);
  const corpus = createSourceCorpus([{ content: '这是一个需要建档的测试世界。' }]);
  const request = createSourceTaskRequest('extract', { blocks: indexSources(corpus) }, { sourceRevision: sourceRevision(corpus), modelConfigHash: 'test', dependsOn: [] });
  expect((await send({ task: { ...request, inputHash: 'stale' } })).status).toBe(409);
  const { callAi } = await import('@/lib/ai/client');
  expect(callAi).not.toHaveBeenCalled();
});
