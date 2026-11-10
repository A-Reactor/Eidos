'use client';
import { useInterfaceText } from "@/components/shell/useInterfaceText";


import { useRef, useState } from 'react';
import { FileImportZone } from '@/components/ui/FileImportZone';
import { ActionIcon } from '@/components/ui/ActionIcon';
import { CHARACTER_IMAGE_TAGS, IMAGE_ACCEPT, SCENE_IMAGE_TAGS } from '@/lib/game/midori/image-tags';
import type { ImageResource } from '@/lib/game/midori/image-resource';
import type { ImageUploadTarget } from './use-gallery-resources';
import { useAlbumZoom } from './use-album-zoom';

export function ResourceGrid({ target, images, defaultUrl, busy, onUpload, onOpen }: {
  target: ImageUploadTarget; images: ImageResource[]; defaultUrl?: string; busy: boolean;
  onUpload: (file: File, target: ImageUploadTarget) => Promise<void>; onOpen: (image: ImageResource) => void;
}) {
  const ui = useInterfaceText();
  const [filter, setFilter] = useState('');
  const gridRef = useRef<HTMLDivElement>(null);
  const zoom = useAlbumZoom(gridRef);
  const basics = target.type === 'character' ? CHARACTER_IMAGE_TAGS : target.type === 'scene' ? SCENE_IMAGE_TAGS : [];
  const occupied = new Set(images.flatMap(image => image.tags));
  const tags = [...new Set([...images.flatMap(image => image.tags), ...basics])];
  const shown = images.filter(image => !filter || image.tags.includes(filter)).sort((a, b) => Number(b.imageUrl === defaultUrl) - Number(a.imageUrl === defaultUrl));
  const empty = basics.filter(tag => !occupied.has(tag) && (!filter || tag === filter));
  return <>
    <nav aria-label={ui("图像标签")} className="eidos-gallery-tag-filters">
      <button type="button" aria-pressed={!filter} onClick={() => setFilter('')}>{ui("全部")}<small>{images.length}</small></button>
      {tags.map(tag => <button type="button" key={tag} aria-pressed={filter === tag} data-filled={occupied.has(tag) || undefined} onClick={() => setFilter(filter === tag ? '' : tag)}>{tag}</button>)}
    </nav>
    <div ref={gridRef} style={zoom.style} className={`eidos-gallery-resource-grid is-${target.type}`}>
      <ImageImportTile target={{ ...target, tags: filter ? [filter] : [] }} busy={busy} onUpload={onUpload} />
      {shown.map(image => <article key={image.id} className="eidos-gallery-resource-tile" data-default={Boolean(defaultUrl && image.imageUrl === defaultUrl) || undefined}>
        <button type="button" className="eidos-focus eidos-gallery-resource-preview" onClick={() => onOpen(image)} aria-label={ui("查看图像：{0}{1}", {"0": image.label, "1": image.tags.length ? ` · ${image.tags.join(' · ')}` : ''})}>
          {image.imageUrl ? <img src={image.imageUrl} alt={`${image.label}${image.source === 'generated' && image.tags.length ? ` · ${image.tags.join(' · ')}` : ''}`} loading="lazy" /> :
            <div className="eidos-gallery-plan"><ActionIcon name="image" /><span>{image.label}</span><p>{image.description}</p></div>}
          {defaultUrl && image.imageUrl === defaultUrl && <span className="eidos-gallery-default-marker">{ui("默认")}</span>}
          <span className="eidos-gallery-tile-tags">{[...(image.type === 'illustration' ? [image.label] : []), ...image.tags].join(' · ')}</span>
        </button>
      </article>)}
      {empty.map(tag => <ImageImportTile key={tag} target={{ ...target, tags: [tag] }} tag={tag} busy={busy} onUpload={onUpload} />)}
    </div>
  </>;
}

export function ImageImportTile({ target, tag, busy, onUpload }: {
  target: ImageUploadTarget; tag?: string; busy: boolean; onUpload: (file: File, target: ImageUploadTarget) => Promise<void>;
}) {
  const ui = useInterfaceText();
  const kind = target.type === 'character' ? '立绘' : target.type === 'scene' ? '背景图' : ui("插图");
  const object = target.type === 'illustration' ? '' : ui("{0} 的", {"0": target.label});
  return <FileImportZone className={`eidos-gallery-new-image${tag ? ' is-template' : ''}`} accept={IMAGE_ACCEPT} disabled={busy}
    label={ui("导入 {0}{1}{2}", {"0": object, "1": tag ? `${tag} ` : '', "2": kind})} inputLabel={ui("上传 {0}{1}{2}", {"0": object, "1": tag ? `${tag} ` : '', "2": kind})}
    onFiles={async files => { await onUpload(files[0], target); }}>
    <ActionIcon name="plus" /><span>{tag ?? ui("新图像")}</span>{!tag && <small>{ui("PNG / JPEG / WebP / GIF · 最大 32 MB")}</small>}
  </FileImportZone>;
}
