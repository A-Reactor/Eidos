'use client';
import { useInterfaceText } from "@/components/shell/useInterfaceText";


import { useEffect, useRef, useState } from 'react';
import { InteractionDialog } from '@/components/ui/InteractionDialog';
import { ActionButton } from '@/components/ui/ActionButton';
import { CHARACTER_IMAGE_TAGS, SCENE_IMAGE_TAGS, imageTags } from '@/lib/game/midori/image-tags';
import type { ImageResource, ImageResourceType } from '@/lib/game/midori/image-resource';
import { ImageImportTile } from './ResourceGrid';
import type { ImageUploadTarget } from './use-gallery-resources';
import { canAdaptImageOriginal } from '@/lib/game/midori/image-original';

interface ImageTarget { id: string; name: string }
export function ImageInspector({ image, characters, scenes, isDefault, busy, error, index, count, onSave, onUpload, onRemove, onUnbind, onClose, onStep, onOpenDocument }: {
  image: ImageResource; characters: ImageTarget[]; scenes: ImageTarget[]; isDefault: boolean; busy: boolean; index: number; count: number;
  error?: string | null;
  onSave: (image: ImageResource, makeDefault?: boolean) => Promise<boolean>; onUpload: (file: File, target: ImageUploadTarget) => Promise<void>;
  onRemove: (image: ImageResource) => Promise<boolean>; onUnbind: (image: ImageResource) => Promise<void>; onClose: () => void; onStep: (step: number) => void;
  onOpenDocument?: () => void;
}) {
  const ui = useInterfaceText();
  const close = () => {
    // Closing by Escape or the backdrop must commit the same blur edits as clicking another field.
    const active = document.activeElement;
    if (active instanceof HTMLElement && active.closest('.eidos-gallery-metadata')) active.blur();
    onClose();
  };
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement)?.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); onStep(event.key === 'ArrowLeft' ? -1 : 1); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onStep]);
  return <InteractionDialog title={ui("查看图像")} className="eidos-refined-dialog eidos-gallery-inspector" onClose={close}
    footer={<div className="eidos-gallery-preview-actions"><div className="eidos-gallery-inspector-actions">
      {canAdaptImageOriginal(image) && onOpenDocument && <ActionButton icon="file" label={ui("在文档中查看")} iconOnly={false} disabled={busy} onClick={onOpenDocument} />}
      {image.type !== 'illustration' && image.imageUrl && <ActionButton icon={isDefault ? 'undo' : 'image'} label={isDefault ? ui("解除绑定") : ui("设为默认")} iconOnly={false}
        onClick={() => isDefault ? onUnbind(image) : onSave(image, true)} disabled={busy} />}
      <ActionButton icon="trash" label={ui("删除")} iconOnly={false} disabled={busy} onClick={async () => { if (await onRemove(image)) onClose(); }} />
    </div><div><span>{index + 1} / {count}</span>
      {count > 1 && <><ActionButton icon="back" label={ui("上一张图像")} onClick={() => onStep(-1)} /><ActionButton icon="next" label={ui("下一张图像")} onClick={() => onStep(1)} /></>}
      <ActionButton icon="close" label={ui("关闭")} onClick={close} />
    </div></div>}>
    <div className="eidos-gallery-inspector-layout">
      <figure>{image.imageUrl ? <img src={image.imageUrl} alt={image.label} /> : <ImageImportTile target={{ type: image.type, targetId: image.targetId, label: image.label, resource: image }} busy={busy} onUpload={onUpload} />}</figure>
      <ImageMetadata key={image.id} {...{ image, characters, scenes, onSave }} />
    </div>
    {error && <p role="alert" className="eidos-gallery-error">{error}</p>}
  </InteractionDialog>;
}

