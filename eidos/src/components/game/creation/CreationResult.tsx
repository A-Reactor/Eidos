"use client";
import { useInterfaceText } from "@/components/shell/useInterfaceText";


import { ArchiveScreen } from "@/components/ui/ArchiveScreen";
import type { WorldDefinition } from "@/lib/game/types";

interface Props {
  world: WorldDefinition;
  entering: boolean;
  sandboxMode: boolean;
  storageError: string | null;
  error: string | null;
  onExport: () => void;
  onBack: () => void;
  onEdit: () => void;
  onEnter: () => Promise<void>;
}

export function CreationResult({ world, entering, sandboxMode, storageError, error, onExport, onBack, onEdit, onEnter }: Props) {
  const ui = useInterfaceText();
  return <ArchiveScreen className="eidos-world-create eidos-world-create--complete" title={world.name} subtitle={world.subtitle} onBack={() => { if (!entering) onBack(); }}>
    <section aria-label={ui("生成结果内容")} tabIndex={0} className="eidos-focus min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-6 md:px-8">
      <div className="eidos-world-create__summary mx-auto w-full max-w-3xl border p-5 md:p-6">
        {world.creationWarnings?.map((warning, i) => <p role="status" className="mb-3 text-sm" key={i}>{warning}</p>)}
        <h3 className="text-sm font-medium">{ui("世界概况")}</h3>
        <dl aria-label={ui("世界基本信息")} className="mt-4 grid grid-cols-3 gap-3 border-b border-current/20 pb-5 text-center">
          {[[ui("区域"), Object.keys(world.regions).length], ["NPC", Object.keys(world.npcs).length], [ui("线索"), world.clues.length]].map(([label, count]) => <div key={label}>
            <dt className="text-xs opacity-60">{label}</dt>
            <dd className="mt-1 text-2xl font-light">{count}</dd>
          </div>)}
        </dl>
        <p className="mt-5 text-sm text-[color:var(--eidos-archive-muted)] leading-8 whitespace-pre-wrap break-words">{world.overview}</p>
      </div>
    </section>
    <footer aria-label={ui("生成结果操作栏")} className="eidos-world-create__footer shrink-0 max-h-[35dvh] overflow-y-auto border-t border-current/20 px-4 py-3 md:px-6">
      {storageError && <p role="alert" className="mb-3 text-sm text-[color:var(--eidos-accent)]">{storageError}</p>}
      {error && <p role="alert" className="mb-3 text-sm text-[color:var(--eidos-accent)]">{error}</p>}
      <div className="mx-auto flex max-w-3xl flex-wrap justify-center gap-2 md:gap-3">
        <button onClick={onExport} className="eidos-world-create__ghost eidos-focus border px-4 py-2 text-sm">{ui("导出生成材料")}</button>
        <button disabled={entering} onClick={onBack} className="eidos-world-create__ghost eidos-focus border px-4 py-2 text-sm disabled:opacity-40">{ui("返回世界书库")}</button>
        <button disabled={entering} onClick={onEdit} className="eidos-world-create__ghost eidos-focus border px-4 py-2 text-sm disabled:opacity-40">{ui("修改生成条件")}</button>
        <button disabled={entering} onClick={() => void onEnter()} className="eidos-world-create__primary eidos-focus border px-5 py-2 text-sm disabled:opacity-40">{entering ? ui("正在创建周目…") : sandboxMode ? ui("进入沙箱世界") : ui("进入这个世界")}</button>
      </div>
    </footer>
  </ArchiveScreen>;
}
