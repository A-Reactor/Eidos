import { expect, it } from 'vitest';
import { narrativePrompt, protectNarrativeResponse, type NarrativeRequest } from '@/lib/game/narrative';
import { buildRiftCityStartState } from '@/lib/test/fixtures';
import { makeResponse } from '../ai/kei-fixtures';

const request: NarrativeRequest = { kind: 'result', result: { pluginId: 'trial', id: 'broken-one' } };
const context = [{ pluginId: 'trial', revision: 1, facts: { broken: 'statement-one' }, result: { id: 'broken-one', revision: 1, summary: '第一句已被推翻', createdAt: 1, narration: 'pending' as const } }];
it('keeps result narration from applying any second gameplay or protagonist effects', () => {
  const response = makeResponse({ validity: { isPossible: false, reason: '模型重新否定了本地判定', fantasyResponse: null },
    pluginEvents: [{ pluginId: 'trial', ruleId: 'spend' }], sceneChanges: ['elsewhere'], cluesDiscovered: ['secret'],
    cardVariableUpdates: [{ assetId: 'asset', expectedRevision: 0, changes: [{ path: 'trust', oldValue: 1, newValue: 2 }] }],
    timeSpent: { day: 0, hour: 1, minute: 0 }, criticalFactsDiscovered: ['不应再次产生后果'], worldImpacts: ['[BACKTRACK:old]'] });
  const time = { day: 0, hour: 8, minute: 0 };
  const result = protectNarrativeResponse(response, time, request, { ...buildRiftCityStartState().snapshot, gameplayContext: context });
  expect(result.validity.isPossible).toBe(true);
  expect(result.pluginEvents).toEqual([]); expect(result.cardVariableUpdates).toEqual([]);
  expect(result.sceneChanges).toEqual([]); expect(result.criticalFactsDiscovered).toEqual([]);
  expect(result.timeAfter).toEqual(time); expect(result.worldImpacts).toEqual([]);
  expect(result.segments).toMatchObject(response.segments);
  expect(result._gameplayResult).toEqual(request.result);
});
it('only requests narration for the actual accepted result and states the confirmed facts', () => {
  const snapshot = { ...buildRiftCityStartState().snapshot, gameplayContext: context };
  expect(narrativePrompt(request, snapshot)).toContain('第一句已被推翻');
  expect(() => narrativePrompt({ kind: 'result', result: { pluginId: 'trial', id: 'invented' } }, snapshot)).toThrow(/结果/);
});
it('carries explicit choices on the accepted final segment instead of parsing visible text', () => {
  const response = makeResponse({ narrativeChoices: [{ id: 'keep', label: '保留私信' }, { id: 'share', label: '公开原句' }] });
  const protectedResponse = protectNarrativeResponse(response, { day: 0, hour: 8, minute: 0 });
  expect(protectedResponse.segments.at(-1)?.choices).toEqual([{ id: 'keep', label: '保留私信' }, { id: 'share', label: '公开原句' }]);
});
