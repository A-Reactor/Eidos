
import { useInterfaceText } from "@/components/shell/useInterfaceText";
import { isRecord } from '@/lib/game/cards/types';
import { cardInitialization } from '@/lib/game/cards/initialization';
import type { ParsedCard } from '@/lib/game/cards/types';

function leafPaths(value: unknown, prefix = ''): string[] {
  if (!isRecord(value) && !Array.isArray(value)) return prefix ? [prefix] : [];
  if (Array.isArray(value) && value.length === 2 && typeof value[1] === 'string') return leafPaths(value[0], `${prefix}[0]`);
  return Object.entries(value).flatMap(([key, child]) => {
    const path = Array.isArray(value) ? `${prefix}[${key}]` : /^[^.\[\]"'\\]+$/.test(key) ? `${prefix ? prefix + '.' : ''}${key}` : `${prefix}[${JSON.stringify(key)}]`;
    return leafPaths(child, path);
  });
}
export function CardVariableChoices({ card, selected, onChange, disabled }: { card: ParsedCard; selected: string[]; onChange: (paths: string[]) => void; disabled: boolean }) {
  const ui = useInterfaceText();
  let initial;
  try { initial = cardInitialization(card); } catch { return null; }
  if (!initial) return null;
  const paths = leafPaths(initial.variables).slice(0, 64);
  return <fieldset className="space-y-2 text-xs"><legend>{ui("公开变量面板")}</legend>
    <p className="text-zinc-400">{ui("仅勾选玩家可以查看的变量。选择保存在挂载配置，原卡保持原样。")}</p>
    <div className="max-h-36 space-y-1 overflow-auto">{paths.map(path => <label key={path} className="flex items-center gap-2"><input type="checkbox" aria-label={ui("公开变量 {0}", {"0": path})} disabled={disabled || (!selected.includes(path) && selected.length >= 32)} checked={selected.includes(path)} onChange={e => onChange(e.target.checked ? [...selected, path] : selected.filter(p => p !== path))} />{path}</label>)}</div>
  </fieldset>;
}
