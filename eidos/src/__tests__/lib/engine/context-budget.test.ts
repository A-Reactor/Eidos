import { expect, it, vi } from 'vitest';
import { buildEngineContext, createEngineSession, restoreEngineSession, type EngineNarrator } from '@/lib/engine';
import { courtyardWorld } from './fixtures';

const size = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;

it('limits model history and receipts without trimming the restored checkpoint or its idempotency journal', async () => {
  const generate = vi.fn<EngineNarrator['generate']>(async () => ({ segments: [{ type: 'narration', text: '四周很安静。' }] }));
  const options = { narrator: { generate }, context: { maxHistory: 1, maxReceipts: 1 } };
  const session = createEngineSession({ id: 'budget', world: courtyardWorld(), ...options });
  for (let i = 0; i < 2; i++) {
    await session.act({ id: `look-${i}`, expectedRevision: i * 2, text: '看看' });
    await session.synchronize({ id: `signal-${i}`, expectedRevision: i * 2 + 1, source: 'clock', summary: `signal ${i}` });
  }
  const restored = restoreEngineSession(session.getSnapshot(), options);
  await restored.act({ id: 'look-2', expectedRevision: 4, text: '看看' });
  expect(generate.mock.lastCall?.[0].context).toMatchObject({
    history: [{ operationId: 'look-1' }],
    receipts: [{ message: 'signal 1' }],
  });
  expect(restored.getSnapshot()).toMatchObject({ revision: 5 });
  expect(restored.getSnapshot().turns).toHaveLength(3);
  expect(restored.getSnapshot().receipts).toHaveLength(2);
  expect((await restored.act({ id: 'look-0', expectedRevision: 0, text: '看看' })).revision).toBe(1);
  expect(generate).toHaveBeenCalledTimes(3);
});

it('enforces UTF-8 bytes and preserves the newest receipt under pressure', async () => {
  const session = createEngineSession({ id: 'budget', world: courtyardWorld(), narrator: {
    async generate() { return { segments: [{ type: 'narration', text: '四周很安静。'.repeat(50) }] }; },
  } });
  await session.act({ id: 'look', expectedRevision: 0, text: '看看' });
  await session.synchronize({ id: 'old', expectedRevision: 1, source: 'clock', summary: '旧消息'.repeat(100) });
  await session.synchronize({ id: 'new', expectedRevision: 2, source: 'clock', summary: '新消息' });
  const checkpoint = session.getSnapshot();
  const full = buildEngineContext(checkpoint);
  const exact = size({ ...full, history: [], receipts: [full.receipts[1]] });
  const bounded = buildEngineContext(checkpoint, { maxBytes: exact });
  expect(size(bounded)).toBe(exact);
  expect(bounded.history).toEqual([]);
  expect(bounded.receipts).toEqual([full.receipts[1]]);
  expect(() => buildEngineContext(checkpoint, { maxBytes: exact - 1 })).toThrow(expect.objectContaining({ code: 'context_budget_exceeded' }));
  expect(buildEngineContext(checkpoint, { maxHistory: 0, maxReceipts: 0 }).receipts).toEqual([]);
});
