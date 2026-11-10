
import { useInterfaceText } from "@/components/shell/useInterfaceText";
import type { BriefEdit, WorldCreationBrief } from '@/lib/game/world-creation-brief';
import type { SourceStyleSample } from '@/lib/game/source-reconstruction/types';

export function SourceStylePicker({ brief, candidates, disabled, onEdit }: { brief: WorldCreationBrief; candidates: SourceStyleSample[]; disabled: boolean; onEdit: (edit: BriefEdit) => void }) {
  const ui = useInterfaceText();
  if (brief.origin !== 'source') return null;
  const reference = brief.sourceStyle ?? { traits: '', samples: [] };
  return <fieldset disabled={disabled} className="min-w-0 space-y-3 mb-5">
    <legend className="mb-2 text-sm text-[color:var(--eidos-archive-ink)]">{ui("文风来源")}</legend>
    <div className="grid grid-cols-2 gap-3">
      {([{ id: 'source', label: ui("遵照原文文风") }, { id: 'preset', label: ui("自由选择文风") }] as const).map(choice =>
        <button key={choice.id} type="button" aria-pressed={brief.styleChoice === choice.id} onClick={() => onEdit({ styleChoice: choice.id })}
          className="eidos-focus eidos-world-create__choice flex items-center justify-between gap-2 px-3 py-3 text-left text-xs disabled:opacity-40">
          {ui(choice.label)}<span aria-hidden="true">{brief.styleChoice === choice.id ? '✓' : '+'}</span>
        </button>)}
    </div>
    {brief.styleChoice === 'source' && <>
      <p className="text-xs leading-6 text-[color:var(--eidos-archive-muted)]">{reference.traits}</p>
      <p className="text-xs text-[color:var(--eidos-archive-muted)]">{ui("选择参考段落 · 最多 3 段")}</p>
      {candidates.filter(s => s.safe).map(sample => {
        const checked = reference.samples.some(s => s.id === sample.id);
        return <button type="button" key={sample.id} aria-label={ui("参考段落：{0}", {"0": sample.text})} aria-pressed={checked} disabled={disabled || (!checked && reference.samples.length >= 3)}
          className="eidos-focus eidos-world-create__choice flex w-full items-start gap-3 px-4 py-3 text-left text-sm leading-7 disabled:opacity-40"
          onClick={() => onEdit({ styleChoice: 'source', sourceStyle: { ...reference, samples: checked ? reference.samples.filter(s => s.id !== sample.id) : [...reference.samples, sample] } })}>
          <span aria-hidden="true" className="shrink-0">{checked ? '✓' : '+'}</span><span>{sample.text}</span>
        </button>;
      })}
    </>}
  </fieldset>;
}
