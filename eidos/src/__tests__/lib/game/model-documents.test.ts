// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { afterEach, expect, it } from 'vitest';
import { _resetDB } from '@/lib/game/storage';
import { loadModelDocuments, saveModelDocument, documentMarkdown } from '@/lib/game/model-documents';

afterEach(_resetDB);
it('persists complete documents, isolates archives, and serializes concurrent appends', async () => {
  const scope = { worldId: crypto.randomUUID(), playthroughId: 'one' };
  const content = '完整正文。'.repeat(500) + '尾部标记';
  const first = await saveModelDocument(scope, { title: '报告', format: 'markdown', content, rawOutput: 'raw' }, '写报告');
  await Promise.all(['第二部分', '第三部分'].map(text => saveModelDocument(scope, { title: '续写', format: 'markdown', content: text, rawOutput: text }, '继续', first.id)));
  _resetDB();
  const [saved] = await loadModelDocuments(scope);
  expect(saved.content.startsWith(content)).toBe(true);
  expect(saved.content).toContain('第二部分'); expect(saved.content).toContain('第三部分');
  expect(saved.parts).toHaveLength(3);
  expect(saved.parts[0].rawOutput).toBe('raw');
  expect(documentMarkdown(saved)).toContain('尾部标记');
  expect(await loadModelDocuments({ ...scope, playthroughId: 'other' })).toEqual([]);
  expect(await loadModelDocuments({ ...scope, archiveId: 'sandbox:002' })).toEqual([]);
  await expect(saveModelDocument(scope, { title: '续写', format: 'markdown', content: '新段' }, '继续', 'missing')).rejects.toThrow('不存在');
});
