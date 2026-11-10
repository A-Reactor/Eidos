'use client';
import { useInterfaceText } from "@/components/shell/useInterfaceText";

import { useMemo, useState } from 'react';
import { useGameStore } from '@/store/game-store';
import { parseGameplayPlugins } from '@/lib/game/plugins/manifest';
import { GameplayModSurface } from '../GameplayModSurface';

/** Mount only after the author opens it; ordinary play never runs the workbench. */
export function NativeTextAuthorTools() {
  const ui = useInterfaceText();
  const definitions = useGameStore(s => s.currentWorld?.gameplayPlugins);
  const segments = useGameStore(s => s.savedSegments);
  const plugins = useMemo(() => parseGameplayPlugins(definitions).filter(p => ['native-text', 'native', 'tool'].includes(p.ui?.presentation ?? '') && p.ui?.html), [definitions]);
  const [opened, setOpened] = useState(false), [selected, setSelected] = useState('');
  const plugin = plugins.find(p => p.id === selected) ?? plugins[0];
  if (!plugin) return null;
  return <details className="eidos-plugin-workbench border-t border-current/15 py-3" onToggle={event => setOpened(event.currentTarget.open)}>
    <summary className="cursor-pointer text-sm">{plugins.every(p => p.ui?.presentation === 'native-text') ? ui("文字插件作者工作台") : ui("插件工作台与交互工具")}</summary>
    <p className="my-3 text-xs opacity-65">{ui("主动打开文件工具或调试作者剧本。普通游玩使用原有正文和行动。这里的操作使用当前世界存档；请求模型分析或生成会计入用量。")}</p>
    {plugins.length > 1 && <label className="eidos-plugin-workbench__picker">{ui("选择工具")}<select aria-label={ui("作者文字插件")} value={plugin.id} onChange={event => setSelected(event.target.value)}>{plugins.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>}
    {opened && <div className="eidos-plugin-workbench__surface relative min-h-[640px]">
      <GameplayModSurface pluginId={plugin.id} reading={{ segments, index: Math.max(0, segments.length - 1), displayedText: segments.at(-1)?.text ?? '', complete: true, loading: false }}
        onAdvance={() => {}} onSubmit={() => { throw new Error(ui("请返回游戏主界面继续叙事")); }} />
    </div>}
  </details>;
}
