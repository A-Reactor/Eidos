'use client';
import { useInterfaceText } from "@/components/shell/useInterfaceText";

import { useMemo, useRef, useState } from 'react';
import { useGameStore } from '@/store/game-store';
import { parseGameplayPlugins } from '@/lib/game/plugins/manifest';
import { useMobileSwipe } from '@/components/ui/use-mobile-swipe';
import { ArchiveScreen } from '@/components/ui/ArchiveScreen';
import { BackButton } from '@/components/ui/BackButton';
import { GameplayResources } from './GameplayResources';
import { GameplayReadouts } from './GameplayReadouts';
import { ManualSavePage } from './ManualSavePage';
import { AliceContextMeter } from './AliceContextMeter';

type Destination = 'inventory' | 'npc_dossiers' | 'world_line_view' | 'map' | 'settings';
type IconName = Destination | 'save' | 'resources' | 'gallery' | 'image' | 'voice' | 'document';
const icons: Record<IconName, string> = {
  save: 'M5 3h12l3 3v15H4V3zM8 3v6h8V3M8 21v-8h8v8',
  inventory: 'M5 8h14v12H5zM9 8V5h6v3',
  npc_dossiers: 'M15 20v-3a4 4 0 0 0-8 0v3M7 7a4 4 0 1 0 8 0a4 4 0 1 0-8 0M17 12a4 4 0 0 1 4 4v4',
  world_line_view: 'M6 3v18M6 8h8V4M6 15h12v6',
  map: 'M3 5l6-2l6 2l6-2v16l-6 2l-6-2l-6 2zM9 3v16M15 5v16',
  settings: 'M4 6h16M4 12h16M4 18h16M8 3v6M16 9v6M10 15v6',
  resources: 'M4 5h7v7H4zM15 5h5v5h-5zM4 16h5v5H4zM13 14h7v7h-7z',
  gallery: 'M3 4h18v16H3zM4 17l5-6l4 4l3-3l5 5M15 8h2',
  image: 'M12 3v18M3 12h18M5 5l14 14M5 19L19 5',
  document: 'M6 3h8l4 4v14H6zM14 3v5h4M9 12h6M9 16h6',
  voice: 'M9 5a3 3 0 0 1 6 0v7a3 3 0 0 1-6 0zM5 11v1a7 7 0 0 0 14 0v-1M12 19v3M8 22h8',
};
function Row({ icon, label, detail, onClick }: { icon: IconName; label: string; detail?: string | number; onClick: () => void }) {
  return <button className="eidos-mobile-archive-row eidos-focus" onClick={onClick}>
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><path d={icons[icon]} /></svg>
    <span>{label}</span>{detail !== undefined && <small>{detail}</small>}<b aria-hidden="true">›</b>
  </button>;
}

