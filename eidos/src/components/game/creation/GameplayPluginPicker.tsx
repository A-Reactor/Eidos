"use client";
import { useInterfaceText } from "@/components/shell/useInterfaceText";


import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import catalog from "@/lib/game/plugins/catalog.json";
import type { GameplayPlugin } from "@/lib/game/plugins/types";
import { downloadPluginFile, loadPluginLibrary, mergePluginLibrary, parsePluginLibraryFile, PLUGIN_LIBRARY_CHANGED, pluginContentKey, savePluginLibrary } from '@/lib/game/plugins/library';
import { GameplayDesignCheck } from './GameplayDesignCheck';
import { stableRecordJSON } from '@/lib/ai/prompt-layout';
import { InfoChoice } from '@/components/ui/InfoChoice';
import { CreationImportZone } from './CreationImportZone';
import { InteractionDialog } from '@/components/ui/InteractionDialog';
import { PluginIntroduction } from '../PluginIntroduction';
import { BUILTIN_GAMEPLAY_PLUGINS } from '@/lib/game/plugins/builtins';

interface Props {
  selected: string[]; custom: GameplayPlugin[]; disabled: boolean; preset?: GameplayPlugin[];
  onSelect: (ids: string[]) => void; onCustom: (plugins: GameplayPlugin[]) => void;
  onRemovePreset?: (content: string) => void;
}

