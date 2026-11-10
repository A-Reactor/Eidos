"use client";
import { useInterfaceText } from "@/components/shell/useInterfaceText";


import { useGameStore } from '@/store/game-store';
import { buildPlayerMap } from '@/lib/game/player-map';

export function RegionMap({ onOpen }: { onOpen: () => void }) {
  const ui = useInterfaceText();
  const store = useGameStore();
  const map = buildPlayerMap(store.currentWorld, store.currentSceneId, store.visitedScenes);
  const current = map.places.find(place => place.current);
  const nearby = map.places.filter(place => place.reachable);
  return <section className="eidos-map-summary" aria-label={ui("地图概览")}>
    <div className="eidos-map-eyebrow">{ui("ATLAS / 已知路线")}</div>
    <h3>{current?.name ?? store.currentScene?.name ?? ui("位置待确认")}</h3>
    <p>{current?.regionName ?? ui("尚无已知区域")}</p>
    <div className="eidos-map-summary__routes"><span>{ui("直接相连")}</span>
      {nearby.length ? nearby.map(place => <span key={place.id}>→ {place.name}</span>) : <span>{ui("尚无已知通道")}</span>}
    </div>
    <button type="button" className="eidos-focus eidos-dossier-action" onClick={onOpen}>{ui("打开地图 ↗")}</button>
  </section>;
}
