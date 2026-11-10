// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { runInNewContext } from 'node:vm';
import { buildModDocument } from '@/lib/game/plugins/mod-ui';

afterEach(() => document.body.replaceChildren());
it('applies authenticated host theme updates before author callbacks, preserving the live document', () => {
  const frame = document.createElement('iframe'); document.body.append(frame);
  const win = frame.contentWindow! as Window & typeof globalThis & { Eidos: { onContext(fn: () => void): void } };
  const doc = frame.contentDocument!;
  doc.body.innerHTML = '<button id="turn">第七回合</button>';
  const sdk = buildModDocument('<head></head>', 'test-theme').match(/<script>([\s\S]*?)<\/script>/)![1];
  const handlers: Record<string, (event: { source: unknown; data: unknown }) => void> = {};
  runInNewContext(sdk, { parent: window, window: win, document: doc,
    addEventListener: (name: string, fn: typeof handlers.message) => { handlers[name] = fn; } });
  const seen: string[] = [];
  win.Eidos.onContext(() => seen.push(doc.documentElement.style.getPropertyValue('--eidos-accent')));
  const send = (token: string, theme: object) => handlers.message({ source: window, data: { channel: 'eidos-mod-context', token, context: { scope: 'same-turn', theme } } });
  send('test-theme', { mode: 'light', background: '#fafafa', surface: '#ffffff', ink: '#191919', accent: '#9e0000', fontSans: 'Arial, sans-serif', fontMono: 'monospace', reducedMotion: false, fontSize: 14 });
  expect(doc.documentElement.dataset.theme).toBe('light');
  expect(seen).toEqual(['#9e0000']);
  const button = doc.querySelector('#turn');
  send('forged-token', { mode: 'dark', accent: '#000000' });
  expect(seen).toHaveLength(1);
  send('test-theme', { mode: 'dark', background: '#111e2a', surface: '#1a2a39', ink: '#eeeeee', accent: '#8cc9ed', fontSans: 'Arial, sans-serif', fontMono: 'monospace', reducedMotion: true, fontSize: 26 });
  expect(doc.documentElement.dataset.theme).toBe('dark');
  expect(doc.documentElement.style.colorScheme).toBe('dark');
  expect(doc.documentElement.style.fontSize).toBe('26px');
  expect(doc.documentElement.style.getPropertyValue('--eidos-paper')).toBe('#111e2a');
  expect(doc.documentElement.style.getPropertyValue('--font-geist-sans')).toBe('Arial, sans-serif');
  expect(doc.documentElement.dataset.motion).toBe('reduced');
  expect(seen).toEqual(['#9e0000', '#8cc9ed']);
  expect(doc.querySelector('#turn')).toBe(button);
});