const fileLabel = (plugin: GameplayPlugin) => `${plugin.id}.json · ${plugin.release ? (/^\d/.test(plugin.release) ? 'v' : '') + plugin.release : 'v' + plugin.version}`;
function pluginChoices(library: GameplayPlugin[], preset: GameplayPlugin[], custom: GameplayPlugin[]) {
  const versions = new Map<string, GameplayPlugin>();
  for (const plugin of [...library, ...preset, ...custom]) {
    const key = pluginContentKey(plugin);
    if (!versions.has(key)) versions.set(key, plugin);
  }
  const counts = new Map<string, number>(), indices = new Map<string, number>();
  for (const plugin of versions.values()) {
    const label = fileLabel(plugin);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return [...catalog.flatMap(entry => BUILTIN_GAMEPLAY_PLUGINS.filter(plugin => plugin.id === entry.id)
    .map(plugin => ({ key: plugin.id, plugin, file: fileLabel(plugin), builtin: true }))),
  ...[...versions].map(([key, plugin]) => {
    const label = fileLabel(plugin), index = (indices.get(label) ?? 0) + 1;
    indices.set(label, index);
    return { key, plugin, file: counts.get(label)! > 1 ? `${label} · #${index}` : label, builtin: false };
  })];
}

function chooseVersions(custom: GameplayPlugin[], choices: GameplayPlugin[]) {
  // Replacing a version keeps the manifest ID and its position; only the library can have duplicate IDs.
  const byId = new Map(custom.map(plugin => [plugin.id, plugin]));
  for (const plugin of choices) byId.set(plugin.id, plugin);
  return [...byId.values()];
}
export function GameplayPluginPicker(props: Props) {
  const ui = useInterfaceText();
  const { selected, custom, disabled, onSelect, onCustom } = props;
  const latest = useRef(props);
  useLayoutEffect(() => { latest.current = props; }, [props]);
  const mounted = useRef(false);
  const [library, setLibrary] = useState<GameplayPlugin[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [introId, setIntroId] = useState<string | null>(null);
  const [unsaved, setUnsaved] = useState<GameplayPlugin[]>([]);
  useEffect(() => {
    mounted.current = true;
    const refresh = () => { const saved = loadPluginLibrary(); setLibrary(saved.plugins); if (saved.error) setError(saved.error); };
    refresh(); window.addEventListener('storage', refresh); window.addEventListener(PLUGIN_LIBRARY_CHANGED, refresh);
    return () => { mounted.current = false; window.removeEventListener('storage', refresh); window.removeEventListener(PLUGIN_LIBRARY_CHANGED, refresh); };
  }, []);
  const available = useMemo(() => pluginChoices(library, [...props.preset ?? [], ...unsaved], custom), [library, props.preset, unsaved, custom]);
  const chosen = useMemo(() => new Map(custom.map(plugin => [plugin.id, pluginContentKey(plugin)])), [custom]);
  const checkedPlugins = custom.filter(plugin => selected.includes(plugin.id));
  const busy = disabled || reading;
  const intro = available.find(choice => choice.key === introId);
  const applyImport = (imported: GameplayPlugin[]) => {
    const live = latest.current;
    if (!mounted.current || live.disabled) return;
    const merged = chooseVersions(live.custom, imported);
    const ids = [...new Set([...live.selected, ...imported.map(plugin => plugin.id)])];
    const saved = loadPluginLibrary();
    let warning = saved.error;
    if (!warning) {
      const nextLibrary = mergePluginLibrary(saved.plugins, imported);
      try { savePluginLibrary(nextLibrary); setLibrary(nextLibrary); }
      catch (cause) { warning = cause instanceof Error ? cause.message : '本机插件库保存失败'; }
    }
    if (warning) setUnsaved(previous => mergePluginLibrary(previous, imported));
    live.onCustom(merged); live.onSelect(ids); setError(warning ?? null);
  };
  const importFiles = async (files: File[]) => {
    setReading(true);
    try {
      const file = files[0];
      const imported = parsePluginLibraryFile(JSON.parse(await file.text()));
      if (!mounted.current || latest.current.disabled) return;
      applyImport(imported);
    } finally { if (mounted.current) setReading(false); }
  };
  const remove = (plugin: GameplayPlugin, content: string) => {
    const saved = loadPluginLibrary();
    let warning = saved.error;
    if (!warning) {
      const next = saved.plugins.filter(item => pluginContentKey(item) !== content);
      try { savePluginLibrary(next); setLibrary(next); }
      catch (cause) { warning = cause instanceof Error ? cause.message : '插件库移除失败'; }
    }
    setUnsaved(previous => previous.filter(item => pluginContentKey(item) !== content));
    props.onRemovePreset?.(content);
    if (chosen.get(plugin.id) === content) {
      onCustom(custom.filter(item => item.id !== plugin.id)); onSelect(selected.filter(id => id !== plugin.id));
    }
    setError(warning ?? null);
  };
  return <div className="eidos-plugin-picker space-y-4">
    <p className="text-xs leading-6 opacity-65">{ui("选择世界的玩法。导入的插件会保存在本机，可在其他世界中重新选择。")}</p>
    <p className="text-xs leading-6 opacity-65">{ui("预设和本机插件库的版本并列显示。同一个插件每个世界启用一个版本；填充预设时保留原来的选择。")}</p>
    <div className="grid grid-cols-2 gap-2">
      {available.map(({ key, plugin, file, builtin }) => {
        const active = selected.includes(plugin.id) && (builtin || chosen.get(plugin.id) === key);
        const label = builtin ? plugin.name : `${plugin.name} · ${file}`;
        return <InfoChoice key={key} label={plugin.name} accessibleLabel={label} active={active} disabled={busy} infoLabel={ui("查看{0}介绍", {"0": label})}
          onInfo={() => setIntroId(key)} onSelect={() => {
            if (!active && !builtin && chosen.get(plugin.id) !== key) onCustom(chooseVersions(custom, [plugin]));
            onSelect(active ? selected.filter(id => id !== plugin.id) : [...new Set([...selected, plugin.id])]); setError(null);
          }}>{file}</InfoChoice>;
      })}
    </div>
    <CreationImportZone label={ui("拖入或选择玩法插件")} inputLabel={ui("导入玩法插件 JSON")} accept=".json,application/json" disabled={busy}
      heading={ui("导入玩法插件")} description={ui("拖放 JSON 文件到此处，或点击选择文件")}
      hint={ui("导入后会保存在本机插件库，可在其他世界中重新选择。")} onFiles={importFiles} />
    {error && <p role="alert" className="text-xs text-[color:var(--eidos-accent)]">{error}</p>}
    {intro && <InteractionDialog title={ui("{0}介绍", {"0": intro.plugin.name})} onClose={() => setIntroId(null)}>
      <p className="text-sm leading-7 whitespace-pre-wrap">{intro.plugin.description}</p>
      <p className="mt-2 text-xs opacity-65">{intro.file}</p>
      <div className="flex flex-wrap gap-1 mt-2">{intro.plugin.tags.map(tag => <span key={tag} className="eidos-plugin-tag">{tag}</span>)}</div>
      <PluginIntroduction key={intro.key} plugin={intro.plugin} />
      {!intro.builtin && <div className="flex gap-3 mt-4">
        <button type="button" className="eidos-focus eidos-plugin-secondary" disabled={busy} aria-label={ui("导出插件：{0}", {"0": intro.plugin.name})} onClick={async () => {
          try { await downloadPluginFile([intro.plugin]); setError(null); } catch (cause) { setError(cause instanceof Error ? cause.message : ui("插件导出失败")); }
        }}>{ui("导出 JSON")}</button>
        <button type="button" className="eidos-focus eidos-plugin-secondary" disabled={busy} aria-label={ui("移除插件：{0}", {"0": intro.plugin.name})} onClick={() => { remove(intro.plugin, intro.key); setIntroId(null); }}>{ui("移除")}</button>
      </div>}
      <button className="eidos-focus eidos-plugin-secondary" onClick={() => setIntroId(null)}>{ui("关闭介绍")}</button>
    </InteractionDialog>}
    {checkedPlugins.length > 0 && <GameplayDesignCheck key={stableRecordJSON(checkedPlugins)} plugins={checkedPlugins} disabled={busy} />}
  </div>;
}