function ImageMetadata({ image, characters, scenes, onSave }: {
  image: ImageResource; characters: ImageTarget[]; scenes: ImageTarget[]; onSave: (image: ImageResource, makeDefault?: boolean) => Promise<boolean>;
}) {
  const ui = useInterfaceText();
  const [tag, setTag] = useState('');
  const [label, setLabel] = useState(image.label);
  const [description, setDescription] = useState(image.description);
  const [error, setError] = useState(false);
  const latest = useRef(image);
  useEffect(() => { latest.current = image; }, [image]);
  const writes = useRef(Promise.resolve(true));
  const save = (patch: Partial<ImageResource>) => {
    const pending = writes.current.then(async () => {
    const next = { ...latest.current, ...patch }, ok = await onSave(next);
    if (ok) latest.current = next;
    setError(!ok); return ok;
    });
    writes.current = pending.catch(() => false);
    return pending;
  };
  const addTag = async () => {
    if (!tag.trim()) return;
    if (await save({ tags: imageTags([...latest.current.tags, tag]) })) setTag('');
  };
  const suggestions = image.type === 'character' ? CHARACTER_IMAGE_TAGS : image.type === 'scene' ? SCENE_IMAGE_TAGS : [];
  const targets = image.type === 'character' ? characters : scenes;
  const changeType = (type: ImageResourceType) => {
    const targetId = type === 'character' ? characters[0]?.id : type === 'scene' ? scenes[0]?.id : image.targetId;
    if (type !== 'illustration' && !targetId) return;
    save({ type, targetId: targetId ?? '', slot: type === 'character' ? 'portrait' : type === 'scene' ? 'background' : 'detail' });
  };
  return <aside className="eidos-gallery-metadata" aria-label={ui("图像信息")}>
    <label>{ui("名称")}<input aria-label={ui("图像名称")} value={label} maxLength={160} onChange={event => setLabel(event.target.value)} onBlur={() => { if (label !== image.label) save({ label }); }} /></label>
    <fieldset><legend>{ui("标签")}</legend>
      <div className="eidos-gallery-edit-tags">{image.tags.map(value => <button type="button" key={value} aria-label={ui("删除标签：{0}", {"0": value})} onClick={() => save({ tags: image.tags.filter(item => item !== value) })}>{value}<span aria-hidden="true">×</span></button>)}</div>
      <form className="eidos-gallery-add-tag" onSubmit={event => { event.preventDefault(); addTag(); }}>
        <input aria-label={ui("新标签")} placeholder={ui("新标签")} value={tag} maxLength={48} onChange={event => setTag(event.target.value)} onBlur={addTag} />
        <ActionButton icon="plus" label={ui("添加标签")} type="submit" disabled={!tag.trim()} />
      </form>
      <div className="eidos-gallery-tag-suggestions">{suggestions.filter(value => !image.tags.includes(value)).map(value => <button type="button" key={value} onClick={() => save({ tags: imageTags([...image.tags, value]) })}>+ {value}</button>)}</div>
    </fieldset>
    <label>{ui("描述")}<textarea aria-label={ui("图像描述")} value={description} maxLength={4000} rows={4} placeholder={ui("画面、服饰或适用情境")} onChange={event => setDescription(event.target.value)} onBlur={() => { if (description !== image.description) save({ description }); }} /></label>
    <div className="eidos-gallery-image-owner"><label>{ui("类别")}<select aria-label={ui("图像类别")} value={image.type} onChange={event => changeType(event.target.value as ImageResourceType)}>
      <option value="character" disabled={!characters.length}>{ui("人物")}</option><option value="scene" disabled={!scenes.length}>{ui("场景")}</option><option value="illustration">{ui("插图")}</option>
    </select></label>
    <label>{image.type === 'character' ? ui("人物") : ui("场景")}<select aria-label={ui("图像所属对象")} value={image.targetId} onChange={event => save({ targetId: event.target.value })}>
      {image.type === 'illustration' && <option value="">{ui("独立插图")}</option>}
      {!targets.some(target => target.id === image.targetId) && image.targetId && <option value={image.targetId}>{image.targetId}</option>}
      {targets.map(target => <option key={target.id} value={target.id}>{target.name}</option>)}
    </select></label></div>
    {error && <p role="alert">{ui("未能保存，请重试")}</p>}
  </aside>;
}
