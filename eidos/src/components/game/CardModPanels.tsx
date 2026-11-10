'use client';
import { useInterfaceText } from "@/components/shell/useInterfaceText";

import { useGameStore } from '@/store/game-store';
import { isCardAdapter } from '@/lib/game/cards/adapter';
import { cardBindingActive } from '@/lib/game/cards/selection';
import { GameplayModSurface, type ModReading } from './GameplayModSurface';
import type { NarrativeRequest } from '@/lib/game/narrative';

export function CardModPanels({ reading, onSubmit, onAdvance }: {
  reading: ModReading; onSubmit: (action: string, request?: NarrativeRequest) => void | Promise<void>; onAdvance: () => void;
}) {
  const ui = useInterfaceText();
  const world = useGameStore(s => s.currentWorld), scene = useGameStore(s => s.currentScene);
  const plugins = world?.gameplayPlugins?.filter(plugin => isCardAdapter(plugin) && world.cardBindings?.some(b =>
    b.enabled && b.assetId === plugin.data?.cardAssetId && cardBindingActive(b, scene?.npcs ?? [], ''))) ?? [];
  if (!plugins.length) return null;
  return <aside className="eidos-card-panels" aria-label={ui("原卡变量面板")} hidden={reading.paused}>
    {plugins.map(plugin => <GameplayModSurface key={plugin.id} pluginId={plugin.id} reading={reading} onSubmit={onSubmit} onAdvance={onAdvance} />)}
  </aside>;
}
