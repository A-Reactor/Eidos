'use client';
import { useInterfaceText } from "@/components/shell/useInterfaceText";


import { useState } from 'react';
import { BackButton } from '@/components/ui/BackButton';
import { ArchiveScreen } from '@/components/ui/ArchiveScreen';
import { useGameStore } from '@/store/game-store';
import { scopeStorageKey } from '@/lib/game/archive-scope';
import { findMidoriAsset } from '@/lib/game/midori/asset-registry';
import type { ImageResource } from '@/lib/game/midori/image-resource';
import { GalleryDirectory, type GalleryCategory } from './gallery/GalleryDirectory';
import { ResourceGrid } from './gallery/ResourceGrid';
import { ImageInspector } from './gallery/ImageInspector';
import { useGalleryResources } from './gallery/use-gallery-resources';

export function GalleryScreen() {
  const worldId = useGameStore(state => state.galleryWorld?.id);
  const sandboxMode = useGameStore(state => state.sandboxMode);
  const sandboxDossierId = useGameStore(state => state.sandboxDossierId);
  return <GalleryResources key={scopeStorageKey({ sandboxMode, sandboxDossierId }, worldId ?? '')} />;
}

function GalleryResources() {
  const ui = useInterfaceText();
  const gallery = useGalleryResources();
  const category = useGameStore(state => state.galleryTab);
  const [selection, setSelection] = useState<Partial<Record<GalleryCategory, string>>>({});
  const [preview, setPreview] = useState<string>();
  const [previewOrder, setPreviewOrder] = useState<string[]>([]);
  const scene = gallery.scenes.find(item => item.sceneId === selection.scenes) ?? gallery.scenes[0];
  const character = gallery.characters.find(item => item.name === selection.npcs) ?? gallery.characters[0];
  const illustrationImages = gallery.resources.filter(image => image.type === 'illustration');
  const illustration = illustrationImages.find(image => image.id === selection.details);
  const target = category === 'npcs' ? { type: 'character' as const, targetId: character?.name ?? '', label: character?.name ?? ui("人物") } :
    category === 'scenes' ? { type: 'scene' as const, targetId: scene?.sceneId ?? '', label: scene?.name ?? ui("场景") } :
      { type: 'illustration' as const, targetId: '', label: ui("插图") };
  const images = category === 'details' ? illustration ? [illustration] : illustrationImages : gallery.resources.filter(image => image.type === target.type && image.targetId === target.targetId);
  const defaultAsset = gallery.world && category !== 'details' ? findMidoriAsset(gallery.registry, { worldId: gallery.world.id,
    targetType: target.type === 'character' ? 'character' : 'scene', targetId: target.targetId, slot: target.type === 'character' ? 'portrait' : 'background' }) : null;
  const items = gallery.loading || gallery.listError ? [] : category === 'scenes' ? gallery.scenes.map(item => ({
    id: item.sceneId, name: item.name, caption: item.regionName, label: ui("查看场景图像：{0}", {"0": item.name}),
  })) : category === 'npcs' ? gallery.characters.map(item => ({ id: item.name, name: item.name, label: ui("查看人物图像：{0}", {"0": item.name}) })) :
    [{ id: 'all-illustrations', name: ui("全部插图"), label: ui("查看全部插图") }, ...illustrationImages.map(image => ({ id: image.id, name: image.label, caption: image.imageUrl ? undefined : ui("构想"), label: ui("查看插图：{0}", {"0": image.label}) }))];
  const selectedId = category === 'scenes' ? scene?.sceneId : category === 'npcs' ? character?.name : illustration?.id ?? 'all-illustrations';
  const previewImage = gallery.resources.find(image => image.id === preview);
  const previewImages = previewOrder.map(id => gallery.resources.find(image => image.id === id)).filter((image): image is ImageResource => Boolean(image));
  const bindingCount = Object.values(gallery.registry.bindings).filter(asset => asset.worldId === gallery.world?.id).length;
  const imageCount = gallery.resources.filter(image => image.imageUrl).length;
  const close = () => { setPreview(undefined); setPreviewOrder([]); };
  const open = (image: ImageResource) => {
    setPreviewOrder([...images].sort((a, b) => Number(b.imageUrl === defaultAsset?.imageUrl) - Number(a.imageUrl === defaultAsset?.imageUrl)).map(item => item.id));
    setPreview(image.id);
  };
  const isBound = (image: ImageResource) => Object.values(gallery.registry.bindings).some(asset => asset.worldId === image.worldId && asset.imageUrl === image.imageUrl);
  return <ArchiveScreen className="eidos-gallery-screen" label={ui("图像管理")} title={ui("图像管理")} directoryFirst subtitle={gallery.world?.name}
    onBack={() => useGameStore.getState().goBack()} action={<div className="eidos-gallery-header-actions"><span className="eidos-gallery-service-note">{imageCount} {ui("张图像 ·")}{bindingCount} {ui("个绑定")}</span><BackButton onClick={() => useGameStore.getState().goBack()} /></div>}>
    {!gallery.world ? <div className="eidos-archive-empty"><h2>{ui("世界数据未加载")}</h2><p>{ui("返回书库选择一个世界，再查看它的图像资源。")}</p></div> :
      <div className="eidos-gallery-layout"><GalleryDirectory category={category} items={items} selectedId={selectedId}
        onCategoryChange={tab => { close(); useGameStore.setState({ galleryTab: tab }); }}
        onSelect={id => { close(); setSelection(previous => ({ ...previous, [category]: id })); }} />
        <main className="eidos-gallery-main">
          {gallery.error && <p role="alert" className="eidos-gallery-error">{gallery.error}</p>}
          {gallery.loading && <div className="eidos-archive-empty" role="status"><h2>{ui("正在读取图像资源…")}</h2></div>}
          {gallery.listError && <div className="eidos-archive-empty" role="alert"><h2>{ui("图像资源暂时无法读取")}</h2><p>{gallery.listError}</p><button className="eidos-focus eidos-archive-button mt-5" onClick={gallery.retry}>{ui("重试")}</button></div>}
          {!gallery.loading && !gallery.listError && <div className="eidos-gallery-body"><div>
            <header className="eidos-gallery-detail-heading"><h2>{category === 'details' ? illustration?.label ?? ui("插图") : target.label}</h2>{category === 'scenes' && scene && <p className="eidos-gallery-caption">{scene.regionName}</p>}</header>
            {(category === 'details' || target.targetId) ? <ResourceGrid key={`${category}:${target.targetId}:${illustration?.id ?? ''}`} target={target} images={images}
              defaultUrl={defaultAsset?.imageUrl} busy={gallery.busy} onUpload={gallery.upload} onOpen={open} /> : <p className="eidos-gallery-caption">{category === 'npcs' ? ui("暂无人物资产") : ui("世界数据中没有场景信息")}</p>}
            {category === 'details' && !images.length && <p className="eidos-gallery-empty">{ui("暂无插图")}</p>}
          </div></div>}
        </main>
      </div>}
    {previewImage && <ImageInspector image={previewImage} characters={gallery.characters.map(item => ({ id: item.name, name: item.name }))} scenes={gallery.scenes.map(item => ({ id: item.sceneId, name: item.name }))}
      isDefault={isBound(previewImage)} busy={gallery.busy} error={gallery.error} index={previewImages.findIndex(image => image.id === preview)} count={previewImages.length}
      onSave={gallery.save} onUpload={gallery.upload} onRemove={gallery.remove} onUnbind={gallery.unbind} onClose={close}
      onOpenDocument={gallery.canOpenDocument ? () => { void gallery.openDocument(previewImage); } : undefined}
      onStep={step => { const index = previewImages.findIndex(image => image.id === preview); setPreview(previewImages[(index + step + previewImages.length) % previewImages.length]?.id); }} />}
  </ArchiveScreen>;
}
