import { expect, it } from 'vitest';
import { snapshotForModel } from '@/lib/game/plugins/model-manifest';

it('hands accepted gameplay facts to narration without sending author UI state or files', () => {
  const result = snapshotForModel({ worldId: 'world', gameplayModState: { trial: {
    currentIndex: 1, privateAnswer: 'not model context', htmlCopy: '<html>large layout</html>',
    _eidosWorkspace: { files: ['private original'] },
    _eidosGameplay: { revision: 1, facts: { brokenStatement: 'line-1', evidence: 'inspection' },
      last: { id: 'op-1', revision: 1, summary: '第一句证词已被证据推翻', narration: 'pending', createdAt: 1 } },
  } } });
  expect(result).toMatchObject({ worldId: 'world', gameplayContext: [{ pluginId: 'trial', revision: 1,
    facts: { brokenStatement: 'line-1', evidence: 'inspection' }, result: { id: 'op-1', summary: '第一句证词已被证据推翻' } }] });
  expect(JSON.stringify(result)).not.toContain('not model context');
  expect(JSON.stringify(result)).not.toContain('private original');
  expect(result).not.toHaveProperty('gameplayModState');
});
