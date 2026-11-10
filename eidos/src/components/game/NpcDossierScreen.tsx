"use client";
import { useInterfaceText } from "@/components/shell/useInterfaceText";

import { BackButton } from "@/components/ui/BackButton";

import { useState } from 'react';
import { useGameStore } from '@/store/game-store';
import { getPlayerVisibleText } from '@/lib/game/player-reading';
import { formatDossierTime, type DossierSource, type NpcDossier } from '@/lib/game/npc-dossiers';
import { ArchiveScreen } from '@/components/ui/ArchiveScreen';
import { ResponsiveSidebar } from '@/components/ui/ResponsiveSidebar';
import { InteractionDialog } from '@/components/ui/InteractionDialog';
import { findMidoriAsset } from '@/lib/game/midori/asset-registry';
import { characterAssetId } from '@/lib/game/midori/character-target';
import { useNpcDossiers } from './use-npc-dossiers';

const action = 'eidos-focus eidos-archive-button disabled:opacity-40';

export function NpcDossierScreen() {
  const scope = useGameStore(s => `${s.currentWorld?.id}:${s.currentPlaythroughId}:${s.currentNode?.id}`);
  return <DossierView key={scope} />;
}

function DossierView() {
  const ui = useInterfaceText();
  const store = useGameStore();
  const { dossiers, loading, error, retry } = useNpcDossiers();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState('');
  const [source, setSource] = useState<DossierSource | null>(null);
  const matches = dossiers.filter(dossier => `${dossier.name}\n${dossier.description?.text ?? ''}`.includes(query.trim()));
  const dossier = matches.find(item => item.name === selected) ?? matches[0];
  return <ArchiveScreen directoryFirst title={ui("人物档案")} subtitle={ui("当前分支 · {0} 位已知人物", {"0": dossiers.length})} className="eidos-npc-screen" onBack={() => store.goBack()}
    action={<BackButton onClick={() => store.goBack()} />}>
    {error && <p role="alert" className="eidos-archive-alert">{ui("部分人物资料未能读取，已读原文仍可查看。")}<button className={action} onClick={retry}>{ui("重试读取")}</button></p>}
    <div className="eidos-npc-layout">
      <ResponsiveSidebar className="eidos-npc-index" label={ui("已知人物")} current={dossier?.name}>
        <label className="eidos-npc-eyebrow" htmlFor="npc-search">{ui("人物索引")}</label>
        <input id="npc-search" type="search" placeholder={ui("搜索人物…")} value={query} onChange={event => setQuery(event.target.value)} className="eidos-focus eidos-archive-search" />
        <div className="eidos-npc-list">
          {matches.map(item => <button key={item.name} className="eidos-focus eidos-npc-list-item" aria-label={ui("查看{0}的档案", {"0": item.name})} aria-pressed={dossier?.name === item.name} onClick={() => setSelected(item.name)}>
            <NpcAvatar name={item.name} />
            <span><b>{item.name}</b>
              <em>{item.contacts.at(-1)?.sceneName || ui("已有相关记录")}</em></span><span aria-hidden="true">→</span>
          </button>)}
          {!matches.length && <p className="eidos-archive-muted py-6 text-sm leading-7">{query ? ui("没有找到这位人物。") : loading ? ui("正在整理已有资料…") : ui("遇见或听说人物后，已读记录会留在这里。")}</p>}
        </div>
      </ResponsiveSidebar>
      <main className="eidos-npc-main" aria-label={ui("人物详情")}>
        {dossier ? <DossierDetail key={dossier.name} dossier={dossier} onSource={setSource} /> : <div className="eidos-archive-empty">
          <h2 className="text-2xl">{ui("人物的故事，从相遇开始")}</h2>
          <p className="eidos-archive-muted mt-4 text-sm leading-7">{ui("这里会整理你已读到的人物资料和原话，也可以记下自己的疑问。")}</p>
        </div>}
      </main>
    </div>
    {source && <SourceDialog source={source} onClose={() => setSource(null)} />}
  </ArchiveScreen>;
}

function NpcAvatar({ name, large = false }: { name: string; large?: boolean }) {
  const world = useGameStore(s => s.currentWorld);
  const registry = useGameStore(s => s.midoriAssetRegistry);
  const targetId = characterAssetId(world, name);
  const lookup = { worldId: world?.id, targetType: 'character' as const, targetId };
  const asset = findMidoriAsset(registry, { ...lookup, slot: 'avatar' }) ?? findMidoriAsset(registry, { ...lookup, slot: 'portrait' });
  return <span className={`eidos-npc-monogram${large ? ' eidos-npc-monogram--large' : ''}`} aria-hidden="true">
    {asset?.imageUrl ? <img src={asset.imageUrl} alt="" /> : name[0]}
  </span>;
}

