"use client";
import { useInterfaceText } from "@/components/shell/useInterfaceText";

import { useMemo, type CSSProperties } from 'react';
import { useGameStore } from '@/store/game-store';
import { resourceKey } from '@/lib/game/plugins/resources';
import type { GameplayReadout, GameplayResource } from '@/lib/game/plugins/types';
import { parseGameplayPlugins } from '@/lib/game/plugins/manifest';
import { activeGameplayReadouts } from '@/lib/game/plugins/readouts';
import { isGameplayPluginActive } from '@/lib/game/plugins/activation';

type HudEntry = { key: string; pluginName: string } & (
  { kind: 'resource'; definition: GameplayResource; placement: 'left' | 'right' }
  | { kind: 'text'; definition: GameplayReadout; placement: 'left' | 'right' }
);

function HudResource({ definition, value, pluginName }: { definition: GameplayResource; value: number; pluginName: string }) {
  const ui = useInterfaceText();
  const hud = definition.hud!;
  const percent = definition.max === definition.min ? 100 : Math.max(0, Math.min(100, (value - definition.min) / (definition.max - definition.min) * 100));
  const warning = hud.warningBelow !== undefined && value < hud.warningBelow ? '偏低'
    : hud.warningAbove !== undefined && value > hud.warningAbove ? '偏高' : '';
  return <div className={`eidos-hud-entry eidos-hud-resource is-${hud.style}`} data-tone={hud.tone} data-warning={Boolean(warning)} title={`${pluginName} · ${definition.name}`}>
    <div className="eidos-hud-resource__label">{definition.name}</div>
    <div role="meter" aria-label={definition.name} aria-valuenow={value} aria-valuemin={definition.min} aria-valuemax={definition.max} className="eidos-hud-resource__readout">
      {hud.style === 'gauge' && <svg viewBox="0 0 100 100" aria-hidden="true" className="eidos-hud-gauge">
        <circle cx="50" cy="50" r="47" className="eidos-hud-gauge__ticks" />
        <g transform="rotate(135 50 50)"><circle cx="50" cy="50" r="40" pathLength="100" strokeDasharray="75 100" className="eidos-hud-gauge__track" />
          <circle cx="50" cy="50" r="40" pathLength="100" strokeDasharray={`${percent * .75} 100`} className="eidos-hud-gauge__value" /></g>
      </svg>}
      <div className="eidos-hud-resource__value" style={{ '--hud-digits': Math.max(3, String(value).length) } as CSSProperties} aria-label={ui("{0}数值", {"0": definition.name})}><strong>{value}</strong><span>{definition.unit}</span></div>
      {hud.style === 'bar' && <div className="eidos-hud-bar" aria-hidden="true"><span style={{ width: `${percent}%` }} /></div>}
      {hud.style !== 'counter' && definition.max > definition.min && <div className="eidos-hud-mobile-meter" aria-hidden="true"><span style={{ width: `${percent}%` }} /></div>}
    </div>
    <div className="eidos-hud-resource__scale"><span>{definition.min}</span><span>{definition.max}</span></div>
    {warning && <div className="eidos-hud-resource__warning">△ {warning}</div>}
  </div>;
}

export function GameplayHud() {
  const ui = useInterfaceText();
  const world = useGameStore(s => s.currentWorld);
  const resources = useGameStore(s => s.gameplayResources);
  const flags = useGameStore(s => s.worldFlags);
  const sceneId = useGameStore(s => s.currentSceneId);
  // World import preserves authors' raw files; normalize a display copy without rewriting the world.
  const plugins = useMemo(() => parseGameplayPlugins(world?.gameplayPlugins), [world?.gameplayPlugins]);
  const readouts = activeGameplayReadouts(plugins, flags, resources, sceneId);
  const entries: HudEntry[] = plugins.filter(p => isGameplayPluginActive(p, flags, sceneId)).flatMap(plugin => [
    ...readouts.filter(entry => entry.pluginId === plugin.id).map(entry => ({ ...entry, kind: 'text' as const, placement: entry.definition.placement })),
    ...Object.entries(plugin.resources ?? {}).filter(([, definition]) => definition.visible && definition.hud)
      .map(([id, definition]) => ({ key: resourceKey(plugin.id, id), definition, pluginName: plugin.name, kind: 'resource' as const, placement: definition.hud!.placement })),
  ]);
  if (!entries.length) return null;
  return <section aria-label={ui("玩法 HUD")} className="eidos-gameplay-hud">
    {(['left', 'right'] as const).map(side => {
      const visible = entries.filter(entry => entry.placement === side).slice(0, 3);
      return <div key={side} className={`eidos-gameplay-hud__cluster is-${side}`} data-count={visible.length} style={{ '--hud-count': Math.max(1, visible.length) } as CSSProperties}>
      {visible.map(entry => entry.kind === 'text'
        ? <p key={entry.key} className="eidos-hud-entry eidos-hud-readout" data-tone={entry.definition.tone} title={`${entry.pluginName} · ${entry.definition.text}`}>{entry.definition.text}</p>
        : <HudResource key={entry.key} definition={entry.definition} value={resources[entry.key] ?? entry.definition.initial} pluginName={entry.pluginName} />)}
    </div>; })}
  </section>;
}
