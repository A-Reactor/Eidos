// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { runInNewContext } from 'node:vm';
import { buildModDocument, acceptModCommand } from '@/lib/game/plugins/mod-ui';
import { DEFAULT_SHORTCUTS } from '@/lib/game/keyboard-shortcuts';

it('forwards configured host keys once and leaves confirmation to the map', () => {
  const listeners = new Map<string, (event: unknown) => void>(), send = vi.fn(), parent = { postMessage: send };
  runInNewContext(buildModDocument('<html><head></head><body></body></html>', 'token').match(/<script>([\s\S]*?)<\/script>/)![1], {
    window: {}, parent, document, console, crypto, setTimeout, clearTimeout,
    addEventListener: (name: string, listener: (event: unknown) => void) => listeners.set(name, listener),
  });
  listeners.get('message')!({ source: parent, data: { token: 'token', channel: 'eidos-mod-context', context: {
    scope: 'current', surface: { active: true }, reading: { paused: false }, keyboardShortcuts: { ...DEFAULT_SHORTCUTS, status: 'k' },
  } } });
  const hostKey = new KeyboardEvent('keydown', { key: 'k', cancelable: true });
  listeners.get('keydown')!(hostKey);
  expect(hostKey.defaultPrevented).toBe(true);
  expect(hostKey.cancelBubble).toBe(true);
  listeners.get('keydown')!(new KeyboardEvent('keydown', { key: 'k', repeat: true, cancelable: true }));
  listeners.get('keydown')!(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }));
  listeners.get('keydown')!(new KeyboardEvent('keydown', { key: 'z' }));
  expect(send.mock.calls.map(([message]) => message)).toEqual([{ channel: 'eidos-mod', token: 'token', scope: 'current', command: 'shortcut', action: 'status' }]);
});

it('validates shortcut names and rejects messages from stale branches', () => {
  const session = { token: 'token', scope: 'current', busy: false };
  const message = { channel: 'eidos-mod', token: 'token', scope: 'current', command: 'shortcut', action: 'status' };
  expect(acceptModCommand(message, session)).toEqual({ command: 'shortcut', action: 'status' });
  expect(acceptModCommand({ ...message, scope: 'old' }, session)).toBeNull();
  expect(acceptModCommand({ ...message, action: 'eval' }, session)).toBeNull();
});
