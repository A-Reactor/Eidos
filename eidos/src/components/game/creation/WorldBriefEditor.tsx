
import { useInterfaceText } from "@/components/shell/useInterfaceText";
import { FieldPin } from './FieldPin';
import { WORLD_BRIEF_FIELDS, WORLD_BRIEF_LABELS, type BriefEdit, type FieldPolicy, type WorldCreationBrief } from '@/lib/game/world-creation-brief';

export function WorldBriefEditor({ brief, disabled, onEdit }: { brief: WorldCreationBrief; disabled: boolean; onEdit: (edit: BriefEdit) => void }) {
  const ui = useInterfaceText();
  return <div className="space-y-5">{WORLD_BRIEF_FIELDS.map(key => {
    const field = brief.fields[key], label = WORLD_BRIEF_LABELS[key];
    return <fieldset key={key} disabled={disabled} className="space-y-2">
      <legend className="flex items-center gap-1 text-sm text-[color:var(--eidos-archive-ink)]">
        {label}<FieldPin label={label} pinned={field.required} disabled={disabled} onChange={required => onEdit({ field: key, required })} />
      </legend>
      <select aria-label={ui("{0}来源", {"0": label})} value={field.policy} onChange={e => onEdit({ field: key, policy: e.target.value as FieldPolicy })} className="eidos-world-create__input w-full px-3 py-2">
        {brief.origin === 'source' && <option value="source">{ui("遵照原文")}</option>}
        <option value="custom">{ui("自行填写")}</option><option value="generate">{ui("由 AI 补全")}</option>
      </select>
      <textarea aria-label={label} value={field.text} onChange={e => onEdit({ field: key, text: e.target.value })} rows={key === 'name' ? 1 : 4} className="eidos-world-create__input w-full p-4 resize-y" />
    </fieldset>;
  })}{brief.issues.map((issue, i) => <div role={issue.blocking ? 'alert' : undefined} key={i} className="eidos-world-create__summary p-4 text-sm leading-7"><p>{issue.message}</p>{issue.blocking && <button type="button" className="eidos-focus eidos-world-create__ghost mt-2" disabled={disabled} onClick={() => onEdit({ resolveIssue: i })}>{ui("已调整生成稿，按当前选择处理")}</button>}</div>)}</div>;
}
