import type { WorldDefinition } from '../types';
import type { CardAsset, CardRole } from './types';
import { validateCardBindings } from './validation';
import { installCardAdapter } from './adapter';

export function mountCardWorld(input: { asset: CardAsset; role: CardRole; world?: WorldDefinition; name?: string; publicVariables?: string[] }): WorldDefinition {
  const { asset, role } = input;
  const name = input.name?.trim() || asset.name;
  const binding = { assetId: asset.id, name, role, enabled: true };
  validateCardBindings([...(input.world?.cardBindings ?? []), binding]);
  if (input.world) {
    // A new world version prevents changing cards underneath existing branches.
    const world = structuredClone(input.world);
    if (role === 'character') {
      world.npcs[name] = '';
      const scene = Object.values(world.regions).flatMap(region => Object.values(region.scenes))[0];
      if (scene && !scene.npcs.includes(name)) scene.npcs.push(name);
    }
    return installCardAdapter({ ...world, id: crypto.randomUUID(), name: `${world.name} · ${name}`, createdAt: Date.now(), isPlayerCreated: true,
      cardBindings: [...(world.cardBindings ?? []), binding] }, asset, input.publicVariables);
  }
  return installCardAdapter({
    id: crypto.randomUUID(), name, sourceMode: 'external_cards', subtitle: '原文卡片世界', overview: '场景、人物与世界规则以挂载的原卡为依据。未给出的信息随玩家行动建立，原文范例不代表已发生事件。',
    regions: { card_region: { id: 'card_region', name: '开场区域', description: '', scenes: {
      card_start: { id: 'card_start', name: '开场', region: '开场区域', initialDescription: '根据原卡开场进入故事。', detailLevel: 10,
        connections: [], npcs: role === 'character' ? [name] : [], secrets: [], discoveredSecrets: [] },
    } } },
    npcs: role === 'character' ? { [name]: '' } : {}, contradictions: [], history: [], timeline: [], clues: [],
    systemPromptBase: '保持原卡中的人物声音与世界规则；当前接受的状态变化是持续事实。使用 Eidos 输出协议提交叙事与状态。',
    identityPrompt: '玩家可以自定义姓名与身份；未指定时作为进入开场场景的访客。起点场景 ID 为 card_start。',
    isPlayerCreated: true, createdAt: Date.now(), cardBindings: [binding],
  }, asset, input.publicVariables);
}
