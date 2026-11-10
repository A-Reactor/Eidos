"use client";

import { useEffect, useMemo } from "react";
import { getSceneById } from "@/lib/game/scene-utils";
import { useGameStore } from "@/store/game-store";
import { BackgroundLayer } from "./BackgroundLayer";
import { CharacterLayer } from "./CharacterLayer";
import { ExamineOverlay } from "./ExamineOverlay";
import { selectImageResource } from '@/lib/game/midori/image-selection';
import { imageResourceId, imageWorkspacePath } from '@/lib/game/midori/image-resource';
import type { StorySegment } from "@/lib/ai/types";
import type { SceneRegion } from "@/lib/game/types";

interface Props {
  currentSegment?: StorySegment | null;
  showToast?: (text: string, color?: string) => void;
  /** Controls dialogue artwork; scene backgrounds remain in both reading layouts. */
  imagesEnabled?: boolean;
}

export function VisualNovelCanvas({ currentSegment = null, imagesEnabled = true }: Props) {
  const currentSceneId = useGameStore(s => s.currentSceneId);
  const currentWorld = useGameStore(s => s.currentWorld);
  const sceneImageUrl = useGameStore(s => s.sceneImageUrl);
  const setSceneImageUrl = useGameStore(s => s.setSceneImageUrl);
  const registry = useGameStore(s => s.midoriAssetRegistry);
  const examineState = useGameStore(s => s.examineState);
  const setExamineState = useGameStore(s => s.setExamineState);
  const weather = useGameStore(s => s.weather);
  const hour = useGameStore(s => s.gameTime.hour);
  const scene = useMemo(() => getSceneById(currentWorld, currentSceneId), [currentWorld, currentSceneId]);
  const worldId = currentWorld?.id;
  const hasLegacyArt = Boolean(currentWorld?.visualConfig?.scenePrompts?.[currentSceneId]);
  const regions = currentWorld?.visualConfig?.scenePrompts?.[currentSceneId]?.regions ?? [];
  const asset = selectImageResource(registry, { worldId, targetType: "scene", targetId: currentSceneId, slot: "background", weather, hour, imageId: currentSegment?.imageId, imagePath: currentSegment?.imagePath });
  const boundUrl = asset?.worldId === currentWorld?.id ? asset?.imageUrl : null;
  const hasManagedArt = Object.values(registry.images ?? {}).some(image => image.worldId === worldId && image.type === 'scene' && image.targetId === currentSceneId);
  const referenced = registry.images?.[currentSegment?.imageId ?? ''] ?? Object.values(registry.images ?? {}).find(image => image.worldId === worldId && imageWorkspacePath(image.id) === currentSegment?.imagePath);
  const illustration = imagesEnabled && referenced?.type === 'illustration' && referenced.worldId === worldId && referenced.imageUrl &&
    !registry.removedImageIds?.includes(referenced.id) && (!referenced.targetId || referenced.targetId === currentSceneId) ? referenced : null;

  useEffect(() => {
    setExamineState(null);
    setSceneImageUrl(boundUrl ?? null);
    if (boundUrl || !worldId || !currentSceneId || !hasLegacyArt || hasManagedArt) return;
    const abort = new AbortController();
    // Old saves can still use cached artwork; a cache miss never starts generation.
    void fetch("/api/midori/check-image", {
      method: "POST", signal: abort.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cacheKey: { worldId, sceneId: currentSceneId, weather, timeOfDay: `${hour}h` } }),
    }).then(async response => {
      if (!response.ok) return;
      const data = await response.json();
      // Ignore late responses from a previous scene or world.
      if (!abort.signal.aborted && data.cached && typeof data.url === "string" && !registry.removedImageIds?.includes(imageResourceId(data.url))) setSceneImageUrl(data.url);
    }).catch(error => {
      if (!abort.signal.aborted) console.warn("[VisualNovelCanvas] cached image lookup failed:", error);
    });
    return () => abort.abort();
  }, [worldId, hasLegacyArt, hasManagedArt, registry.removedImageIds, currentSceneId, boundUrl, weather, hour, setSceneImageUrl, setExamineState]);

  if (!scene) return null;
  if (illustration) return <figure className="eidos-story-illustration"><img src={illustration.imageUrl} alt={illustration.label} /><figcaption>{illustration.label}</figcaption></figure>;
  const activeRegion = regions.find(region => region.id === examineState?.regionId);
  return <div className="eidos-visual-canvas relative w-full max-w-[960px] mx-auto">
    <div className={`eidos-scene-canvas relative w-full overflow-hidden bg-transparent ${regions.length ? "cursor-crosshair" : ""}`}
      style={{ aspectRatio: "16/9" }} onClick={event => {
        const rect = event.currentTarget.getBoundingClientRect();
        const x = (event.clientX - rect.left) * 960 / rect.width;
        const y = (event.clientY - rect.top) * 540 / rect.height;
        const region = regions.find(region => x >= region.x && x <= region.x + region.width && y >= region.y && y <= region.y + region.height);
        if (region) setExamineState({ active: true, regionId: region.id, regionName: region.name, detailImageUrl: null, zoomLevel: 1 });
      }}>
      <div className="absolute inset-0"><BackgroundLayer imageUrl={sceneImageUrl} transitioning={false} /></div>
      {imagesEnabled && <CharacterLayer currentSegment={currentSegment} />}
      {!!regions.length && <RegionHighlights regions={regions} />}
    </div>
    {examineState?.active && activeRegion && <ExamineOverlay region={activeRegion} detailImageUrl={examineState.detailImageUrl} onClose={() => setExamineState(null)} />}
  </div>;
}

function RegionHighlights({ regions }: { regions: SceneRegion[] }) {
  return (
    <div className="absolute inset-0 pointer-events-none">
      {regions.map((region) => (
        <div
          key={region.id}
          className="absolute border border-transparent hover:border-amber-400/30 hover:bg-amber-400/5 transition-colors duration-300 pointer-events-auto"
          style={{
            left: `${(region.x / 960) * 100}%`,
            top: `${(region.y / 540) * 100}%`,
            width: `${(region.width / 960) * 100}%`,
            height: `${(region.height / 540) * 100}%`,
          }}
          title={region.name}
        />
      ))}
    </div>
  );
}
