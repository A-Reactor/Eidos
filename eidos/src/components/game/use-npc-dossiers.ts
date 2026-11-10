"use client";

import { useEffect, useMemo, useState } from 'react';
import { useGameStore } from '@/store/game-store';
import { loadBlob } from '@/lib/game/cas-storage';
import { getReadingPath } from '@/lib/game/player-reading';
import { buildNpcDossiers, getDossierEntries } from '@/lib/game/npc-dossiers';
import type { EncyclopediaEntry, WorldSnapshot } from '@/lib/game/types';

export function useNpcDossiers() {
  const store = useGameStore();
  const path = getReadingPath(store.allNodes, store.currentNode?.id ?? null);
  const requestKey = JSON.stringify([store.currentWorld?.id, store.currentPlaythroughId,
    path.map(node => [node.id, node.snapshotHash])]);
  const [loaded, setLoaded] = useState<{ key: string; entries: Record<string, EncyclopediaEntry[]>; error: boolean }>();
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    const [worldId, , nodes] = JSON.parse(requestKey) as [string, string, [string, string][]];
    const load = async () => {
      const entries: Record<string, EncyclopediaEntry[]> = {};
      let error = false;
      await Promise.all(nodes.filter(([, hash]) => hash).map(async ([id, hash]) => {
        try {
          const snapshot = await loadBlob(hash) as WorldSnapshot | null;
          if (!snapshot || snapshot.worldId !== worldId) throw new Error('人物资料快照缺失或不属于当前世界');
          entries[id] = getDossierEntries(snapshot);
        } catch (cause) { error = true; console.warn('[NpcDossiers] 读取人物资料失败', { nodeId: id, cause }); }
      }));
      if (active) setLoaded({ key: requestKey, entries, error });
    };
    void load();
    return () => { active = false; };
  }, [requestKey, retry]);
  const entries = useMemo(() => {
    const result = { ...(loaded?.key === requestKey ? loaded.entries : {}) };
    const node = store.currentNode;
    // Old/no-CAS records can still use their current public encyclopedia; reading gates remain in the model.
    if (node && !node.snapshotHash) result[node.id] = store.encyclopedia;
    return result;
  }, [loaded, requestKey, store.currentNode, store.encyclopedia]);
  const dossiers = useMemo(() => buildNpcDossiers({ nodes: store.allNodes, currentId: store.currentNode?.id ?? null,
    entriesByNode: entries, candidateNames: Object.keys(store.currentWorld?.npcs ?? {}), playerName: store.playerName }),
  [store.allNodes, store.currentNode?.id, store.currentWorld?.npcs, store.playerName, entries]);
  return { dossiers, loading: loaded?.key !== requestKey, error: loaded?.key === requestKey && loaded.error,
    retry: () => setRetry(value => value + 1) };
}
