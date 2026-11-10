"use client";
import { useInterfaceText } from "@/components/shell/useInterfaceText";

import type { CSSProperties } from 'react';
import type { GameSettings } from '@/lib/game/types';
import { INTERFACE_PALETTES, interfaceColors } from '@/lib/ui/interface-palette';

export function PaletteSetting({ settings, onChange, english }: { settings: GameSettings; onChange: (patch: Partial<GameSettings>) => void; english: boolean }) {
  const ui = useInterfaceText();
  const mode = settings.interfaceTheme;
  const colors = interfaceColors(mode, settings.interfacePalette, settings.interfaceCustomColors);
  const updateColor = (key: 'background' | 'surface' | 'accent', value: string) => onChange({ interfaceCustomColors: { ...settings.interfaceCustomColors, [mode]: { ...settings.interfaceCustomColors[mode], [key]: value } } });
  return <div className="eidos-palette-setting">
    <p className="mb-4 text-sm">{english ? 'Color palette' : ui("配色套装")}</p>
    <div role="group" aria-label={english ? 'Color palette' : ui("配色套装")} className="eidos-palette-choices">
      {[...INTERFACE_PALETTES, { id: 'custom' as const, name: ui("自定义"), en: 'Custom', ...settings.interfaceCustomColors }].map(palette => {
        const value = palette[mode];
        return <button type="button" className="eidos-focus" aria-pressed={palette.id === settings.interfacePalette} key={palette.id} onClick={() => onChange({ interfacePalette: palette.id })}>
          <span className="eidos-palette-circle" aria-hidden="true" style={{ background: `conic-gradient(${value.accent} 0deg 120deg, ${value.surface} 120deg 240deg, ${value.background} 240deg 360deg)` }} />
          <span>{english ? palette.en : palette.name}</span>
        </button>;
      })}
    </div>
    {settings.interfacePalette === 'custom' && <div className="eidos-palette-custom">{(['background', 'surface', 'accent'] as const).map((key, i) => <label key={key}>
      <span>{(english ? ['Background', 'Surface', 'Accent'] : [ui("背景"), ui("表面"), ui("强调色")])[i]}</span>
      <input type="color" aria-label={`${english ? 'Custom' : ui("自定义")}${(english ? [' background', ' surface', ' accent'] : [ui("背景"), ui("表面"), ui("强调色")])[i]}`} value={colors[key]}
        onInput={event => updateColor(key, event.currentTarget.value)} onChange={event => updateColor(key, event.target.value)} />
      <input className="eidos-palette-hex" type="text" aria-label={`${english ? 'Custom' : ui("自定义")}${(english ? [' background hex', ' surface hex', ' accent hex'] : [ui("背景色值"), ui("表面色值"), ui("强调色色值")])[i]}`}
        value={settings.interfaceCustomColors[mode][key]} maxLength={7} pattern="#[0-9a-fA-F]{6}" spellCheck={false}
        onChange={event => updateColor(key, event.target.value)} onBlur={() => { if (!/^#[0-9a-f]{6}$/i.test(settings.interfaceCustomColors[mode][key])) updateColor(key, colors[key]); }} />
    </label>)}</div>}
    <div className="eidos-settings-sample" style={{ '--sample-bg': colors.background, '--sample-ink': colors.ink, '--sample-muted': colors.muted, '--sample-accent': colors.accent } as CSSProperties}>
      <small>{english ? 'Reading preview' : ui("阅读预览")}</small><p style={{ fontSize: [14, 18, 22, 26][settings.fontSize - 1] }}>{english ? 'Night falls as you open the door to the city.' : ui("夜色落下，你推开通往城市的门。")}</p>
    </div>
  </div>;
}
