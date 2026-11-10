import type { WorldDefinition } from '../types';
import { cardCompatibility, cardEntries } from './entries';
import { installCardAdapter } from './adapter';
import { loadCardAsset } from './storage';
import { cardText, type CardAsset, type CardBinding } from './types';
import { validateCardBindings } from './validation';

export interface CreationCard extends CardBinding { publicVariables?: string[] }
export async function readCreationCards(cards: CreationCard[] = []) {
  validateCardBindings(cards);
  return Promise.all(cards.map(async card => {
    const asset = await loadCardAsset(card.assetId);
    if (!asset) throw new Error(`生成素材缺少原卡「${card.name}」，请重新导入`);
    const compatibility = cardCompatibility(asset);
    if (compatibility.blocked.length) throw new Error(`${card.name}：${compatibility.blocked.join('；')}`);
    return { card, asset };
  }));
}
export function creationCardDocument(card: CreationCard, asset: CardAsset) {
  const core = ['description', 'personality', 'scenario', 'system_prompt', 'post_history_instructions', 'first_mes', 'mes_example']
    .flatMap(key => cardText(asset.data[key]) ? [`### ${key}\n${cardText(asset.data[key])}`] : []);
  return { title: `酒馆原卡：${card.name}`, content: `用途：${card.role}\n这些是创作素材中的人物、世界与行为约定。与玩家概念和选择的玩法共同设计世界；引擎仍使用 Eidos 协议。开场、对话范例与条件条目不是已发生的历史；保留隐藏知识边界。原卡将在游玩时独立按需取用，无需把整张卡复制进 systemPromptBase。\n${[...core, ...cardEntries(asset).filter(e => e.enabled).map(e => `### 世界书 ${cardText(e.value.comment)}\n${e.text}`)].join('\n\n')}` };
}
/** Keep the generated world identity and design; attach original bytes through their existing adapters. */
export function attachCreationCards(world: WorldDefinition, sources: Awaited<ReturnType<typeof readCreationCards>>) {
  let result = structuredClone(world);
  for (const { card, asset } of sources) {
    const { publicVariables, ...binding } = card;
    const bindings = [...(result.cardBindings ?? []).filter(b => b.assetId !== card.assetId), binding];
    validateCardBindings(bindings);
    if (card.role === 'character') {
      result.npcs[card.name] ??= '';
      const scenes = Object.values(result.regions).flatMap(region => Object.values(region.scenes));
      if (!scenes.some(scene => scene.npcs.includes(card.name)) && scenes[0]) scenes[0].npcs.push(card.name);
    }
    result = installCardAdapter({ ...result, cardBindings: bindings }, asset, publicVariables);
  }
  return result;
}
