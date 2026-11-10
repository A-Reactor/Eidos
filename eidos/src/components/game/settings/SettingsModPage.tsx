'use client';
import { useInterfaceText } from "@/components/shell/useInterfaceText";

import { SettingsField, SettingsToggle } from './SettingsField';
import type { GameplayPlugin } from '@/lib/game/plugins/types';
import { pluginPreferences, type ModPreferences, type ModPreferenceValue } from '@/lib/game/plugins/preferences';
import { SettingsModDetails } from './SettingsModDetails';
import { PluginIntroduction } from '../PluginIntroduction';

export function SettingsModPage({ plugin, preferences, onChange }: { plugin: GameplayPlugin; preferences: ModPreferences; onChange: (id: string, value: ModPreferenceValue) => void }) {
  const ui = useInterfaceText();
  const values = pluginPreferences(plugin, preferences);
  return <section className="eidos-settings-page eidos-plugin-page" aria-label={plugin.name}>
    <h2 className="break-words">{plugin.name}</h2><p className="eidos-settings-description whitespace-pre-wrap break-words">{plugin.description}</p>
    {!!plugin.tags.length && <p className="mb-4 text-xs opacity-60">{plugin.tags.join(' · ')}</p>}
    <PluginIntroduction plugin={plugin} />
    {(plugin.settings ?? []).map(setting => {
      const id = `mod-setting-${plugin.id}-${setting.id}`;
      if (setting.type === 'boolean') return <SettingsToggle key={setting.id} id={id} label={ui(setting.label)} hint={ui(setting.description ?? '')} checked={values[setting.id] === true} onChange={value => onChange(setting.id, value)} />;
      return <SettingsField key={setting.id} id={id} label={ui(setting.label)} hint={ui(setting.description ?? '')}>
        {setting.type === 'select' ? <select id={id} value={String(values[setting.id])} onChange={e => onChange(setting.id, e.target.value)}>{setting.options?.map(option => <option key={option}>{option}</option>)}</select>
          : <input id={id} type={setting.type === 'number' ? 'number' : 'text'} value={String(values[setting.id])} min={setting.min} max={setting.max} step={setting.type === 'number' ? 'any' : undefined} onChange={e => onChange(setting.id, setting.type === 'number' ? Number(e.target.value) : e.target.value)} />}
      </SettingsField>;
    })}
    {!plugin.settings?.length && <p className="eidos-settings-description">{ui("此模组没有额外偏好设置。")}</p>}
    {!!plugin.settings?.length && <button className="eidos-focus eidos-settings-reset" onClick={() => plugin.settings?.forEach(setting => onChange(setting.id, setting.default))}>{ui("恢复此模组默认设置")}</button>}
    <SettingsModDetails plugin={plugin} />
  </section>;
}
