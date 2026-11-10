import { parseGameplayPlugins } from '@/lib/game/plugins/manifest';

export const resourcePluginDraft = {
  format: 'eidos-gameplay-plugin', version: 2, id: 'supplies', name: '旅途补给', description: '消耗体力探索', tags: ['生存'],
  prompts: { creation: '设计能补给与休息的路径', action: '先核对资源再叙述结果', review: '核对实际行动与消耗依据' },
  resources: {
    stamina: { name: '体力', initial: 3, min: 0, max: 5, unit: '点' },
    food: { name: '补给', initial: 1, min: 0, max: 5, unit: '份' },
    secret: { name: '内部进度', initial: 0, min: 0, max: 5, visible: false },
  },
  rules: [
    { id: 'explore', description: '探索一段道路', once: false, resourceRequires: { stamina: { min: 2 } }, resourceChanges: { stamina: -2 }, sets: { explored: true } },
    { id: 'eat', description: '使用一份补给', once: false, resourceRequires: { food: { min: 1 }, stamina: { max: 3 } }, resourceChanges: { food: -1, stamina: 2 } },
    { id: 'find-food', description: '发现一份补给', resourceChanges: { food: 1 } },
    { id: 'open', description: '探索后开门', requires: { explored: true }, resourceRequires: { stamina: { min: 1 } }, sets: { open: true } },
  ],
};
export const resourceWorld = () => ({ gameplayPlugins: parseGameplayPlugins([resourcePluginDraft]) });
export const event = (ruleId: string) => ({ pluginId: 'supplies', ruleId });
export const resourceHudDraft = { ...resourcePluginDraft, resources: {
  ...resourcePluginDraft.resources,
  stamina: { ...resourcePluginDraft.resources.stamina, hud: { style: 'gauge', tone: 'mint', warningBelow: 2 } },
  food: { ...resourcePluginDraft.resources.food, hud: { style: 'counter', placement: 'right', tone: 'amber' } },
  secret: { ...resourcePluginDraft.resources.secret, hud: { style: 'bar' } },
} };
export const hudWorld = () => ({ gameplayPlugins: parseGameplayPlugins([resourceHudDraft]) });
