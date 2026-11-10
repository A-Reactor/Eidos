'use client';
import { useInterfaceText } from "@/components/shell/useInterfaceText";

import { useState, useSyncExternalStore } from 'react';
import { FileImportCard } from '@/components/ui/FileImportCard';
import { downloadFile } from '@/lib/game/export-records';
import { getGlobalPluginLibrary, getServerGlobalPluginLibrary, subscribeGlobalPlugins, installGlobalPlugins, exportGlobalPlugins, GLOBAL_PLUGIN_LIBRARY_KEY } from '@/lib/game/global-plugins/library';
import { parseGlobalPluginFile } from '@/lib/game/global-plugins/manifest';
import { globalPluginRuntime, getServerGlobalPluginStatuses } from '@/lib/game/global-plugins/runtime';
import { PAPER_LAB_PLUGIN } from '@/lib/game/global-plugins/examples';
import { GlobalPluginCard } from './GlobalPluginCard';

export function GlobalPluginManager() {
  const ui = useInterfaceText();
  const library = useSyncExternalStore(subscribeGlobalPlugins, getGlobalPluginLibrary, getServerGlobalPluginLibrary);
  const statuses = useSyncExternalStore(globalPluginRuntime.subscribe, globalPluginRuntime.getSnapshot, getServerGlobalPluginStatuses);
  const [error, setError] = useState(''), [message, setMessage] = useState('');
  const execute = async (operation: () => unknown, success = '') => {
    setError(''); setMessage('');
    try { await operation(); setMessage(success); } catch (cause) { setError(cause instanceof Error ? cause.message : ui("插件操作失败")); }
  };
  const testInstalled = library.entries.some(entry => entry.plugin.id === PAPER_LAB_PLUGIN.id);
  return <section className="eidos-settings-page eidos-global-plugins" aria-label={ui("全局插件管理")}>
    <h2>{ui("全局插件")}</h2><p className="eidos-settings-description">{ui("跨世界的界面与逻辑扩展，即时生效。")}</p>
    <p className="eidos-global-plugin-trust">{ui("脚本拥有应用权限，仅启用可信插件。")}</p>
    <div className="eidos-global-plugin-toolbar">
      <button className="eidos-focus eidos-archive-button" data-variant="primary" disabled={Boolean(library.error) || testInstalled} onClick={() => execute(() => installGlobalPlugins([PAPER_LAB_PLUGIN]), ui("测试插件已安装，请主动启用"))}>{testInstalled ? ui("已安装测试插件") : ui("安装测试插件")}</button>
      <button className="eidos-focus eidos-archive-button" disabled={Boolean(library.error) || !library.entries.length} onClick={() => execute(() => downloadFile(exportGlobalPlugins(library.entries.map(entry => entry.plugin)), 'eidos-global-plugins.json', 'application/json;charset=utf-8'))}>{ui("导出全部插件")}</button>
    </div>
    <FileImportCard label={ui("导入全局插件")} inputLabel={ui("全局插件文件")} accept=".json,application/json" disabled={Boolean(library.error)}
      heading={ui("导入全局插件")} description={ui("拖入 JSON，或点击选择文件")} hint={ui("导入或更新后默认停用，可在下方启用。")} onFiles={async files => {
      const plugins = parseGlobalPluginFile(await files[0].text());
      installGlobalPlugins(plugins); setError(''); setMessage(ui("已导入 {0} 个插件，处于停用状态", {"0": plugins.length}));
    }} />
    {library.error && <div role="alert" className="eidos-global-plugin-error"><p>{library.error}</p><button className="eidos-focus eidos-archive-button" onClick={() => execute(() => downloadFile(localStorage.getItem(GLOBAL_PLUGIN_LIBRARY_KEY) ?? '', 'global-plugins-original.txt', 'text/plain;charset=utf-8'))}>{ui("导出原始数据")}</button></div>}
    {error && <p role="alert" className="eidos-global-plugin-error">{error}</p>}{message && <p role="status" className="eidos-settings-description">{message}</p>}
    {!library.entries.length && !library.error && <div className="eidos-global-plugin-empty"><span aria-hidden="true">＋</span><h3>{ui("还没有全局插件")}</h3><p>{ui("可先安装纸页实验室，体验全局排版和快捷行动。")}</p></div>}
    <div className="eidos-global-plugin-list">{library.entries.map(entry => <GlobalPluginCard key={entry.plugin.id} entry={entry} status={statuses[entry.plugin.id]} execute={execute} />)}</div>
  </section>;
}
