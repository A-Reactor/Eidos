"use client";
import { useInterfaceText } from "@/components/shell/useInterfaceText";


import { useGameStore } from '@/store/game-store';
import { useMemo } from 'react';
import { parseGameplayPlugins } from '@/lib/game/plugins/manifest';
import { resourceKey } from '@/lib/game/plugins/resources';
import { isGameplayPluginActive } from '@/lib/game/plugins/activation';

export function GameplayResources({ pluginId, compact = false, activeOnly = false }: { pluginId?: string; compact?: boolean; activeOnly?: boolean } = {}) {
  const ui = useInterfaceText();
  const world = useGameStore(s => s.currentWorld);
  const resources = useGameStore(s => s.gameplayResources);
  const flags = useGameStore(s => s.worldFlags);
  const sceneId = useGameStore(s => s.currentSceneId);
  const plugins = useMemo(() => parseGameplayPlugins(world?.gameplayPlugins), [world?.gameplayPlugins]);
  const entries = plugins.filter(plugin => (!pluginId || plugin.id === pluginId) && (!activeOnly || isGameplayPluginActive(plugin, flags, sceneId))).flatMap(plugin => Object.entries(plugin.resources ?? {})
    .filter(([, definition]) => definition.visible)
    .map(([id, definition]) => ({ key: resourceKey(plugin.id, id), pluginName: plugin.name, definition })));
  if (!entries.length) return null;
  return <section aria-label={ui("玩法资源")} className={`eidos-gameplay-resources ${compact ? 'is-compact' : ''}`}>
    <h3 className="eidos-plugin-section-title">{ui("玩法资源")}</h3>
    <dl className="eidos-gameplay-resources__grid">
      {entries.map(({ key, pluginName, definition }) => {
        const value = resources[key] ?? definition.initial;
        const progress = definition.max === definition.min ? 100 : Math.min(100, Math.max(0, (value - definition.min) / (definition.max - definition.min) * 100));
        return <div key={key} aria-label={definition.name} title={pluginName} className="eidos-resource-card">
          <dt>{definition.name}</dt>
          <dd aria-label={ui("{0}资源", {"0": definition.name})}><strong>{value}</strong>{' '}<span>{definition.unit}</span></dd>
          {(!compact || definition.max > definition.min) && <div role={compact ? 'meter' : 'progressbar'} aria-label={ui("{0}进度", {"0": definition.name})} aria-valuemin={definition.min} aria-valuemax={definition.max} aria-valuenow={value}
            className="eidos-resource-meter"><span style={{ width: `${progress}%` }} /></div>
          }
          <p>{pluginId ? `${definition.min} — ${definition.max}` : `${pluginName} · ${definition.min} — ${definition.max}`}</p>
        </div>;
      })}
    </dl>
  </section>;
}
