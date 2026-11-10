'use client';
import { useInterfaceText } from "@/components/shell/useInterfaceText";

import { useEffect, useMemo, useState } from 'react';
import { useGameStore } from '@/store/game-store';
import { parseGameplayPlugins } from '@/lib/game/plugins/manifest';
import { isGameplayPluginActive } from '@/lib/game/plugins/activation';
import { isCardAdapter } from '@/lib/game/cards/adapter';
import { archiveScopeSessionValue } from '@/lib/game/archive-scope';
import { GameplayModSurface, type GameplayModSurfaceProps } from './GameplayModSurface';

/** Keep eligible readers alive while a temporary operation owns the stage. */
export function GameplayModStages(props: GameplayModSurfaceProps & { authorTools?: boolean }) {
  const ui = useInterfaceText();
  const { onActiveChange, onPresentationChange } = props;
  const store = useGameStore(), definitions = store.currentWorld?.gameplayPlugins;
  // Native text packages keep their HTML as an author workbench, never a player-facing frame.
  const plugins = useMemo(() => parseGameplayPlugins(definitions).filter(p => p.ui && (props.authorTools || !['native-text', 'native', 'tool'].includes(p.ui.presentation ?? '')) && !isCardAdapter(p)), [definitions, props.authorTools]);
  const session = `${store.currentWorld?.id}:${store.currentPlaythroughId}:${store.worldLine?.id}:${archiveScopeSessionValue(store)}`;
  const scope = `${session}:${store.currentNode?.id}:${store.currentSceneId}`;
  const [released, setReleased] = useState<Record<string, string>>({}), [failed, setFailed] = useState<Record<string, string>>({});
  const [ready, setReady] = useState<Record<string, boolean>>({});
  const [visited, setVisited] = useState<{ session: string; ids: string[] }>({ session: '', ids: [] });
  const eligible = plugins.filter(p => isGameplayPluginActive(p, store.worldFlags, store.currentSceneId));
  const mounted = new Set([...(visited.session === session ? visited.ids : []), ...eligible.map(p => p.id)]);
  const mountedKey = [...mounted].join(',');
  // Retain retiring frames for their acceptance replies, without an effect-driven extra render.
  if (visited.session !== session || visited.ids.join(',') !== mountedKey) setVisited({ session, ids: [...mounted] });
  const candidates = eligible.filter(p => released[p.id] !== scope && failed[p.id] !== session)
    .sort((a, b) => (b.ui?.priority ?? (b.activation ? 1 : 0)) - (a.ui?.priority ?? (a.activation ? 1 : 0)));
  const selected = candidates[0];
  const active = Boolean(selected && ready[selected.id]);
  useEffect(() => { onActiveChange?.(active); }, [active, onActiveChange]);
  const presentation = active && selected?.ui?.presentation === 'scene-map' ? 'scene-map' : null;
  useEffect(() => { onPresentationChange?.(presentation); }, [presentation, onPresentationChange]);
  return <>
    {candidates.length > 1 && (candidates[0].ui?.priority ?? (candidates[0].activation ? 1 : 0)) === (candidates[1].ui?.priority ?? (candidates[1].activation ? 1 : 0)) &&
      <p role="status" className="eidos-mod-notice">{ui("多个舞台优先级相同，按安装顺序使用「")}{selected.name}」。</p>}
    {plugins.filter(p => mounted.has(p.id)).map(plugin => <div key={`${session}:${plugin.id}`} data-stage-owner={plugin.id} hidden={plugin.id !== selected?.id}>
      <GameplayModSurface {...props} managed pluginId={plugin.id} suspended={plugin.id !== selected?.id}
        onRelease={() => setReleased(old => ({ ...old, [plugin.id]: scope }))}
        onFailure={() => setFailed(old => old[plugin.id] === session ? old : ({ ...old, [plugin.id]: session }))}
        onActiveChange={replace => setReady(old => old[plugin.id] === replace ? old : ({ ...old, [plugin.id]: replace }))} />
    </div>)}
  </>;
}
