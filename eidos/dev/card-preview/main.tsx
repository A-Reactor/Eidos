import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import { CardImportDialog, type CardMountRequest } from '@/components/library/CardImportDialog';
import { CardModPanels } from '@/components/game/CardModPanels';
import { useGameStore } from '@/store/game-store';
import { importCardAsset } from '@/lib/game/cards/storage';
import { mountCardWorld } from '@/lib/game/cards/binding';
import { cardEntries } from '@/lib/game/cards/entries';
import { cardLedger, prepareCardVariableTransition } from '@/lib/game/cards/adapter';
import { renderCardTemplate } from '@/lib/game/cards/template';
import type { CardAsset } from '@/lib/game/cards/types';
import type { WorldSnapshot } from '@/lib/game/types';
import { getSceneById } from '@/lib/game/scene-utils';
import sample from '../../examples/cards/gatekeeper.v2.json';
import '@/app/globals.css';

// This preview exercises import and the real iframe host without provider calls.
window.fetch = async () => Response.json({ status: 'stopped', assets: [] });
function Preview() {
  const state = useGameStore(), [asset, setAsset] = useState<CardAsset | null>(null);
  const [initial, setInitial] = useState<WorldSnapshot | null>(null), [showImport, setShowImport] = useState(true);
  const [notice, setNotice] = useState('');
  const mount = async (request: CardMountRequest) => {
    const original = await importCardAsset(request.bytes, request.filename);
    if (request.saveOnly) return;
    const world = mountCardWorld({ asset: original, role: request.role, publicVariables: request.publicVariables });
    useGameStore.getState().setCurrentWorld(world);
    useGameStore.setState({ phase: 'playing', currentPlaythroughId: 'card-preview', availableActions: ['帮助修好门灯'], currentNode: null, currentSceneId: 'card_start', currentScene: getSceneById(world, 'card_start') });
    setAsset(original); setInitial(useGameStore.getState().createSnapshot()); setShowImport(false); setNotice('原卡导入完成，初始信任 20');
  };
  const accept = () => {
    if (!asset) return;
    const s = useGameStore.getState(), ledger = cardLedger(s.gameplayModState, asset.id)!;
    const next = prepareCardVariableTransition({ world: s.currentWorld!, state: s.gameplayModState, mode: 'action', updates: [{ assetId: asset.id, expectedRevision: ledger.revision, changes: [{ path: 'Gate.Trust[0]', oldValue: (ledger.variables.Gate as { Trust: unknown[] }).Trust[0], newValue: 65 }] }] });
    useGameStore.setState({ gameplayModState: next }); setNotice('模拟行动已接受：信任 65，条件原文与面板随状态变化');
  };
  const ledger = asset ? cardLedger(state.gameplayModState, asset.id) : undefined;
  const condition = asset && ledger ? cardEntries(asset).filter(e => e.constant).map(e => renderCardTemplate(e.text, { char: asset.name, user: '旅人', variables: ledger.variables })).join('\n') : '';
  return <main className="min-h-screen bg-[#101c20] p-8 text-[#dae9e8]">
    <h1 className="mb-3 text-xl">原卡条件与模组复用验证</h1>
    <p className="mb-6 text-sm text-zinc-400">此开发预览只使用本地模拟行动，不调用模型。普通导入流程、条件求值和面板宿主均使用产品代码。</p>
    <div className="flex flex-wrap gap-3"><button className="border px-3 py-2" onClick={() => setShowImport(true)}>导入原卡</button>
      <button className="border px-3 py-2" onClick={() => void mount({ bytes: new TextEncoder().encode(JSON.stringify(sample)), filename: 'gatekeeper.v2.json', role: 'world', publicVariables: ['Gate.Trust[0]'] })}>载入自有示例</button>
      <button className="border px-3 py-2 disabled:opacity-40" disabled={!asset} onClick={accept}>接受帮助行动</button>
      <button className="border px-3 py-2 disabled:opacity-40" disabled={!initial} onClick={() => { if (initial) state.restoreSnapshot(initial); setNotice('已回溯：信任恢复 20'); }}>回溯初始快照</button></div>
    <p role="status" className="mt-6">{notice}</p>
    {asset && <div className="mt-5 grid gap-6 md:grid-cols-2"><section className="rounded border border-white/20 p-5"><h2 className="mb-4">本轮生效的条件原文</h2><pre aria-label="本轮条件原文" className="whitespace-pre-wrap leading-7">{condition}</pre>
      <p className="mt-6 text-xs text-zinc-400">原卡源文件保持原样；每轮只求值当前快照。隐藏变量没有投影到玩家面板。</p></section>
      <div className="relative h-72 rounded border border-white/20"><CardModPanels reading={{ segments: [], index: 0, displayedText: '', complete: true, loading: false }} onSubmit={accept} onAdvance={() => {}} /></div></div>}
    {showImport && <CardImportDialog worlds={[]} onMount={mount} onClose={() => setShowImport(false)} />}
  </main>;
}
createRoot(document.getElementById('root')!).render(<Preview />);
