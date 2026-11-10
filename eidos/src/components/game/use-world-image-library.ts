'use client';
import { useEffect, useState } from 'react';
import { useGameStore } from '@/store/game-store';
import { scopeStorageKey } from '@/lib/game/archive-scope';
import { hydrateWorldAssetLibrary, loadWorldAssetRegistry } from '@/lib/game/midori/asset-library';

/** Restore the shared library before applying an older save's local projection. */
export function useWorldImageLibrary(): string | null {
  const worldId = useGameStore(s => s.currentWorld?.id);
  const sandboxMode = useGameStore(s => s.sandboxMode);
  const sandboxDossierId = useGameStore(s => s.sandboxDossierId);
  const key = scopeStorageKey({ sandboxMode, sandboxDossierId }, worldId ?? '');
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null);
  useEffect(() => {
    if (!worldId) return;
    let cancelled = false;
    const scope = { sandboxMode, sandboxDossierId };
    void hydrateWorldAssetLibrary(worldId, scope).then(() => {
      const live = useGameStore.getState();
      if (cancelled || !live.currentWorld || scopeStorageKey(live, live.currentWorld.id) !== key) return;
      live.setMidoriAssetRegistry(loadWorldAssetRegistry(live.currentWorld, live.midoriAssetRegistry, scope));
      setFailure(null);
    }).catch(error => {
      if (!cancelled) setFailure({ key, message: `图像资源读取失败：${error instanceof Error ? error.message : String(error)}` });
    });
    return () => { cancelled = true; };
  }, [worldId, sandboxMode, sandboxDossierId, key]);
  return failure?.key === key ? failure.message : null;
}
