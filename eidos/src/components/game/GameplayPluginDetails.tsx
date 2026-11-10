"use client";
import { useInterfaceText } from "@/components/shell/useInterfaceText";

import { useMemo } from 'react';
import { useGameStore } from '@/store/game-store';
import { GameplayResources } from './GameplayResources';
import { GameplayReadouts } from './GameplayReadouts';
import { parseGameplayPlugins } from '@/lib/game/plugins/manifest';

/** The drawer lists loaded mods; full reference and package management live in Settings. */
export function GameplayPluginDetails() {
  const ui = useInterfaceText();
  const declarations = useGameStore(s => s.currentWorld?.gameplayPlugins);
  const plugins = useMemo(() => parseGameplayPlugins(declarations), [declarations]);
  if (!plugins?.length) return null;
  return <section aria-label={ui("已加载模组")} className="eidos-plugin-reference">
    <GameplayReadouts />
    <GameplayResources />
    <h3 className="eidos-plugin-section-title">{ui("已加载模组")}</h3>
    {plugins.map(plugin => <div key={plugin.id} className="eidos-plugin-reference__item text-xs">
      <strong>{plugin.name}</strong>
    </div>)}
  </section>;
}