export function MobileArchive({ onClose, onNavigate, onSave, onGallery, onVoices, onDocuments, busy, usage }: {
  onClose: () => void; onNavigate: (destination: Destination) => void; onSave: (name?: string, overwriteSaveId?: string) => Promise<string>;
  onGallery: () => void; onVoices: () => void; onDocuments: () => void; busy: boolean; usage: string;
}) {
  const ui = useInterfaceText();
  const [page, setPage] = useState<'overview' | 'resources' | 'save'>('overview');
  const root = useRef<HTMLDivElement>(null);
  const store = useGameStore();
  const plugins = useMemo(() => parseGameplayPlugins(store.currentWorld?.gameplayPlugins), [store.currentWorld?.gameplayPlugins]);
  const detail = store.worldTokenUsage?.[store.currentWorld?.id ?? '']?.tokenDetail;
  const back = onClose;
  const clearDrag = () => root.current?.closest<HTMLElement>('.eidos-console-drawer')?.style.removeProperty('--archive-return');
  useMobileSwipe(root, { enabled: page === 'overview', direction: 'right', onSwipe: () => { clearDrag(); back(); },
    onProgress: distance => root.current?.closest<HTMLElement>('.eidos-console-drawer')?.style.setProperty('--archive-return', `${distance}px`),
    onCancel: clearDrag });
  return <div ref={root} className="eidos-mobile-archive">
    <header className="eidos-mobile-archive-header" inert={page !== 'overview'} aria-hidden={page !== 'overview' || undefined}>
      <div><span aria-hidden="true" /><h2>{ui("游戏档案")}</h2><small>{store.currentWorld?.name || 'EIDOS'}</small></div>
      <BackButton className="eidos-console-mobile-close" label={ui("关闭游戏档案")} onClick={back} />
    </header>
    <div className="eidos-mobile-archive-body" inert={page !== 'overview'} aria-hidden={page !== 'overview' || undefined}>
      <>
        <p className="eidos-mobile-player-summary"><b>{store.playerName || ui("主角")}</b><span>{store.protagonistState.health} · {store.protagonistState.mood}</span></p>
        <p className="eidos-mobile-archive-time">{ui("第")}{store.gameTime.day} {ui("天 ·")}{String(store.gameTime.hour).padStart(2, '0')}:{String(store.gameTime.minute).padStart(2, '0')} · {store.weather}</p>
        <nav aria-label={ui("档案目录")}>
          <Row icon="inventory" label={ui("背包")} detail={ui("{0} 件", {"0": store.inventory.length})} onClick={() => onNavigate('inventory')} />
          <Row icon="npc_dossiers" label={ui("人物档案")} onClick={() => onNavigate('npc_dossiers')} />
          <Row icon="world_line_view" label={ui("世界线与回看")} detail={ui("第 {0} 步", {"0": store.currentNode?.stepNumber ?? 0})} onClick={() => onNavigate('world_line_view')} />
          <Row icon="map" label={ui("地图")} onClick={() => onNavigate('map')} />
          <Row icon="save" label={ui("手动保存")} onClick={() => setPage('save')} />
          <Row icon="resources" label={ui("资源与服务")} onClick={() => setPage('resources')} />
          <Row icon="settings" label={ui("设置与模组")} onClick={() => onNavigate('settings')} />
        </nav>
        <GameplayResources compact activeOnly />
        <GameplayReadouts />
        {!!plugins.length && <section className="eidos-mobile-loaded-mods" aria-label={ui("已加载模组")}><h3>{ui("已加载模组 ·")}{plugins.length}</h3><p>{plugins.map(plugin => plugin.name).join(' · ')}</p></section>}
      </>
      <div className="eidos-mobile-archive-usage">{ui("当前世界用量")}<br /><strong>{usage}</strong>
        <details className="eidos-mobile-usage-detail"><summary>{ui("用量明细")}</summary>
          <dl>{(['alice', 'kei', 'uzq'] as const).map(role => <div key={role}><dt>{role.toUpperCase()}</dt><dd>{((detail?.[`${role}Prompt`] ?? 0) + (detail?.[`${role}Completion`] ?? 0)).toLocaleString()} token</dd></div>)}</dl>
          <AliceContextMeter />
        </details>
      </div>
    </div>
    {page === 'save' && <ManualSavePage onBack={() => setPage('overview')} onSave={onSave} busy={busy} />}
    {page === 'resources' && <ResourcePage onBack={() => setPage('overview')} onGallery={onGallery} onVoices={onVoices} onDocuments={onDocuments} />}
  </div>;
}

function ResourcePage({ onBack, onGallery, onVoices, onDocuments }: { onBack: () => void; onGallery: () => void; onVoices: () => void; onDocuments: () => void }) {
  const ui = useInterfaceText();
  return <ArchiveScreen className="eidos-archive-resource-page" title={ui("资源与服务")} onBack={onBack} swipeBack backLabel={ui("返回档案目录")}
    action={<BackButton onClick={onBack} label={ui("返回档案目录")} />}>
    <nav className="eidos-mobile-archive-body" aria-label={ui("资源与服务")}>
      <Row icon="gallery" label={ui("图像管理")} onClick={onGallery} />
      <Row icon="voice" label={ui("音频管理")} detail="MOMOI" onClick={onVoices} />
      <Row icon="document" label={ui("文档管理")} onClick={onDocuments} />
    </nav>
  </ArchiveScreen>;
}
