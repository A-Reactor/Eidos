import { expect, it } from 'vitest';
import { creationInputsFromPreset, type CreationDraft } from '@/lib/game/creation-materials';
import { buildRiftCityStartState } from '@/lib/test/fixtures';
import { parseGameplayPlugins } from '@/lib/game/plugins/manifest';
import { createWorldCreationSession, readWorldCreationSession } from '@/lib/game/world-creation-session';

function draft(): CreationDraft {
  return {
    generationProfile: 'quick',
    form: { name: '玩家世界', overview: '玩家概念', culture: '', regions: '', npcs: '', contradictions: '', history: '', clues: '', opening: '玩家开场', narrativeStyle: 'balanced', narrativeStyleCustom: '朴素的写法' },
    creationMode: 'concept', selectedSkills: ['custom-reader'],
    gameplayPlugins: parseGameplayPlugins([{ format: 'eidos-gameplay-plugin', version: 1, id: 'custom-reader', name: '原版阅读器', release: '1.0', description: '原始插件', tags: [], prompts: { creation: '', action: '', review: '' } }]),
    cards: [{ assetId: 'original-card', name: '原始角色卡', role: 'character', enabled: true, publicVariables: ['姓名'] }],
    sourceDraft: { title: '原始资料', content: '玩家粘贴的资料' }, sourceDocuments: [{ title: '补充', content: '玩家追加文本' }],
    concept: '由旧流程拼接的概念', sourceCorpus: null, sourceEvidence: [], sourceLedger: null,
    world: buildRiftCityStartState().world, raw: { world: 'AI 世界片段' }, completed: [0, 1],
    startedAt: 100, updatedAt: 200, status: 'complete',
  };
}

it('preserves only original inputs and excludes all generated results and checkpoint metadata', () => {
  const saved = draft();
  saved.conversation = { ...createWorldCreationSession(), pendingText: '未完成的 AI 操作' };
  const inputs = creationInputsFromPreset(saved);
  expect(inputs).toEqual({
    form: saved.form, generationProfile: 'quick', creationMode: 'concept', selectedSkills: saved.selectedSkills,
    gameplayPlugins: saved.gameplayPlugins, cards: saved.cards, sourceDraft: saved.sourceDraft, sourceDocuments: saved.sourceDocuments,
  });
  expect(JSON.stringify(inputs)).not.toContain('AI 世界片段');
  expect(JSON.stringify(inputs)).not.toContain('由旧流程拼接的概念');
  expect(JSON.stringify(inputs)).not.toContain('未完成的 AI 操作');
});

it('migrates old world and timeline material into one isolated, portable conversation', () => {
  const saved = draft();
  saved.raw.timeline = '旧时间线的未完成内容';
  const session = createWorldCreationSession({ world: saved.world as unknown as Record<string, unknown>, raw: saved.raw });
  expect(session.worldId).toBe(saved.world!.id);
  expect(session.fields.name).toBe(saved.world!.name);
  expect(session.messages[0].content).toContain('旧时间线的未完成内容');
  expect(session.fields).not.toHaveProperty('systemPromptBase');
  const restored = readWorldCreationSession(JSON.parse(JSON.stringify(session)))!;
  expect(restored).toEqual(session);
  restored.fields.name = '不同的草稿';
  expect(session.fields.name).toBe(saved.world!.name);
  expect(() => readWorldCreationSession({ ...session, fields: { __proto__: null, invalidField: 1 } })).toThrow('不支持的字段');
});

it('copies nested input materials so editing does not change the saved preset or plugin package', () => {
  const saved = draft(), inputs = creationInputsFromPreset(saved);
  inputs.form.name = '新名称'; inputs.sourceDraft.content = '新文本';
  inputs.sourceDocuments[0].content = '新资料'; inputs.gameplayPlugins![0].release = '2.0';
  inputs.cards![0].publicVariables!.push('年龄'); inputs.selectedSkills.push('tree-ops');
  expect(saved).toEqual(draft());
});
