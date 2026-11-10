"use client";
import { useInterfaceText } from "@/components/shell/useInterfaceText";


import { useMemo, useState } from 'react';
import { ArchiveScreen } from '@/components/ui/ArchiveScreen';
import { BackButton } from '@/components/ui/BackButton';
import { useGameStore } from '@/store/game-store';
import { currentDocumentScope, documentScopeKey } from '@/lib/game/model-documents';
import { DocumentLibrary } from './DocumentLibrary';
import { mergeDocumentLinks } from '@/lib/game/documents/action-draft';

/** Documents belong to the active playthrough, independently of the image gallery. */
export function DocumentsScreen() {
  const ui = useInterfaceText();
  const world = useGameStore(s => s.currentWorld);
  const playthroughId = useGameStore(s => s.currentPlaythroughId);
  const sandboxMode = useGameStore(s => s.sandboxMode);
  const sandboxDossierId = useGameStore(s => s.sandboxDossierId);
  const selection = useGameStore(s => s.documentSelection);
  const scope = useMemo(() => currentDocumentScope({ currentWorld: world, currentPlaythroughId: playthroughId, sandboxMode, sandboxDossierId }),
    [world, playthroughId, sandboxMode, sandboxDossierId]);
  const selected = scope && selection && documentScopeKey(scope) === documentScopeKey(selection.scope) ? selection : null;
  const [detail, setDetail] = useState(false);
  const back = () => useGameStore.getState().goBack();
  return <ArchiveScreen className="eidos-documents-screen" label={ui("文档管理")} title={ui("文档管理")} subtitle={ui("{0} · 当前周目的图像、报告与阅读笔记", {"0": world?.name ?? ui("当前世界")})}
    covered={detail} onBack={back} swipeBack backLabel={ui("返回上一级")} action={<BackButton label={ui("返回上一级")} onClick={back} />}>
    {scope ? <DocumentLibrary key={documentScopeKey(scope)} scope={scope} initial={selected?.initial} initialId={selected?.initialId}
      onReference={link => {
        const state = useGameStore.getState(), previous = state.documentDraft;
        const links = previous && documentScopeKey(previous.scope) === documentScopeKey(scope) ? previous.links : [];
        const game = state.navigationStack.lastIndexOf('playing');
        useGameStore.setState({ documentDraft: { scope, links: mergeDocumentLinks(links, [link]) }, documentSelection: null,
          phase: 'playing', navigationStack: game >= 0 ? state.navigationStack.slice(0, game) : [] });
      }}
      onDetailChange={setDetail} onClose={() => { if (!useGameStore.getState().documentSelection?.initial) useGameStore.setState({ documentSelection: null }); }} />
      : <div className="eidos-archive-empty"><h2>{ui("当前没有可查看的周目文档")}</h2><p>{ui("进入游戏后，可在这里管理当前周目的图像、报告与笔记。")}</p></div>}
  </ArchiveScreen>;
}
