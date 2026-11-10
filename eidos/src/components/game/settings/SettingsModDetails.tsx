'use client';
import { useInterfaceText } from "@/components/shell/useInterfaceText";


import { useState } from 'react';
import type { GameplayPlugin } from '@/lib/game/plugins/types';
import { downloadPluginFile } from '@/lib/game/plugins/library';
import { PluginUpgradeControl } from '../PluginUpgradeControl';

/** Keep author material opt-in: it can disclose undiscovered rules and story details. */
export function SettingsModDetails({ plugin }: { plugin: GameplayPlugin }) {
  const ui = useInterfaceText();
  const [error, setError] = useState<string | null>(null);
  return <div className="mt-6 min-w-0 border-t border-current/15 pt-4">
    {plugin.rules.length > 0 && <details className="eidos-plugin-author mb-5">
      <summary>{ui("规则说明 · 可能包含未发现的设定")}</summary>
      <div className="eidos-plugin-rules mt-4">{plugin.rules.map(rule => {
        const changes = Object.entries(rule.resourceChanges ?? {}).filter(([id]) => plugin.resources?.[id]?.visible)
          .map(([id, delta]) => `${plugin.resources![id].name} ${delta > 0 ? '+' : ''}${delta}${plugin.resources![id].unit}`);
        return <article className="eidos-plugin-rule" key={rule.id}><h4>{rule.description}</h4>
          <p>{changes.join(' · ') || ui("推进剧情状态")}<span> · {rule.once ? ui("单次生效") : ui("可重复")}</span></p></article>;
      })}</div>
    </details>}
    <details className="eidos-plugin-author mb-5"><summary>{ui("创作说明与完整清单 · 可能包含未发现的设定")}</summary>
      <div className="mt-4">{(['creation', 'action', 'review'] as const).map((phase, index) => <section key={phase}><h4>{[ui("世界生成说明"), ui("行动叙事说明"), ui("结果审核说明")][index]}</h4>
        <p>{plugin.prompts[phase] || ui("此阶段没有额外说明。")}</p></section>)}
        <details className="eidos-plugin-manifest"><summary>{ui("完整插件 JSON")}</summary><pre>{JSON.stringify(plugin, null, 2)}</pre></details>
      </div>
    </details>
    <button type="button" className="eidos-focus eidos-plugin-secondary" aria-label={ui("导出{0} JSON", {"0": plugin.name})} onClick={async () => {
      try { await downloadPluginFile([plugin]); setError(null); } catch (cause) { setError(cause instanceof Error ? cause.message : ui("插件导出失败")); }
    }}>{ui("导出插件 JSON")}</button>
    <PluginUpgradeControl plugin={plugin} />
    {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
  </div>;
}
