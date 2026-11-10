"use client";
import { useInterfaceText } from "@/components/shell/useInterfaceText";

import { useEffect, useState } from 'react';
import { CreationImportZone } from './CreationImportZone';
import { CardVariableChoices } from '@/components/library/CardVariableChoices';
import { importCardAsset } from '@/lib/game/cards/storage';
import { cardCompatibility } from '@/lib/game/cards/entries';
import { readCreationCards, type CreationCard } from '@/lib/game/cards/creation';
import { MAX_CARD_FILE_BYTES, type CardAsset, type CardRole } from '@/lib/game/cards/types';

export function CreationCards({ cards, onChange, disabled }: { cards: CreationCard[]; onChange: (cards: CreationCard[]) => void; disabled: boolean }) {
  const ui = useInterfaceText();
  const [assets, setAssets] = useState<Record<string, CardAsset>>({});
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    readCreationCards(cards).then(items => { if (active) { setAssets(Object.fromEntries(items.map(i => [i.asset.id, i.asset]))); setError(''); } })
      .catch(e => { if (active) setError(e instanceof Error ? e.message : ui("原卡读取失败")); });
    return () => { active = false; };
  }, [ui, cards]);
  return <section className="space-y-5" aria-label={ui("酒馆卡生成素材")}>
    <h2 className="text-xl font-semibold">{ui("酒馆卡")}</h2>
    <p className="text-sm leading-7 opacity-65">{ui("原卡与世界想法、玩法模组共同参与生成。游玩时仍保留原卡的按需取用和变量，不需要另建一个卡片世界。")}</p>
    <CreationImportZone label={ui("添加酒馆卡生成素材")} inputLabel={ui("选择酒馆卡生成素材")} accept=".json,.png" disabled={disabled}
      heading={ui("导入酒馆卡")} description={ui("拖放 JSON / PNG 原卡到此处，或点击选择文件")}
      hint={ui("支持人物卡、世界书与玩家身份卡，导入后可在下方调整用途。")} onFiles={async files => {
      const file = files[0];
      if (file.size > MAX_CARD_FILE_BYTES) throw new Error(ui("卡片文件超过 20 MiB"));
      const asset = await importCardAsset(new Uint8Array(await file.arrayBuffer()), file.name);
      const compatibility = cardCompatibility(asset);
      if (compatibility.blocked.length) throw new Error(compatibility.blocked.join('；'));
      if (cards.some(c => c.assetId === asset.id)) throw new Error('这张原卡已加入素材');
      const next = [...cards, { assetId: asset.id, name: asset.name, role: asset.kind === 'worldbook' ? 'world' as const : 'character' as const, enabled: true }];
      await readCreationCards(next); onChange(next);
    }} />
    {error && <p role="alert">{error}</p>}
    {cards.map(card => <div className="border-b border-current/15 pb-5 space-y-3" key={card.assetId}>
      <div className="flex items-center gap-4"><b className="flex-1">{card.name}</b><button type="button" className="eidos-focus text-sm" disabled={disabled} onClick={() => onChange(cards.filter(c => c.assetId !== card.assetId))}>{ui("移除")}</button></div>
      <label className="block text-sm">{ui("挂载用途")}<select className="eidos-field ml-4 p-2" value={card.role} disabled={disabled || assets[card.assetId]?.kind === 'worldbook'} onChange={e => onChange(cards.map(c => c === card ? { ...c, role: e.target.value as CardRole } : c))}><option value="character">{ui("人物")}</option><option value="world">{ui("世界／叙事者")}</option><option value="persona">{ui("玩家身份")}</option></select></label>
      {assets[card.assetId] && <CardVariableChoices card={assets[card.assetId]} selected={card.publicVariables ?? []} disabled={disabled} onChange={publicVariables => onChange(cards.map(c => c === card ? { ...c, publicVariables } : c))} />}
    </div>)}
  </section>;
}
