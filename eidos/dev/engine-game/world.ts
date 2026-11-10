import type { WorldDefinition, WorldSnapshot } from '@/lib/game/types';
import { parseGameplayPlugins } from '@/lib/game/plugins/manifest';
import { createRpgSnapshot } from '@/lib/game/action-runtime/initial-state';

export function courtyardWorld(): WorldDefinition {
  const scene = (id: string, name: string, description: string, connections: string[], npcs: string[] = []) => ({
    id, name, region: 'courtyard', initialDescription: description, detailLevel: 10, connections, npcs, secrets: [], discoveredSecrets: [],
  });
  return {
    id: 'courtyard-demo', name: '庭院门', subtitle: '独立宿主接入演示', overview: '向守门人问路，找到钥匙，打开门，走进庭院。',
    regions: { courtyard: { id: 'courtyard', name: '旧宅', description: '两间相连的小场景。', scenes: {
      hall: scene('hall', '门厅', '晨光落在长椅上。守门人站在通往庭院的铜门旁，一把钥匙被遗落在椅脚。', ['garden'], ['守门人']),
      garden: scene('garden', '庭院', '你推门走进庭院。风穿过树叶，石桌上落着浅浅的花影。', ['hall']),
    } } },
    mapRoutes: [{ from: 'hall', to: 'garden', status: 'blocked' }, { from: 'garden', to: 'hall', status: 'blocked' }],
    npcs: { 守门人: '照看这座旧宅的老人，说话温和。' }, contradictions: [], history: [], timeline: [], clues: [],
    systemPromptBase: '', identityPrompt: '', isPlayerCreated: true, createdAt: 0,
    gameplayPlugins: parseGameplayPlugins([{
      format: 'eidos-gameplay-plugin', version: 2, id: 'courtyard', name: '庭院交互', description: '程序控制钥匙、门锁和行走体力。', tags: [],
      prompts: { creation: '', action: '', review: '' },
      resources: { keys: { name: '钥匙', min: 0, max: 1, initial: 0 }, stamina: { name: '体力', min: 0, max: 5, initial: 5 } },
      rules: [
        { id: 'take-key', description: '捡起铜钥匙', once: true, sets: { 'key-found': true }, resourceChanges: { keys: 1 } },
        { id: 'unlock', description: '铜钥匙打开庭院门', once: true, resourceRequires: { keys: { min: 1 } }, resourceChanges: { keys: -1 }, sets: { open: true },
          effects: { state: [{ op: 'add', path: '/opened', value: true }], facts: [{ op: 'add', path: '/door', value: 'open' }] } },
        { id: 'travel', description: '走过庭院门', requires: { open: true }, resourceRequires: { stamina: { min: 1 } }, resourceChanges: { stamina: -1 } },
      ],
    }]),
  };
}

export function courtyardSnapshot(world: WorldDefinition): WorldSnapshot {
  const snapshot = createRpgSnapshot({ world, playerName: '旅人', sceneId: 'hall' });
  return { ...snapshot, protagonistState: { ...snapshot.protagonistState!, mood: '好奇' } };
}
