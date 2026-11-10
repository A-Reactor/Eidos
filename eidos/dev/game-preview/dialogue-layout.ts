import type { StorySegment } from '@/lib/ai/types';
import { useGameStore } from '@/store/game-store';

/** Extreme aspect ratios and long prose exercise layout without AI or image services. */
export function seedDialogueLayout(): StorySegment[] {
  const state = useGameStore.getState(), worldId = state.currentWorld!.id;
  const shapes = [[20, 400], [200, 400], [400, 400], [800, 400], [4000, 400]];
  const segments: StorySegment[] = [{ type: 'narration', text: '长旁白。' + '河岸的灯火映在水中，你沿着石阶观察渡口的来往人物。'.repeat(18) }];
  for (const [index, [width, height]] of shapes.entries()) {
    const speaker = `布局测试${index + 1}`;
    state.saveImageResource({ id: `dialogue-layout:${index}`, worldId, type: 'character', targetId: speaker,
      label: speaker, tags: [], description: '', source: 'uploaded', createdAt: 1, updatedAt: 1,
      imageUrl: `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#9fb6c0"/><circle cx="50%" cy="50%" r="20%" fill="#e6d6a7"/></svg>`)}` });
    segments.push({ type: 'dialogue', speaker, text: `${width}:${height} 图像。` + '沿着河岸走，你会经过旧钟楼，那里有你要找的人。'.repeat(index === 2 ? 80 : 4) });
  }
  return segments;
}
