import { expect, it } from 'vitest';
import { runInNewContext } from 'node:vm';
import { buildModDocument } from '@/lib/game/plugins/mod-ui';

function boot() {
  const messages: Array<{ command: string }> = [];
  const handlers: Record<string, (event: unknown) => void> = {};
  const parent = { postMessage: (message: { command: string }) => messages.push(message) };
  const window: { Eidos?: { onContext: (fn: (context: unknown) => void) => void } } = {};
  const document = buildModDocument('<html><head></head><body>作者界面</body></html>', 'session');
  const sdk = document.match(/<script>([\s\S]*?)<\/script>/)![1];
  runInNewContext(sdk, { parent, window, addEventListener: (name: string, fn: (event: unknown) => void) => { handlers[name] = fn; } });
  const publish = () => handlers.message({ source: parent, data: { channel: 'eidos-mod-context', token: 'session', context: { scope: 'world:node' } } });
  return { messages, handlers, parent, window, publish };
}
it('waits for a real author consumer before replacing the default reader', () => {
  const app = boot();
  app.handlers.message({ source: app.parent, data: { channel: 'eidos-mod-host-ready', token: 'session' } });
  expect(app.messages.some(message => message.command === 'ready')).toBe(false);
  let rendered = false;
  app.window.Eidos!.onContext(() => { rendered = true; });
  expect(app.messages.at(-1)?.command).toBe('connect');
  app.publish();
  expect(rendered).toBe(true);
  expect(app.messages.at(-1)?.command).toBe('ready');
});
it('reports a consumer exception as failure and never marks it ready', () => {
  const app = boot();
  app.window.Eidos!.onContext(() => { throw new Error('作者初始化错误'); });
  app.publish();
  expect(app.messages.at(-1)?.command).toBe('failed');
  expect(app.messages.some(message => message.command === 'ready')).toBe(false);
});
it('reports author script errors caught before a consumer registers', () => {
  const app = boot();
  app.handlers.error({ message: 'SyntaxError in authored script' });
  expect(app.messages.at(-1)?.command).toBe('failed');
});
