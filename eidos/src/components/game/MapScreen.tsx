"use client";
import { useInterfaceText } from "@/components/shell/useInterfaceText";

import { BackButton } from "@/components/ui/BackButton";

import { useId, useMemo, useState } from 'react';
import { useGameStore } from '@/store/game-store';
import { buildPlayerMap, findMapPath } from '@/lib/game/player-map';
import { getPlayerVisibleText, getReadingPath } from '@/lib/game/player-reading';
import { usePanelWidth, PanelResizeHandle } from '@/components/ui/PanelResizeHandle';
import { MapCanvas } from './MapCanvas';
import { ArchiveScreen } from '@/components/ui/ArchiveScreen';
import { ResponsiveSidebar } from '@/components/ui/ResponsiveSidebar';

export function MapScreen() {
  const scope = useGameStore(s => `${s.currentWorld?.id}:${s.currentPlaythroughId}:${s.currentNode?.id}:${s.currentSceneId}`);
  return <MapView key={scope} />;
}

function MapView() {
  const ui = useInterfaceText();
  const store = useGameStore();
  const inspectorWidth = usePanelWidth("map", 320);
  const map = useMemo(() => buildPlayerMap(store.currentWorld, store.currentSceneId, store.visitedScenes), [store.currentWorld, store.currentSceneId, store.visitedScenes]);
  const [selected, setSelected] = useState(store.currentSceneId);
  const [region, setRegion] = useState('');
  const [zoom, setZoom] = useState(1);
  const [focusToken, setFocusToken] = useState(0);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [toolsOpen, setToolsOpen] = useState(false);
  const toolsId = useId();
  const place = map.places.find(place => place.id === selected);
  const path = findMapPath(map, store.currentSceneId, selected);
  const canTravel = !!path && path.length > 1 && path.length <= 31;
  const blocked = map.paths.some(path => path.from === store.currentSceneId && path.to === selected && path.blocked);
  const regions = [...new Map(map.places.map(place => [place.regionId, place.regionName])).entries()];
  const shown = map.places.filter(place => (!region || place.regionId === region) && (!search.trim() || `${place.name} ${place.regionName}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())));
  const ids = new Set(shown.map(place => place.id));
  const visibleMap = { places: shown, paths: map.paths.filter(path => ids.has(path.from) && ids.has(path.to)) };
  const original = getReadingPath(store.allNodes, store.currentNode?.id ?? null).reverse().find(node => node.sceneId === selected && getPlayerVisibleText(node));
  const routes = map.paths.filter(path => path.from === selected).map(path => ({ ...map.places.find(place => place.id === path.to)!, blocked: path.blocked }));
  const select = (id: string) => { setSelected(id); setError(''); setToolsOpen(false); };
  return <ArchiveScreen directoryFirst className="eidos-map-screen" label={ui("世界地图")} title={ui("地图")} subtitle={ui("{0} · 按区域浏览已知地点", {"0": store.currentWorld?.name ?? ui("世界")})} onBack={() => store.goBack()}
    action={<BackButton onClick={() => store.goBack()} />}>
    <div className="eidos-map-toolbar">
      <label className="eidos-map-search"><span>{ui("查找")}</span><input aria-label={ui("查找已知地点")} placeholder={ui("搜索地点或区域")} value={search} onChange={e => setSearch(e.target.value)} /></label>
      <button className="eidos-focus eidos-map-locate" aria-label={ui("回到当前位置")} onClick={() => { setRegion(''); setSearch(''); select(store.currentSceneId); setZoom(1); setFocusToken(value => value + 1); }}><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="12" r="6" /><path d="M12 2v5m0 10v5M2 12h5m10 0h5" /></svg><span>{ui("回到当前位置")}</span></button>
      <button className="eidos-focus eidos-map-tools-toggle" aria-label={ui("地图筛选与缩放")} aria-expanded={toolsOpen} aria-controls={toolsId} onClick={() => setToolsOpen(open => !open)}><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M4 7h16M7 17h10M7 4v6m10 4v6" /></svg></button>
      <div id={toolsId} className="eidos-map-tools-panel" data-expanded={toolsOpen}>
        <label>{ui("区域")}<select aria-label={ui("地图区域")} value={region} onChange={event => {
          const value = event.target.value; setRegion(value);
          if (value && place?.regionId !== value) select(map.places.find(place => place.regionId === value)?.id ?? '');
        }}><option value="">{ui("全部已知区域")}</option>{regions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
        <div className="eidos-map-zoom"><button aria-label={ui("缩小地图")} disabled={zoom <= .6} onClick={() => setZoom(value => Math.max(.6, +(value - .2).toFixed(1)))}>−</button><output aria-label={ui("地图缩放")}>{Math.round(zoom * 100)}%</output><button aria-label={ui("放大地图")} disabled={zoom >= 1.6} onClick={() => setZoom(value => Math.min(1.6, +(value + .2).toFixed(1)))}>＋</button></div>
      </div>
    </div>
    <div className="eidos-map-body" style={inspectorWidth.style}>
      <ResponsiveSidebar as="div" className="eidos-map-chart" label={ui("已知地点")} current={place?.name}>
        <div className="eidos-map-legend"><span>{ui("◉ 当前")}</span><span>{ui("● 已到访")}</span><span>{ui("○ 未到访")}</span><span>{shown.length} {ui("个已知地点")}</span></div>
        {path && path.length > 1 && <div className="eidos-map-route-strip" aria-label={ui("选中地点路线")}>{path.map((id, index) => <span key={id}>{index > 0 && <span aria-hidden="true"> → </span>}<button onClick={() => { setSearch(''); setRegion(''); select(id); }}>{map.places.find(p => p.id === id)?.name}</button></span>)}</div>}
        {shown.length ? <MapCanvas map={visibleMap} selected={selected} onSelect={select} zoom={zoom} focusToken={focusToken} /> : <p className="eidos-map-empty">{search ? ui("没有匹配的已知地点。") : ui("还没有可展示的地点。探索后，已知路线会留在这里。")}</p>}
      </ResponsiveSidebar>
      <main className="eidos-map-inspector-shell"><PanelResizeHandle label={ui("地图详情宽度")} panel={inspectorWidth} /><aside className="eidos-map-inspector" aria-label={ui("地点详情")}>
        <div className="eidos-map-eyebrow">{ui("地点详情")}</div>
        <h2>{place?.name ?? ui("位置待确认")}</h2>
        <p>{place?.regionName ?? ui("暂无区域记录")} · {place?.current ? ui("你在这里") : place?.reachable ? ui("与当前位置直接相连") : blocked ? (canTravel ? ui("直达通路已封闭，可中转绕行") : ui("通路已封闭")) : canTravel ? ui("可沿已知路线中转到达") : ui("当前没有可通行路线")}</p>
        {place?.note && <div className="eidos-map-node-note"><h3>{ui("地点备注")}</h3><p>{place.note}</p></div>}
        {original ? <blockquote className="whitespace-pre-wrap break-words"><small>{ui("已读原文")}</small><p>{getPlayerVisibleText(original)}</p></blockquote> : <p className="eidos-map-note">{ui("这里还没有已读记录。")}</p>}
        {routes.length > 0 && <div className="eidos-map-known-routes"><h3>{ui("已知出口")}</h3>{routes.map(target => <button key={target.id} onClick={() => { setRegion(''); select(target.id); }}>→ {target.name}{target.blocked ? ui(" · 已封闭") : ""}</button>)}</div>}
        <button type="button" className="eidos-focus eidos-map-travel" disabled={!canTravel || store.isLoading} onClick={() => {
          if (!place || !useGameStore.getState().requestMapTravel(place.id)) setError('当前无法出发，路线或游戏状态已变化，请重新选择。');
        }}>{place?.current ? ui("已在此处") : store.isLoading ? ui("行动处理中…") : canTravel ? `${path!.length > 2 ? ui("连续前往") : ui("前往")}${place?.name}` : blocked ? ui("通路已封闭") : ui("暂无直达路线")}</button>
        {path && path.length > 2 && <p className="eidos-map-note">{ui("路线：")}{path.map(id => map.places.find(item => item.id === id)?.name).join(' → ')}{path.length > 31 ? ui("（路程过长，请选择途中地点）") : ui("。逐段到达，可随时中途停下。")}</p>}
        <p className="eidos-map-note">{ui("前往会作为新行动发送，是否到达由故事中的实际情况决定。按区域查找地点，出口与路线只显示当前选择所需的信息。")}</p>
        {error && <p role="alert">{error}</p>}

      </aside></main>
    </div>
  </ArchiveScreen>;
}
