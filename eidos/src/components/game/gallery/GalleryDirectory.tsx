'use client';
import { useInterfaceText } from "@/components/shell/useInterfaceText";


import { ResponsiveSidebar } from '@/components/ui/ResponsiveSidebar';

export type GalleryCategory = 'scenes' | 'npcs' | 'details';
export interface GalleryDirectoryItem { id: string; name: string; caption?: string; label: string }

export function GalleryDirectory({ category, items, selectedId, onCategoryChange, onSelect }: {
  category: GalleryCategory; items: GalleryDirectoryItem[]; selectedId?: string;
  onCategoryChange: (category: GalleryCategory) => void; onSelect: (id: string) => void;
}) {
  const ui = useInterfaceText();
  return <ResponsiveSidebar className="eidos-gallery-index" label={ui("图像资源")} current={items.find(item => item.id === selectedId)?.name}>
    <nav className="eidos-gallery-categories" aria-label={ui("图像分类")}>
      {([{ id: 'scenes', name: ui("场景") }, { id: 'npcs', name: ui("人物") }, { id: 'details', name: ui("插图") }] as const).map(tab =>
        <button type="button" className="eidos-focus" key={tab.id} data-sidebar-keep-open aria-current={category === tab.id ? 'page' : undefined}
          onClick={() => onCategoryChange(tab.id)}>{tab.name}</button>)}
    </nav>
    <ul className="eidos-gallery-resource-list" aria-label={ui("图像资源目录")}>
      {items.map(item => <li key={item.id}><button type="button" className="eidos-focus eidos-settings-category eidos-gallery-resource" aria-label={item.label} aria-pressed={selectedId === item.id} onClick={() => onSelect(item.id)}>
        <span>{item.name}</span>{item.caption && <small>{item.caption}</small>}
      </button></li>)}
    </ul>
  </ResponsiveSidebar>;
}
