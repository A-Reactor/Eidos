"use client";
import { useInterfaceText } from "@/components/shell/useInterfaceText";


import { useLayoutEffect, useRef } from 'react';
import type { PlayerMap } from '@/lib/game/player-map';

/** An atlas indexes known places without inventing coordinates or drawing every edge. */
export function MapCanvas({ map, selected, onSelect, zoom, focusToken }: {
  map: PlayerMap; selected: string; onSelect: (id: string) => void; zoom: number; focusToken: number;
}) {
  const ui = useInterfaceText();
  const regions = [...new Map(map.places.map(place => [place.regionId, place.regionName]))];
  const nodes = useRef(new Map<string, HTMLButtonElement>());
  useLayoutEffect(() => {
    nodes.current.get(selected)?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [selected, focusToken]);
  return <nav className="eidos-map-atlas" aria-label={ui("已知地点列表")} style={{ fontSize: `${zoom}rem` }}>
    {regions.map(([id, name], index) => {
      const places = map.places.filter(place => place.regionId === id);
      return <section key={id} className="eidos-map-atlas-region" aria-label={name}>
        <header><small>{String(index + 1).padStart(2, '0')}</small><h2>{name}</h2><span>{places.length} {ui("处")}</span></header>
        <div>{places.map(place => <button key={place.id} type="button" ref={element => { if (element) nodes.current.set(place.id, element); else nodes.current.delete(place.id); }}
          aria-label={ui("选择地点：{0}", {"0": place.name})} aria-pressed={selected === place.id} data-current={place.current} data-visited={place.visited} className="eidos-focus eidos-map-landmark" onClick={() => onSelect(place.id)}>
          <span aria-hidden="true" className="eidos-map-landmark-dot">{place.current ? '◉' : place.visited ? '●' : '○'}</span><span className="eidos-map-landmark-name">{place.name}{place.note && <small aria-label={ui("有地点备注")}> ·</small>}</span><small>{place.current ? ui("当前位置") : place.reachable ? ui("直达") : place.visited ? ui("已到访") : ui("未到访")}</small>
        </button>)}</div>
      </section>;
    })}
  </nav>;
}
