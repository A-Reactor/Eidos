import { useState } from 'react';
import { WorldLibrary } from '@/components/library/WorldLibrary';
import { buildRiftCityStartState } from '@/lib/test/fixtures';
import type { WorldLibraryItem } from '@/components/library/world-library-model';

const { world } = buildRiftCityStartState();
const time = { day: 3, hour: 14, minute: 30 };
const makeSave = (id: string, name: string, playthroughId: string) => ({ id, name, playthroughId, worldId: world.id, worldName: world.name, playDuration: 45, playerName: '林', currentSceneName: '中央广场', gameTime: time, preview: '雨停了。你收起地图，望向街口。下一段路已经清晰可见。', actionCount: 12, updatedAt: 1700000000000, createdAt: 1700000000000 });
const saves = [makeSave('manual-1', '钟楼前的决定', 'preview-1'), makeSave('manual-2', '渡口的约定', 'preview-1'), makeSave('autosave_preview-1', '自动存档', 'preview-1')];
const first = { currentSceneName: '中央广场', totalPlayDuration: 45, worldLineId: 'preview-worldline', id: 'preview-1', worldId: world.id, name: '第一周目', playerName: '林', gameTime: time, actionCount: 12, status: 'active' as const, createdAt: 1700000000000, updatedAt: 1700000000000, saves };
const item: WorldLibraryItem = { world: { ...world, isPlayerCreated: true }, continuityCount: 2, historyNodeCount: 12, saveCount: 3, latestSave: saves[0], activeContinuity: first,
  continuities: [first, { ...first, id: 'preview-2', name: '另一种选择', saves: [] }] };
const ok = async () => true;
const noop = () => {};

export function LibraryPreview() {
  const [libraryItem, setLibraryItem] = useState(item);
  const [selected, setSelected] = useState<string | null>(world.id);
  const [continuity, setContinuity] = useState<string | null>(first.id);
  return <WorldLibrary items={[libraryItem]} notice={null} loadError={null} expandedWorldId={selected} expandedContinuityId={continuity}
    onToggleWorld={id => setSelected(current => current === id ? null : id)} onToggleContinuity={setContinuity}
    onContinue={ok} onNewContinuity={ok} onCreateWorld={noop} onImportWorldFiles={ok} onOpenGallery={noop} onOpenSettings={noop} onBack={noop}
    management={{ onRenameWorld: async (_id, name, subtitle) => { setLibraryItem(current => ({ ...current, world: { ...current.world, name, subtitle } })); return true; }, onDeleteWorld: ok, onDeleteContinuity: ok, onDeleteSave: ok, onCreateInitialSave: ok, onExportWorld: ok, onExportWorldArchive: ok }} />;
}
