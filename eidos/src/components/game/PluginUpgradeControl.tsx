'use client';
import { useInterfaceText } from "@/components/shell/useInterfaceText";

import { useEffect, useRef, useState } from 'react';
import type { GameplayPlugin } from '@/lib/game/plugins/types';
import { parsePluginFile } from '@/lib/game/plugins/manifest';
import { previewPluginUpgrade, applyPluginUpgrade, type PluginUpgradePreview } from '@/lib/game/plugins/upgrade';
import { createStreamRequestScope, isCurrentStreamContinuation } from '@/lib/game/stream-lifecycle';
import { useGameStore } from '@/store/game-store';
import { FileImportCard } from '@/components/ui/FileImportCard';
import { pluginUpdateCandidates } from '@/lib/game/plugins/update-candidates';
import { PLUGIN_LIBRARY_CHANGED, PLUGIN_LIBRARY_KEY, pluginContentKey } from '@/lib/game/plugins/library';

export function PluginUpgradeControl({ plugin }: { plugin: GameplayPlugin }) {
  const ui = useInterfaceText();
  const [preview, setPreview] = useState<PluginUpgradePreview | null>(null);
  const [status, setStatus] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const applying = useRef(false);
  const [available, setAvailable] = useState<ReturnType<typeof pluginUpdateCandidates>>({ candidates: [], error: undefined });
  const preparing = useRef<symbol | null>(null);
  useEffect(() => {
    const refresh = () => setAvailable(pluginUpdateCandidates(plugin));
    const storage = (event: StorageEvent) => { if (event.key === null || event.key === PLUGIN_LIBRARY_KEY) refresh(); };
    refresh(); window.addEventListener(PLUGIN_LIBRARY_CHANGED, refresh); window.addEventListener('storage', storage);
    return () => { window.removeEventListener(PLUGIN_LIBRARY_CHANGED, refresh); window.removeEventListener('storage', storage); preparing.current = null; };
  }, [plugin]);
  async function prepare(imported: GameplayPlugin) {
    const ticket = Symbol('plugin-preview'), scope = createStreamRequestScope(useGameStore.getState());
    preparing.current = ticket;
    setBusy(true); setPreview(null); setError(''); setStatus('');
    try {
      const next = await previewPluginUpgrade(useGameStore, imported);
      if (ticket !== preparing.current || !isCurrentStreamContinuation(scope, useGameStore.getState())) throw new Error('世界或分支已变化，请重新预览');
      setPreview(next);
    } finally { if (ticket === preparing.current) setBusy(false); }
  }
  return <div className="eidos-plugin-upgrade" aria-label={ui("{0}版本更新", {"0": plugin.name})}>
    <p className="eidos-plugin-reference__description">{ui("当前版本：")}{plugin.release ?? ui("未标注发行版")} {ui("· 进度格式")}{plugin.stateVersion ?? 1}</p>
    <p className="text-xs leading-6 opacity-65">{ui("仅更新相同 ID 的模组，不会换成其他模组；先预览兼容性，再应用。版本信息来自本机文件与当前应用。")}</p>
    {available.candidates.map((candidate, index) => {
      const release = candidate.plugin.release ?? `v${candidate.plugin.version}`;
      const multiple = available.candidates.filter(other => other.source === candidate.source).length > 1;
      const label = `${candidate.source} · ${release}${multiple ? ` · #${index + 1}` : ''}`;
      return <div key={`${candidate.source}:${pluginContentKey(candidate.plugin)}`} className="my-3 text-xs leading-6">
        <p>{label} · {candidate.comparison === 1 ? ui("较新发行版") : candidate.comparison === -1 ? ui("较早发行版") : ui("内容与当前版本不同")}</p>
        <button type="button" className="eidos-focus eidos-plugin-secondary" disabled={busy}
          aria-label={multiple ? `${ui("预览")} ${label}` : undefined}
          onClick={() => void prepare(candidate.plugin).catch(cause => setError(cause instanceof Error ? cause.message : '更新预览失败'))}>{ui("预览")}{candidate.source}{ui("版本")}</button>
      </div>;
    })}
    {available.error && <p role="status" className="text-xs">{available.error}</p>}
    <FileImportCard label={ui("更新{0}", {"0": plugin.name})} inputLabel={ui("{0}新版文件", {"0": plugin.name})} accept=".json,application/json" disabled={busy}
      heading={ui("导入模组更新")} description={ui("拖入或选择新版 JSON")} hint={ui("先检查进度兼容性，再应用更新。")}
      onFiles={async files => {
        const scope = createStreamRequestScope(useGameStore.getState());
        const imported = parsePluginFile(JSON.parse(await files[0].text())).find(p => p.id === plugin.id);
        if (!isCurrentStreamContinuation(scope, useGameStore.getState())) throw new Error('世界或分支已变化，请重新选择文件');
        if (!imported) throw new Error('请选择与当前模组 ID 相同的新版文件');
        await prepare(imported);
      }} />
    {preview && <div role="status">
      <p>{ui("更新为")}{preview.target.release ?? preview.target.name} {ui("· 进度格式")}{preview.previous.stateVersion ?? 1} → {preview.target.stateVersion ?? 1}</p>
      <p>{ui("介绍图片：")}{preview.target.introduction?.images.length ?? 0} {ui("张。保留其他已安装模组，继续使用当前世界与周目。")}</p>
      <p>{preview.migrationCount ? ui("将执行 {0} 步作者迁移。", {"0": preview.migrationCount}) : ui("沿用当前进度。")}{ui("更新不会新增行动记录。")}</p>
      <button type="button" className="eidos-focus eidos-plugin-secondary" disabled={busy} onClick={async () => {
        if (applying.current) return;
        applying.current = true; setBusy(true); setError('');
        try {
          await applyPluginUpgrade(useGameStore, preview);
          setPreview(null); setStatus('模组已更新，进度已保存。');
        } catch (cause) { setError(cause instanceof Error ? cause.message : '模组更新失败'); }
        finally { applying.current = false; setBusy(false); }
      }}>{ui("应用此更新")}</button>
      <button type="button" className="eidos-focus eidos-plugin-secondary" disabled={busy} onClick={() => setPreview(null)}>{ui("取消")}</button>
    </div>}
    {status && <p role="status">{status}</p>}
    {error && <p role="alert">{error}</p>}
  </div>;
}
