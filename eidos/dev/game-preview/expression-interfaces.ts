import type { StorySegment } from '@/lib/ai/types';
import { useGameStore } from '@/store/game-store';
import { imageWorkspacePath, type ImageResource } from '@/lib/game/midori/image-resource';

/** Small vector fixtures make selection visible without model calls or private artwork. */
export function seedExpressionInterfaces(): StorySegment[] {
  const worldId = useGameStore.getState().currentWorld!.id;
  const artwork = (label: string, color: string, smiling: boolean) => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="360" height="400"><rect width="360" height="400" rx="18" fill="${color}"/><path d="M90 150L100 80L150 120Q180 105 210 120L260 80L270 150V270Q180 330 90 270Z" fill="#e8dfce"/><path d="M126 184l30 ${smiling ? '-12' : '0'}M204 184l30 ${smiling ? '-12' : '0'}" stroke="#535257" stroke-width="6"/><path d="M160 230Q180 ${smiling ? '258' : '215'} 200 230" fill="none" stroke="#535257" stroke-width="5"/><path d="M100 278Q180 310 260 278V330H100Z" fill="#566e85"/><text x="180" y="374" text-anchor="middle" font-size="22" fill="#393c43">${label}</text></svg>`)}`;
  const resources: ImageResource[] = [
    { id: 'expression-preview:happy', tags: ['开心'], label: '开心', imageUrl: artwork('开心', '#c2c4b6', true) },
    { id: 'expression-preview:dress', tags: ['开心', '礼服'], label: '开心 · 礼服', imageUrl: artwork('开心 · 礼服', '#acbfc6', true) },
    { id: 'expression-preview:thinking', tags: ['思考', '猫猫脸2'], label: '思考 · 猫猫脸2', imageUrl: artwork('思考 · 猫猫脸2', '#bbb2c9', false) },
  ].map(image => ({ ...image, worldId, targetId: '神秘猫', type: 'character', slot: 'portrait', description: '', source: 'uploaded', createdAt: 1, updatedAt: 1 }));
  useGameStore.setState({ midoriAssetRegistry: { version: 1, bindings: {}, images: Object.fromEntries(resources.map(image => [image.id, image])) } });
  return [
    { type: 'dialogue', speaker: '神秘猫', expressionTags: ['高兴', '礼服'], text: '好久不见。今晚沿河的灯都亮了，一起去看看吧。' },
    { type: 'dialogue', speaker: '神秘猫', imagePath: imageWorkspacePath('expression-preview:thinking'), text: '等等……先让我想想，我们应该从哪条路过去。' },
  ];
}