function DossierDetail({ dossier, onSource }: { dossier: NpcDossier; onSource: (source: DossierSource) => void }) {
  const ui = useInterfaceText();
  const latest = dossier.contacts.at(-1);
  return <article className="eidos-npc-card">
    <div className="eidos-npc-identity"><NpcAvatar name={dossier.name} large />
      <div><p className="eidos-npc-eyebrow">{ui("已知人物")}</p><h2>{dossier.name}</h2><p>{latest?.sceneName || ui("地点未记录")} · {latest && formatDossierTime(latest.time)}</p></div>
    </div>
    <section className="eidos-npc-section"><h3>{ui("人物资料")}</h3>
      {dossier.description ? <><p>{dossier.description.text}</p><SourceButton source={dossier.description.source} onSource={onSource} /></> : <p className="eidos-npc-muted">{ui("身份与背景尚未记录，可从下方原文继续调查。")}</p>}
    </section>
    <details className="eidos-npc-section eidos-npc-disclosure"><summary className="eidos-focus">{ui("接触记录")}</summary>
      <p className="eidos-npc-muted">{ui("地点表示记录发生处；提及某人不代表他当时在场。")}</p>
      <div className="eidos-npc-contact-list">{dossier.contacts.map((contact, index) => <button key={`${contact.nodeId}:${index}`} className="eidos-focus eidos-npc-contact" onClick={() => onSource(contact)}>
        <small>{formatDossierTime(contact.time)} / {contact.sceneName || ui("地点未记录")}</small>
        <span>→ {contact.dialogue ? ui("交谈") : ui("相关记录")}</span><p>{contact.quote}</p>
      </button>)}</div>
    </details>
    <details className="eidos-npc-section eidos-npc-disclosure"><summary className="eidos-focus">{ui("相关线索与证词")}</summary>
      <p className="eidos-npc-muted">{ui("原话与资料供你对照，人物的说法不代表已经证实。")}</p>
      {dossier.knowledge.map(fact => <div className="eidos-npc-evidence" key={fact.text}><small>{ui("已记录资料")}</small><p>{fact.text}</p><SourceButton source={fact.source} onSource={onSource} /></div>)}
      {dossier.contacts.filter(contact => contact.dialogue).map((contact, index) => <div className="eidos-npc-evidence" key={`${contact.nodeId}:${index}`}><small>{dossier.name}{ui("的原话")}</small><blockquote>{contact.quote}</blockquote><SourceButton source={contact} onSource={onSource} /></div>)}
      {dossier.related.map(fact => <div className="eidos-npc-evidence" key={`${fact.type}:${fact.name}`}><small>{ui("关联条目 ·")}{fact.name}</small><p>{fact.text}</p><SourceButton source={fact.source} onSource={onSource} /></div>)}
      {!dossier.knowledge.length && !dossier.related.length && !dossier.contacts.some(contact => contact.dialogue) && <p className="eidos-npc-muted">{ui("还没有相关线索或证词。")}</p>}
    </details>
    <NpcNote key={dossier.name} dossier={dossier} />
  </article>;
}

function SourceButton({ source, onSource }: { source: DossierSource; onSource: (source: DossierSource) => void }) {
  const ui = useInterfaceText();
  return <button className="eidos-focus eidos-npc-source" onClick={() => onSource(source)}>{ui("→ 查看来源 ·")} {source.sceneName || ui("原文记录")}</button>;
}

function SourceDialog({ source, onClose }: { source: DossierSource; onClose: () => void }) {
  const ui = useInterfaceText();
  const node = useGameStore(s => s.allNodes[source.nodeId]);
  const text = node ? getPlayerVisibleText(node) : '';
  return <InteractionDialog title={ui("来源原文")} onClose={onClose} className="eidos-npc-source-dialog">
    <p className="eidos-npc-eyebrow">{formatDossierTime(source.time)} / {source.sceneName || ui("地点未记录")}</p>
    <div className="max-h-[55dvh] space-y-5 overflow-y-auto pr-2">{text.split(/\n\n+/).filter(Boolean).map((paragraph, index) =>
      <p key={index} className={`whitespace-pre-wrap text-base leading-8 ${source.quote && paragraph.includes(source.quote) ? 'border-l-2 border-[var(--eidos-accent)] pl-4' : ''}`}>{paragraph}</p>)}
      {!text && <p>{ui("此处尚无可回看的已读正文。")}</p>}</div>
    <button className={action} onClick={onClose}>{ui("返回档案")}</button>
  </InteractionDialog>;
}

function NpcNote({ dossier }: { dossier: NpcDossier }) {
  const ui = useInterfaceText();
  const store = useGameStore();
  const [note, setNote] = useState(dossier.note);
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const save = async () => {
    const nodeId = store.currentNode?.id;
    if (!nodeId) return;
    store.setPlayerNpcNote(nodeId, dossier.name, note);
    setStatus('saving');
    try { await store.persistWorldLineData(); setStatus('saved'); }
    catch (cause) { console.warn('[NpcDossiers] 保存玩家备注失败', cause); setStatus('error'); }
  };
  return <section className="eidos-npc-section"><h3>{ui("玩家备注")}</h3><p className="eidos-npc-muted">{ui("你的疑点与猜测，只保留在当前分支的个人档案中。")}</p>
    <textarea aria-label={ui("{0}的玩家备注", {"0": dossier.name})} value={note} onChange={event => { setNote(event.target.value); setStatus('idle'); }} rows={4} className="eidos-focus eidos-npc-note" placeholder={ui("记下在意的细节、待核实的说法…")} />
    <div className="mt-3 flex flex-wrap items-center gap-3"><button className={action} disabled={status === 'saving' || !store.currentNode} onClick={() => void save()}>{status === 'saving' ? ui("保存中…") : status === 'error' ? ui("重试保存") : ui("保存备注")}</button>
      <span role={status === 'error' ? 'alert' : 'status'} className={`text-sm ${status === 'error' ? 'text-red-700' : 'eidos-archive-muted'}`}>{status === 'error' ? ui("备注尚未保存到磁盘，请重试。") : status === 'saved' ? ui("备注已保存") : ''}</span></div>
  </section>;
}
