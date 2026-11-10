import type { PersonalityArchive } from './types';
import { extractPersonalityFromDescription } from './context';
import type { NpcMemorySource } from '@/lib/game/npc-memory-save';
import type { WorldDefinition } from '@/lib/game/types';
import { getDefaultBehavior } from '@/lib/game/npc-behavior';

// 冻结旧版本指纹：只纠正可确认的自动默认值，不能重置玩家修改或剧情演变后的内核。
const LEGACY_ACADEMIC_ARCHIVE: PersonalityArchive = {
  coreDesires: ['发现真相', '理解世界的运作方式'],
  fearsAndTaboos: ['得到错误的结论', '实验失败'],
  valuePriorities: ['真实', '知识', '准确'],
  cognitiveStyle: 'analytical', emotionalRegulation: 'intellectualization', socialStrategy: 'verification',
  boundarySensitivity: 30, metacognition: 40,
};

export function repairLegacyAcademicArchive(archive: PersonalityArchive, description: unknown, npcId: string): PersonalityArchive {
  const matches = Object.entries(LEGACY_ACADEMIC_ARCHIVE).every(([key, value]) =>
    JSON.stringify(archive[key as keyof PersonalityArchive]) === JSON.stringify(value));
  if (!matches) return archive;
  const inferred = extractPersonalityFromDescription(description, npcId);
  return JSON.stringify(inferred) === JSON.stringify(LEGACY_ACADEMIC_ARCHIVE) ? archive : inferred;
}

export function repairLegacyNpcDefaults<T extends NpcMemorySource>(source: T, world: WorldDefinition): T {
  const personalities = { ...source.npcPersonalities };
  const behaviors = { ...source.npcBehaviors };
  for (const [name, description] of Object.entries(world.npcs)) {
    const state = personalities[name];
    if (state && !hasSourceSeed(world, name)) {
      const archive = repairLegacyAcademicArchive(state.archive, description, name);
      // 保留完整追踪及所有经历；修正身份不能让已有记忆因追踪层级下降而消失。
      if (archive !== state.archive) personalities[name] = { ...state, archive };
    }
    const behavior = behaviors[name];
    if (behavior?.source !== 'default') continue;
    const wasAcademicDefault = ['观测员', '研究员'].some(role => {
      const old = getDefaultBehavior('', `一位${role}`, behavior.currentScene, behavior.lastObserved);
      return old.currentActivity === behavior.currentActivity && old.currentMood === behavior.currentMood;
    });
    if (wasAcademicDefault) {
      const inferred = getDefaultBehavior(name, description, behavior.currentScene, behavior.lastObserved);
      if (inferred.currentActivity !== behavior.currentActivity) behaviors[name] = { ...behavior, currentActivity: inferred.currentActivity, currentMood: inferred.currentMood };
    }
  }
  return { ...source, npcPersonalities: personalities, npcBehaviors: behaviors };
}

function hasSourceSeed(world: WorldDefinition, name: string): boolean {
  const archive = world.sourceArchive;
  return archive?.uzqSeeds?.some(seed => seed.npcId === name || seed.sourceEntityIds.some(id =>
    archive.ledger.entities.some(entity => entity.id === id && entity.name === name))) ?? false;
}
