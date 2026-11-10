import { runInNewContext } from 'node:vm';
import { afterEach, expect, it, vi } from 'vitest';
import { buildModDocument } from '@/lib/game/plugins/mod-ui';

afterEach(() => vi.useRealTimers());
it('awaits host acceptance even if the accepted operation has advanced the node scope', async () => {
  vi.useFakeTimers();
  const messages: Record<string, unknown>[] = [], handlers: Record<string, (event: { source: unknown; data: unknown }) => void> = {};
  const parent = { postMessage: (message: Record<string, unknown>) => messages.push(message) };
  const window = {} as { Eidos: { onContext(fn: () => void): void; gameplay: { commit(operation: unknown): Promise<unknown> } } };
  const source = buildModDocument('<head></head>', 'token').match(/<script>([\s\S]*?)<\/script>/)![1];
  runInNewContext(source, { parent, window, crypto: { randomUUID: () => 'operation-one' }, setTimeout, clearTimeout,
    addEventListener: (name: string, fn: (event: { source: unknown; data: unknown }) => void) => { handlers[name] = fn; } });
  window.Eidos.onContext(() => undefined);
  const publish = (scope: string) => handlers.message({ source: parent, data: { channel: 'eidos-mod-context', token: 'token', context: { scope, state: {} } } });
  publish('node-before');
  let receipt: unknown;
  const task = window.Eidos.gameplay.commit({ summary: '证词已推翻', state: { index: 1 }, facts: { broken: 'line-1' } }).then(r => { receipt = r; });
  const sent = messages.find(m => m.method === 'gameplay.commit')!;
  expect(sent.params).toMatchObject({ id: 'operation-one', expectedRevision: 0, facts: { broken: 'line-1' } });
  expect(receipt).toBeUndefined();
  publish('node-after');
  handlers.message({ source: parent, data: { channel: 'eidos-mod-result', token: 'token', scope: 'node-before', id: sent.id, ok: true, result: { id: 'operation-one', revision: 1 } } });
  await task; expect(receipt).toEqual({ id: 'operation-one', revision: 1 });
});
