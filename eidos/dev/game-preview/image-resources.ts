import { useGameStore } from '@/store/game-store';
import type { ImageResource } from '@/lib/game/midori/image-resource';

const svgUrl = (svg: string) => `data:image/svg+xml,${encodeURIComponent(svg)}`;
const cat = (color: string, smile = false) => svgUrl(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 400"><rect width="300" height="400" fill="${color}"/><circle cx="230" cy="75" r="27" fill="#f1dfb5"/><path d="M78 245Q64 174 93 154L91 108L126 139Q150 129 178 140L215 110L208 161Q234 190 220 248L235 353H66Z" fill="#d8d4c9" stroke="#565a5b" stroke-width="3"/><path d="M95 167L110 148M200 167L186 148" stroke="#aaa59a" stroke-width="9"/><path d="M108 208l14 ${smile ? '-5' : '0'}M180 208l-14 ${smile ? '-5' : '0'}M147 220h7l-4 5Z" stroke="#505759" stroke-width="4" fill="none"/><path d="M150 226q-7 ${smile ? '15' : '7'}-14 0M150 226q7 ${smile ? '15' : '7'} 14 0" stroke="#505759" stroke-width="2" fill="none"/><path d="M92 267Q150 285 210 265L198 308H106Z" fill="#536e80"/><path d="M150 282v32" stroke="#e1be6b" stroke-width="3"/><circle cx="150" cy="317" r="7" fill="#e1be6b"/><path d="M96 353h111" stroke="#565a5b" stroke-width="3"/></svg>`);
const scene = (rain: boolean) => svgUrl(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360"><rect width="640" height="360" fill="${rain ? '#314454' : '#9fb6c0'}"/><circle cx="505" cy="68" r="30" fill="#e6d6a7"/><path d="M0 190L80 125L130 171L190 104L220 176L290 130L330 196Z" fill="#6c7f83"/><path d="M0 238H640V360H0Z" fill="${rain ? '#284454' : '#6f969e'}"/><path d="M0 253Q210 235 640 265V360H0Z" fill="#3a5660"/><path d="M40 290H430L540 333H0Z" fill="#b3ab95"/><path d="M300 90H340V265H300Z" fill="#b8af95"/><path d="M286 98L320 54L354 98Z" fill="#4d5d64"/><path d="M307 132H333V157H307Z" fill="#e4ca8c"/><path d="M90 285V200M170 282V200M250 282V200" stroke="#4d5d64" stroke-width="8"/><path d="M90 210H250" stroke="#4d5d64" stroke-width="6"/>${rain ? '<path d="M40 30l-12 30M140 65l-12 30M240 30l-12 30M440 90l-12 30M540 130l-12 30M590 30l-12 30" stroke="#9badb9" stroke-width="2"/>' : ''}</svg>`);

/** Deterministic vector fixtures keep UI checks independent of model calls and private artwork. */
export function seedTaggedImages() {
  const state = useGameStore.getState(), worldId = state.currentWorld!.id;
  const seed: Array<Partial<ImageResource> & Pick<ImageResource, 'id' | 'type' | 'targetId' | 'label' | 'tags'>> = [
    { id: 'preview:cat-neutral', type: 'character', targetId: '神秘猫', label: '神秘猫', tags: ['平静'], imageUrl: cat('#b9b8ad'), description: '灰白毛色，披着蓝色围巾。' },
    { id: 'preview:cat-happy', type: 'character', targetId: '神秘猫', label: '神秘猫', tags: ['开心', '夜间礼服'], imageUrl: cat('#aab6b9', true), description: '蓝色围巾，月亮挂饰，带着笑意。' },
    { id: 'preview:cat-thinking', type: 'character', targetId: '神秘猫', label: '神秘猫', tags: ['思考', '月夜'], imageUrl: cat('#adacb7'), description: '望向远处的灯塔。' },
    { id: 'preview:sunny', type: 'scene', targetId: 'central_plaza', label: '中央广场', tags: ['晴', '黄昏'], imageUrl: scene(false), description: '河岸、钟楼与傍晚的灯光。' },
    { id: 'preview:rain', type: 'scene', targetId: 'central_plaza', label: '中央广场', tags: ['雨', '夜晚'], imageUrl: scene(true), description: '雨中的河岸，灯光映在水面。' },
    { id: 'preview:illustration', type: 'illustration', targetId: 'central_plaza', label: '月下相遇', tags: ['月夜', '相遇'], description: '从河面望向渡口，船夫的剪影和远处的钟楼一同映在水中。' },
  ];
  for (const [index, image] of seed.entries()) {
    if (state.midoriAssetRegistry.images?.[image.id] || state.midoriAssetRegistry.removedImageIds?.includes(image.id)) continue;
    state.saveImageResource({ worldId, description: '', source: 'uploaded', createdAt: index + 1, updatedAt: index + 1, ...image });
  }
}
