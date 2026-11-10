import { expect, it } from 'vitest';
import { validateActionInput } from '@/lib/api/request-input';
import { buildRiftCityStartState } from '@/lib/test/fixtures';
it('rejects card contexts with unbound assets or invalid shapes before model invocation', () => {
  const { world, snapshot } = buildRiftCityStartState();
  const body = { world, snapshot, playerInput: '查看' };
  expect(() => validateActionInput({ ...body, cardContext: { stablePrefix: {}, dynamicSuffix: '', selected: [], omitted: [] } })).toThrow(/卡片/);
  expect(() => validateActionInput({ ...body, cardContext: { stablePrefix: '文字', dynamicSuffix: '', selected: [{ assetId: 'a'.repeat(64), pointer: '/data/description', reason: 'core', chars: 2 }], omitted: [] } })).toThrow(/绑定/);
});
