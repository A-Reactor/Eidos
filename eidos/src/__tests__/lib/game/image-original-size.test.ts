// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { afterEach, expect, it } from 'vitest';
import { parseResource } from '@/lib/game/workspace/resources';
import { _resetDB } from '@/lib/game/storage';
afterEach(_resetDB);

it('allows image originals above the text limit without expanding ordinary text or binary materials', () => {
  const base64 = 'AAAA'.repeat(2 * 1024 * 1024);
  expect(parseResource({ name: 'animation.gif', mimeType: 'image/gif', base64 }).size).toBe(6 * 1024 * 1024);
  expect(() => parseResource({ name: 'data.bin', mimeType: 'application/octet-stream', base64 })).toThrow('4');
  expect(() => parseResource({ name: 'disguised.txt', mimeType: 'image/gif', text: 'x'.repeat(4194305) })).toThrow('4');
});
