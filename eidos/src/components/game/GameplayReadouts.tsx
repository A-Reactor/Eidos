"use client";
import { useInterfaceText } from "@/components/shell/useInterfaceText";


import { useMemo } from 'react';
import { useGameStore } from '@/store/game-store';
import { parseGameplayPlugins } from '@/lib/game/plugins/manifest';
import { activeGameplayReadouts } from '@/lib/game/plugins/readouts';

export function GameplayReadouts() {
  const ui = useInterfaceText();
  const declarations = useGameStore(s => s.currentWorld?.gameplayPlugins);
  const plugins = useMemo(() => parseGameplayPlugins(declarations), [declarations]);
  const flags = useGameStore(s => s.worldFlags);
  const resources = useGameStore(s => s.gameplayResources);
  const sceneId = useGameStore(s => s.currentSceneId);
  const entries = activeGameplayReadouts(plugins, flags, resources, sceneId);
  if (!entries.length) return null;
  return <section aria-label={ui("玩法提示")} className="eidos-gameplay-readouts">
    <h3 className="eidos-plugin-section-title">{ui("玩法提示")}</h3>
    {entries.map(entry => <div key={entry.key} className="eidos-plugin-readout-note"><p>{entry.definition.text}</p><small>{entry.pluginName}</small></div>)}
  </section>;
}
