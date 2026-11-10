// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useGameStore } from '@/store/game-store';
import { buildRiftCityStartState } from '@/lib/test/fixtures';
import { withoutLegacyProgress } from '@/lib/game/legacy-progress';
import { snapshotForModel, worldForModel } from '@/lib/game/plugins/model-manifest';
import { readWorldCreationSession } from '@/lib/game/world-creation-session';
import { WORLD_CREATION_SYSTEM_PROMPT } from '@/lib/ai/prompt-templates';
import { buildQualityPrompt } from '@/lib/ai/kei-prompts';
import { parseGeneratedWorldData } from '@/lib/ai/generated-world-data';
import { validateCreatedWorld } from '@/lib/ai/world-creation-compiler';
import { parseWorldImportFiles } from '@/lib/game/import-records';
import { buildWorldOnlyExportPackage } from '@/lib/game/world-export';

const legacyEnding = { id: 'old-ending', title: '旧终局', description: '旧定义', triggerCheck: '条件已达成', endingNarrative: '旧尾声', triggered: true };
const legacyAchievement = { id: 'old-achievement', title: '旧成就', description: '旧定义', unlocked: true, unlockedAt: { day: 0, hour: 8, minute: 0 } };
const { world } = buildRiftCityStartState();
const legacyWorld = { ...world, endings: [legacyEnding], achievements: [legacyAchievement] };
beforeEach(() => { localStorage.clear(); useGameStore.setState(useGameStore.getInitialState(), true); });
afterEach(() => vi.restoreAllMocks());

it('ignores retired host fields without deleting plugin data or already-written narrative', () => {
  const plugin = { endings: ['剧情里的结尾'], achievements: ['插件自有记录'] };
  expect(withoutLegacyProgress({ endings: [legacyEnding], achievements: [legacyAchievement], text: '这是已经发生的故事。', plugin }))
    .toEqual({ text: '这是已经发生的故事。', plugin });
});

it('loads an old world and save into a playable session, without re-creating unlock or finish actions', () => {
  const state = useGameStore.getState();
  state.setCurrentWorld(legacyWorld);
  const saved = state.serializeState();
  const oldSave = { ...saved, playerName: '林', currentSceneId: 'central_plaza', sceneNarrative: '灯塔已经恢复，世界继续运行。', achievements: [legacyAchievement] };
  useGameStore.getState().deserializeState(oldSave, legacyWorld);
  const live = useGameStore.getState();
  expect(live.phase).toBe('playing'); expect(live.sceneNarrative).toBe(oldSave.sceneNarrative);
  expect(live.currentWorld).not.toHaveProperty('endings'); expect(live.currentWorld).not.toHaveProperty('achievements');
  for (const field of ['achievements', 'unlockAchievement', 'setAchievement', 'triggerEnding', 'endPlaythrough']) expect(live).not.toHaveProperty(field);
  expect(live.createSnapshot()).not.toHaveProperty('achievements'); expect(live.serializeState()).not.toHaveProperty('achievements');
});

it('does not send retired definitions, unlock state, or checks back into current model protocols', () => {
  expect(worldForModel(legacyWorld)).not.toHaveProperty('endings');
  expect(snapshotForModel({ ...buildRiftCityStartState().snapshot, achievements: [legacyAchievement] })).not.toHaveProperty('achievements');
  const prompt = buildQualityPrompt(legacyWorld, '', '');
  for (const text of ['triggeredEnding', 'achievementsSuggested', legacyEnding.title, legacyAchievement.title]) expect(prompt).not.toContain(text);
  expect(WORLD_CREATION_SYSTEM_PROMPT).not.toContain('"endings"'); expect(WORLD_CREATION_SYSTEM_PROMPT).not.toContain('"achievements"');
});

it('restores older creation drafts and accepts newly generated and imported worlds without ending fields', () => {
  const draft = readWorldCreationSession({ version: 1, worldId: world.id, fields: { name: world.name, endings: [legacyEnding], achievements: [legacyAchievement] }, messages: [], pendingText: '', complete: false });
  expect(draft?.fields).toEqual({ name: world.name });
  const parsed = parseGeneratedWorldData(JSON.stringify(legacyWorld));
  expect(parsed).not.toHaveProperty('endings'); expect(parsed).not.toHaveProperty('achievements');
  expect(validateCreatedWorld({ world }).ok).toBe(true);
  for (const input of [world, legacyWorld]) {
    const imported = parseWorldImportFiles([{ path: 'world.json', content: JSON.stringify(input) }]);
    expect(imported.world.id).toBe(world.id); expect(imported.world).not.toHaveProperty('endings');
  }
  const file = buildWorldOnlyExportPackage(legacyWorld).files.find(file => file.path === 'world/world.json')!;
  expect(JSON.parse(file.content)).not.toHaveProperty('endings'); expect(JSON.parse(file.content)).not.toHaveProperty('achievements');
});
