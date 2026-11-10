// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { useGameStore } from '@/store/game-store';
import { buildRiftCityStartState } from '@/lib/test/fixtures';
import { buildNpcMemoryState, projectNpcMemoryState } from '@/lib/game/npc-memory-save';
import type { PersonalityState } from '@/lib/personality/types';
import type { WorldDefinition } from '@/lib/game/types';

const description = '十九岁的巫女，山守家族最后的直系。她接下了言灵神社，发现家族旧卷里的记录。';
const world = { ...buildRiftCityStartState().world, npcs: { 朝仓铃音: description } };
const legacyArchive = {
  coreDesires: ['发现真相', '理解世界的运作方式'],
  fearsAndTaboos: ['得到错误的结论', '实验失败'],
  valuePriorities: ['真实', '知识', '准确'],
  cognitiveStyle: 'analytical' as const,
  emotionalRegulation: 'intellectualization' as const,
  socialStrategy: 'verification' as const,
  boundarySensitivity: 30,
  metacognition: 40,
};
function savedPersonality(): PersonalityState {
  return {
    npcId: '朝仓铃音', archive: structuredClone(legacyArchive), awareness: 2, isImportant: true,
    episodicMemories: [{ id: 'memory1', timestamp: 10, content: '千代送来了供糕', importance: 80, emotion: '安心', relatedNpcs: ['千代'], relatedBeliefs: [] }],
    semanticMemories: [], emotionalMemories: [], relationalMemories: [], anomalousMemories: [],
    beliefs: { confirmedFacts: [], unverifiedHypotheses: [], suppressedTruths: [], contradictions: [], interpretationOfPlayer: '可以信赖', interpretationOfWorld: '真实的世界', interpretationOfSelf: '真实的个体' },
    pressure: { survival: 0, relational: 12, cognitiveDissonance: 20, unfinishedGoals: 0, trustInPlayer: 30, worldDoubt: 10, selfContinuityFear: 0 },
    lastUpdated: 123,
  };
}
function memory() { return buildNpcMemoryState({ npcPersonalities: { 朝仓铃音: savedPersonality() } }); }
afterEach(() => useGameStore.setState(useGameStore.getInitialState(), true));

describe('legacy academic defaults recovery', () => {
  it('repairs a known inferred archive while retaining memories, beliefs, awareness and tracking', () => {
    const original = memory();
    const repaired = projectNpcMemoryState(original, world).npcPersonalities.朝仓铃音 as PersonalityState;
    expect(repaired.archive.cognitiveStyle).toBe('fantasy_prone');
    expect(repaired.archive.fearsAndTaboos).not.toContain('实验失败');
    expect({ ...repaired, archive: undefined }).toEqual({ ...savedPersonality(), archive: undefined });
    expect(original.records.朝仓铃音.personality?.archive.cognitiveStyle).toBe('analytical');
    const twice = projectNpcMemoryState(buildNpcMemoryState({ npcPersonalities: { 朝仓铃音: repaired } }), world);
    expect(twice.npcPersonalities.朝仓铃音).toEqual(repaired);
  });

  it('keeps edited archives and genuine researchers', () => {
    const edited = savedPersonality(); edited.archive.coreDesires = ['守住母亲留下的神社'];
    const input = buildNpcMemoryState({ npcPersonalities: { 朝仓铃音: edited } });
    expect(projectNpcMemoryState(input, world).npcPersonalities.朝仓铃音).toEqual(edited);
    const academicWorld = { ...world, npcs: { 朝仓铃音: '一位研究员，研究神社的历史。' } };
    expect(projectNpcMemoryState(memory(), academicWorld).npcPersonalities.朝仓铃音).toEqual(savedPersonality());
    const lateIdentity = { ...world, npcs: { 朝仓铃音: '他总是穿旧外套。如今在镇上当研究员。' } };
    expect(projectNpcMemoryState(memory(), lateIdentity).npcPersonalities.朝仓铃音).toEqual(savedPersonality());
  });

  it('preserves explicit source seeds even when they match the old generic template', () => {
    const seeded: WorldDefinition = { ...world, sourceArchive: {
      corpus: { id: 'corpus', documents: [], language: 'zh-CN', createdAt: 1 }, evidence: [],
      ledger: { id: 'ledger', title: '原作', summary: '', entities: [], relationships: [], events: [], worldRules: [], unresolvedQuestions: [], contradictions: [], sourceCoverage: { documentCount: 0, evidenceCount: 0, highConfidenceCount: 0 } },
      adaptationPlan: { mode: 'faithful', playablePremise: '', lockedFacts: [], allowedInventions: [], forbiddenInventions: [], bridgeContent: [] },
      uzqSeeds: [{ npcId: '朝仓铃音', sourceEntityIds: [], archive: structuredClone(legacyArchive), confidence: 100, evidenceRefs: [], forbiddenNarrativeMoves: [] }],
    } };
    expect(projectNpcMemoryState(memory(), seeded).npcPersonalities.朝仓铃音).toEqual(savedPersonality());
  });

  it('replaces only erroneous default activities, preserving observed or reviewed behavior', () => {
    const studentWorld = { ...world, npcs: { 佐藤葵: '十七岁的高中女生。她在观测隧道爆破的落点。' } };
    const behavior = { currentScene: 'town_main', currentActivity: '在观测设备前记录数据', currentMood: '专注', interactingWith: [], lastObserved: { day: 0, hour: 9, minute: 0 }, source: 'default' as const };
    const input = buildNpcMemoryState({ npcBehaviors: { 佐藤葵: behavior } });
    expect(projectNpcMemoryState(input, studentWorld).npcBehaviors.佐藤葵.currentActivity).not.toContain('观测设备');
    const reviewed = buildNpcMemoryState({ npcBehaviors: { 佐藤葵: { ...behavior, source: 'kei_update' } } });
    expect(projectNpcMemoryState(reviewed, studentWorld).npcBehaviors.佐藤葵).toEqual({ ...behavior, source: 'kei_update' });
  });

  it.each(['deserialize', 'restore'] as const)('repairs through the real %s entry point', mode => {
    const store = useGameStore.getState();
    useGameStore.setState({ currentWorld: world });
    if (mode === 'deserialize') {
      store.deserializeState({ ...store.serializeState(), npcMemory: memory() }, world);
    } else {
      store.restoreSnapshot({ ...buildRiftCityStartState().snapshot, worldId: world.id, npcMemory: memory() });
    }
    const restored = useGameStore.getState().npcPersonalities.朝仓铃音 as PersonalityState;
    expect(restored.archive.cognitiveStyle).toBe('fantasy_prone');
    expect(restored.episodicMemories[0].content).toBe('千代送来了供糕');
  });

  it('repairs an already loaded personality without recreating it', () => {
    useGameStore.setState({ currentWorld: world, npcPersonalities: { 朝仓铃音: savedPersonality() } });
    useGameStore.getState().ensurePersonality('朝仓铃音', description, true);
    const repaired = useGameStore.getState().npcPersonalities.朝仓铃音 as PersonalityState;
    expect(repaired.archive.cognitiveStyle).toBe('fantasy_prone');
    expect(repaired.awareness).toBe(2);
    expect(repaired.episodicMemories[0].id).toBe('memory1');
  });
});
