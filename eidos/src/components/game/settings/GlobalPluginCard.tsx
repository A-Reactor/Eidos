'use client';
import { useInterfaceText } from "@/components/shell/useInterfaceText";

import type { GlobalPluginEntry, GlobalPluginStatus } from '@/lib/game/global-plugins/types';
import { exportGlobalPlugins, removeGlobalPlugin, setGlobalPluginEnabled, setGlobalPluginPreference } from '@/lib/game/global-plugins/library';
import { PluginIntroduction } from '../PluginIntroduction';
import { globalPluginRuntime } from '@/lib/game/global-plugins/runtime';
import { downloadFile } from '@/lib/game/export-records';
import { SettingsField, SettingsToggle } from './SettingsField';

type Execute = (operation: () => unknown, message?: string) => void | Promise<void>;
export function GlobalPluginCard({ entry, status, execute }: { entry: GlobalPluginEntry; status?: GlobalPluginStatus; execute: Execute }) {
  const ui = useInterfaceText();
  const { plugin, preferences, enabled } = entry;
  const state = status?.state ?? (enabled ? 'running' : 'disabled');
  return <article className="eidos-global-plugin-card" data-plugin-id={plugin.id}>
    <header><h3>{plugin.name}</h3>
      <span className="eidos-global-plugin-state" data-state={state}>{state === 'error' ? ui("运行异常") : state === 'running' ? ui("运行中") : ui("已停用")}</span>
    </header>
    <SettingsToggle id={`global-plugin-${plugin.id}`} label={ui("启用{0}", {"0": plugin.name})} checked={enabled} onChange={checked => execute(() => setGlobalPluginEnabled(plugin.id, checked))} />
    {status?.error && <p role="alert" className="eidos-global-plugin-error">{status.error}</p>}
    <details className="eidos-global-plugin-details"><summary>{ui("设置与详情")}</summary>
      <p className="eidos-global-plugin-description">{plugin.description}</p>
      <p className="eidos-settings-description">{ui("版本 ·")}{plugin.release}<br />{ui("作者 ·")}{plugin.author ?? ui("开发者插件")}</p>
      <PluginIntroduction plugin={plugin} />
      {(plugin.settings ?? []).map(setting => {
        const id = `global-preference-${plugin.id}-${setting.id}`, value = preferences[setting.id];
        const change = (next: boolean | number | string) => execute(() => setGlobalPluginPreference(plugin.id, setting.id, next));
        if (setting.type === 'boolean') return <SettingsToggle key={id} id={id} label={ui(setting.label)} hint={ui(setting.description ?? '')} checked={value === true} onChange={change} />;
        return <SettingsField key={id} id={id} label={ui(setting.label)} hint={ui(setting.description ?? '')}>
          {setting.type === 'select' ? <select id={id} value={String(value)} onChange={event => change(event.target.value)}>{setting.options?.map(option => <option key={option}>{option}</option>)}</select>
            : <input id={id} type={setting.type === 'number' ? 'number' : 'text'} value={String(value)} min={setting.min} max={setting.max} step={setting.type === 'number' ? 'any' : undefined} onChange={event => change(setting.type === 'number' ? Number(event.target.value) : event.target.value)} />}
        </SettingsField>;
      })}
      <p className="eidos-settings-description">ID · {plugin.id}<br />{ui("能力 ·")}{plugin.css ? ui("全局样式") : ''}{plugin.css && plugin.script ? ' / ' : ''}{plugin.script ? ui("应用脚本") : ''}</p>
      <div className="eidos-global-plugin-actions">
        <button className="eidos-focus eidos-archive-button" disabled={!enabled} onClick={() => execute(() => globalPluginRuntime.reload(plugin.id))}>{ui("重新加载")}</button>
        <button className="eidos-focus eidos-archive-button" aria-label={ui("导出{0}", {"0": plugin.name})} onClick={() => execute(() => downloadFile(exportGlobalPlugins([plugin]), `${plugin.id}.eidos-global-plugin.json`, 'application/json;charset=utf-8'))}>{ui("导出插件")}</button>
        <button className="eidos-focus eidos-archive-button" onClick={() => execute(() => removeGlobalPlugin(plugin.id), ui("插件已移除，私有数据保留在本机"))}>{ui("移除插件")}</button>
      </div>
      <details className="eidos-global-plugin-source"><summary>{ui("查看开发者代码")}</summary>{plugin.css && <pre aria-label={`${plugin.name} CSS`}>{plugin.css}</pre>}{plugin.script && <pre aria-label={`${plugin.name} JavaScript`}>{plugin.script}</pre>}</details>
    </details>
  </article>;
}
