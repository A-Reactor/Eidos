// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { importCardAsset } from '@/lib/game/cards/storage';
import { readCreationCards, creationCardDocument, attachCreationCards, type CreationCard } from '@/lib/game/cards/creation';
import { exportWorldCardFiles, restoreWorldCardFiles } from '@/lib/game/cards/transfer';
import { buildRiftCityStartState } from '@/lib/test/fixtures';
import { cardAdapterId } from '@/lib/game/cards/adapter';
beforeEach(() => vi.stubGlobal('crypto', webcrypto));
afterEach(() => vi.unstubAllGlobals());
it('uses original card materials for design and attaches the runtime adapter without replacing the generated world', async () => {
  const bytes = new TextEncoder().encode(JSON.stringify({ name: '阿澄', description: '修理钟表的旅人', scenario: '失去指针的城市',
    first_mes: '你听到了钟声。', character_book: { entries: [{ comment: '[InitVar]', content: '{"trust":0}' }, { content: '桥下藏有旧时钟', keys: ['桥'] }] } }));
  const asset = await importCardAsset(bytes, '旅人.json');
  const card: CreationCard = { assetId: asset.id, name: asset.name, role: 'character', enabled: true, publicVariables: ['trust'] };
  const sources = await readCreationCards([card]);
  const doc = creationCardDocument(card, asset);
  expect(doc.content).toContain('修理钟表的旅人'); expect(doc.content).toContain('桥下藏有旧时钟');
  expect(doc.content).toContain('不是已发生的历史');
  const { world } = buildRiftCityStartState();
  const attached = attachCreationCards(world, sources);
  expect(attached.id).toBe(world.id); expect(attached.name).toBe(world.name);
  expect(attached.timeline).toEqual(world.timeline);
  expect(attached.cardBindings?.[0]).toMatchObject({ assetId: asset.id, role: 'character' });
  expect(attached.gameplayPlugins?.find(p => p.id === cardAdapterId(asset.id))?.data?.publicVariables).toEqual(['trust']);
  expect(world.cardBindings).toBeUndefined();
  const cardFiles = await exportWorldCardFiles({ cardBindings: [card] });
  await restoreWorldCardFiles(cardFiles, { cardBindings: [card] });
  expect((await readCreationCards([card]))[0].asset.originalBytes).toEqual(bytes);
});
it('rejects missing original assets before spending a model call', async () => {
  await expect(readCreationCards([{ assetId: 'f'.repeat(64), name: '缺失', role: 'world', enabled: true }])).rejects.toThrow(/重新导入/);
});
