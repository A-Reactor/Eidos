"use client";

// ============================================================
// Eidos · NPC 角色图层
// ============================================================
// 在背景之上显示 NPC 立绘（AI 生成透明底 + 表情差分）
// 说话人突出显示 + 表情切换
// 未上传立绘时省略角色图片
// ============================================================

import { useRef, useEffect, useState, useCallback, useMemo } from "react";
import { useGameStore } from "@/store/game-store";
import type { StorySegment } from "@/lib/ai/types";
import { buildNpcViewModels } from "@/lib/game/npc-view-model";
import { selectImageResource } from '@/lib/game/midori/image-selection';
import { imageResourceId } from '@/lib/game/midori/image-resource';
import { characterAssetId } from '@/lib/game/midori/character-target';

interface Props {
  currentSegment: StorySegment | null;
}

/** 表情 → 缓存键后缀映射 */
const EMOTION_CACHE_SUFFIX: Record<string, string> = {
  neutral: "neutral",
  happy: "happy", smiling: "happy",
  sad: "sad", worried: "sad",
  angry: "angry",
  surprised: "surprised",
  thinking: "thinking",
};

export function CharacterLayer({ currentSegment }: Props) {
  const currentScene = useGameStore((s) => s.currentScene);
  const currentWorld = useGameStore((s) => s.currentWorld);
  const npcStates = useGameStore((s) => s.npcStates);
  const npcBehaviors = useGameStore((s) => s.npcBehaviors);
  const relationships = useGameStore((s) => s.relationships);
  const encyclopedia = useGameStore((s) => s.encyclopedia);
  const midoriAssetRegistry = useGameStore((s) => s.midoriAssetRegistry);
  const [portraitCache, setPortraitCache] = useState<Record<string, string>>({});
  const portraitCacheRef = useRef<Record<string, string>>({});
  const missingPortraitsRef = useRef<Set<string>>(new Set());

  const speaker = currentSegment?.type === "dialogue" ? currentSegment.speaker : null;
  const rawEmotion = currentSegment?.type === "dialogue" ? (currentSegment.emotion ?? "neutral") : "neutral";
  const expressionKey = JSON.stringify(currentSegment?.expressionTags ?? []);
  const emotion = EMOTION_CACHE_SUFFIX[rawEmotion] ?? "neutral";

  const npcs = useMemo(() => currentScene?.npcs ?? [], [currentScene]);
  const npcModels = useMemo(
    () => buildNpcViewModels(npcs, {
      encyclopedia,
      npcBehaviors,
      npcStates,
      relationships,
    }),
    [npcs, encyclopedia, npcBehaviors, npcStates, relationships],
  );
  const worldId = currentWorld?.id;
  const legacyPortrait = (name: string, expression: string) => {
    const url = portraitCache[JSON.stringify([worldId, name, expression])];
    if (!url || midoriAssetRegistry.removedImageIds?.includes(imageResourceId(url)) || Object.values(midoriAssetRegistry.images ?? {}).some(image => image.imageUrl === url)) return null;
    return url;
  };

  useEffect(() => {
    portraitCacheRef.current = portraitCache;
  }, [portraitCache]);

  const rememberPortrait = useCallback((cacheKey: string, url: string) => {
    missingPortraitsRef.current.delete(cacheKey);
    setPortraitCache((prev) => {
      const next = { ...prev, [cacheKey]: url };
      portraitCacheRef.current = next;
      return next;
    });
  }, []);

  // 加载 NPC 肖像（从缓存）
  const loadPortrait = useCallback(async (npcName: string, expr: string, signal: AbortSignal) => {
    if (!worldId || !npcName) return;

    const cacheKey = JSON.stringify([worldId, npcName, expr]);
    if (
      portraitCacheRef.current[cacheKey] ||
      missingPortraitsRef.current.has(cacheKey)
    ) {
      return;
    }

    try {
      const res = await fetch('/api/midori/check-image', {
        method: 'POST', signal, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cacheKey: { worldId, sceneId: 'npcs', regionId: `${npcName}_${expr}`, weather: 'neutral', timeOfDay: 'portrait' } }),
      });
      if (!res.ok || signal.aborted) return;
      const data = await res.json();
      if (signal.aborted) return;
      if (data.cached && typeof data.url === 'string') {
        rememberPortrait(cacheKey, data.url);
        return;
      }
      missingPortraitsRef.current.add(cacheKey);
    } catch { /* A failed request stays retryable on the next scene/speaker change. */ }
  }, [worldId, rememberPortrait]);

  // Cache keys include the world, and old requests are cancelled before a new scene is read.
  useEffect(() => {
    const abort = new AbortController();
    const wanted = new Map(npcs.map(name => [characterAssetId(currentWorld, name), new Set(['neutral'])]));
    if (speaker) {
      const id = characterAssetId(currentWorld, speaker);
      const expressions = wanted.get(id) ?? new Set(['neutral']);
      expressions.add(emotion); wanted.set(id, expressions);
    }
    for (const [name, expressions] of wanted) {
      const id = characterAssetId(currentWorld, name);
      const active = id === characterAssetId(currentWorld, speaker ?? '');
      if (selectImageResource(midoriAssetRegistry, { worldId, targetType: 'character', targetId: id, slot: 'portrait', emotion: active ? rawEmotion : 'neutral',
        ...(active ? { expressionTags: JSON.parse(expressionKey), imageId: currentSegment?.imageId, imagePath: currentSegment?.imagePath } : {}) })) continue;
      for (const expression of expressions) void loadPortrait(id, expression, abort.signal);
    }
    return () => abort.abort();
  }, [speaker, emotion, rawEmotion, expressionKey, currentSegment?.imageId, currentSegment?.imagePath, npcs, worldId, currentWorld, midoriAssetRegistry, loadPortrait]);

  const speakerBoundAsset = speaker
    ? selectImageResource(midoriAssetRegistry, {
        worldId,
        targetType: "character",
        targetId: characterAssetId(currentWorld, speaker),
        slot: "portrait",
        emotion: rawEmotion, imageId: currentSegment?.imageId,
        expressionTags: currentSegment?.expressionTags, imagePath: currentSegment?.imagePath,
      })
    : null;

  const speakerImageUrl = speaker
    ? speakerBoundAsset?.imageUrl ?? legacyPortrait(characterAssetId(currentWorld, speaker), emotion) ?? legacyPortrait(characterAssetId(currentWorld, speaker), 'neutral')
    : null;

  if (npcs.length === 0 && !speakerImageUrl) return null;

  return (
    <div className="absolute inset-0 pointer-events-none">
      {/* 说话人立绘（居中偏下，突出显示） */}
      {speaker && speakerImageUrl && (
        <SpeakerPortrait
          npcName={speaker}
          imageUrl={speakerImageUrl}
        />
      )}

      {/* 场景中其他 NPC（小尺寸，背景中） */}
      {npcModels
        .filter((npc) => characterAssetId(currentWorld, npc.name) !== characterAssetId(currentWorld, speaker ?? ''))
        .map((npc) => {
          const boundAsset = selectImageResource(midoriAssetRegistry, {
            worldId,
            targetType: "character",
            targetId: characterAssetId(currentWorld, npc.name),
            slot: "portrait",
            emotion: 'neutral',
          });
          const imageUrl = boundAsset?.imageUrl ?? legacyPortrait(characterAssetId(currentWorld, npc.name), 'neutral');
          if (!imageUrl) return null;
          return (
            <BackgroundNPC
              key={npc.name}
              npcName={npc.name}
              isReacted={npc.hasReacted}
              imageUrl={imageUrl}
            />
          );
        })}
    </div>
  );
}

// ============================================================
// 说话人立绘（前景，大尺寸）
// ============================================================

function SpeakerPortrait({
  npcName,
  imageUrl,
}: {
  npcName: string;
  imageUrl: string;
}) {
  return (
    <div className="absolute bottom-0 right-[5%] w-[25%] max-w-[200px] transition-all duration-500 ease-out animate-in slide-in-from-right-8 fade-in">
      <img
        src={imageUrl}
        alt={npcName}
        className="w-full object-contain object-bottom"
        style={{ imageRendering: "pixelated", aspectRatio: "3/7" }}
      />

    </div>
  );
}

// ============================================================
// 背景 NPC（小尺寸，分散排列）
// ============================================================

function BackgroundNPC({
  npcName,
  isReacted,
  imageUrl,
}: {
  npcName: string;
  isReacted: boolean;
  imageUrl: string;
}) {
  const opacity = isReacted ? "opacity-60" : "opacity-30";
  return (
    <div className={`absolute bottom-0 left-[10%] w-[15%] max-w-[120px] ${opacity} transition-opacity duration-700`}>
      <img
        src={imageUrl}
        alt={npcName}
        className="w-full h-auto object-contain object-bottom"
        style={{ imageRendering: "pixelated" }}
      />
    </div>
  );
}
