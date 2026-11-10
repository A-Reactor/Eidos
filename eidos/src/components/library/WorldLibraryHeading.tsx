"use client";

import { useCallback, useEffect, useImperativeHandle, useRef, useState, type Ref, type ClipboardEvent, type KeyboardEvent, type FocusEvent } from 'react';
import { useI18n } from '@/components/shell/LocaleProvider';
import type { WorldDefinition } from '@/lib/game/types';

export interface WorldLibraryHeadingHandle {
  commit(): boolean | Promise<boolean>;
  getWorld(): WorldDefinition;
}

/** Native editable text retains the heading's typography and never adds a form row. */
export function WorldLibraryHeading({ world, disabled, editorRef, onSave, onError }: {
  world: WorldDefinition; disabled: boolean; editorRef: Ref<WorldLibraryHeadingHandle>;
  onSave(name: string, subtitle: string): Promise<boolean>; onError(message: string | null): void;
}) {
  const { locale, t } = useI18n();
  const name = useRef<HTMLSpanElement>(null), subtitle = useRef<HTMLSpanElement>(null);
  const committed = useRef({ name: world.name, subtitle: world.subtitle });
  const active = useRef(false);
  const saving = useRef<Promise<boolean> | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!active.current && !saving.current) committed.current = { name: world.name, subtitle: world.subtitle };
  }, [world.name, world.subtitle]);
  const commit = useCallback((): boolean | Promise<boolean> => {
    if (saving.current) return saving.current;
    const next = { name: name.current?.textContent?.trim() ?? '', subtitle: subtitle.current?.textContent?.trim() ?? '' };
    active.current = false;
    if (!next.name) {
      onError(locale === 'en' ? 'World title cannot be empty.' : '世界名称不能为空。');
      return false;
    }
    if (next.name === committed.current.name && next.subtitle === committed.current.subtitle) return true;
    setBusy(true); onError(null);
    let result: Promise<boolean>;
    try { result = onSave(next.name, next.subtitle); }
    catch (error) { result = Promise.reject(error); }
    const request = result.then(success => {
      if (!success) { onError(t('library.actionFailed')); return false; }
      committed.current = next;
      if (name.current) name.current.textContent = next.name;
      if (subtitle.current) subtitle.current.textContent = next.subtitle;
      return true;
    }, () => { onError(t('library.actionFailed')); return false; })
      .finally(() => { saving.current = null; setBusy(false); });
    saving.current = request;
    return request;
  }, [locale, onSave, onError, t]);
  useImperativeHandle(editorRef, () => ({ commit, getWorld: () => ({ ...world, ...committed.current }) }), [commit, world]);

  useEffect(() => {
    const outside = (event: MouseEvent) => {
      if (!(event.target instanceof Node) || name.current?.contains(event.target) || subtitle.current?.contains(event.target)) return;
      if (active.current) {
        const focused = document.activeElement;
        if (focused === name.current || focused === subtitle.current) (focused as HTMLElement).blur();
        else void commit();
      }
    };
    document.addEventListener('click', outside, true);
    return () => document.removeEventListener('click', outside, true);
  }, [commit]);

  const handleBlur = (event: FocusEvent<HTMLSpanElement>) => {
    if (event.relatedTarget === name.current || event.relatedTarget === subtitle.current) return;
    void commit();
  };
  const key = (event: KeyboardEvent<HTMLSpanElement>) => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === 'Enter' || event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); event.currentTarget.blur(); }
  };
  const paste = (event: ClipboardEvent<HTMLSpanElement>) => {
    event.preventDefault();
    const text = event.clipboardData.getData('text/plain').replace(/[\r\n]+/g, ' ');
    const selection = window.getSelection();
    if (!selection?.rangeCount) return;
    const range = selection.getRangeAt(0);
    if (!event.currentTarget.contains(range.commonAncestorContainer)) return;
    range.deleteContents();
    const node = document.createTextNode(text);
    range.insertNode(node); range.setStartAfter(node); range.collapse(true);
    selection.removeAllRanges(); selection.addRange(range);
  };
  const editable = {
    role: 'textbox', 'aria-multiline': false,
    contentEditable: disabled || busy ? false as const : 'plaintext-only' as const,
    suppressContentEditableWarning: true, tabIndex: disabled || busy ? -1 : 0,
    className: 'eidos-library-heading-editable',
  };
  return <div className="min-w-[150px] flex-1" aria-busy={busy}>
    <h2 className="text-2xl font-semibold"><span ref={name} {...editable} aria-label={t('library.renameName')}
      onFocus={() => { active.current = true; }} onBlur={handleBlur} onKeyDown={key} onPaste={paste}>{world.name}</span></h2>
    <div className="mt-1 text-sm opacity-65"><span ref={subtitle} {...editable} aria-label={t('library.renameSubtitle')}
      onFocus={() => { active.current = true; }} onBlur={handleBlur} onKeyDown={key} onPaste={paste}
      data-placeholder={locale === 'en' ? 'Add subtitle' : '添加副标题'}>{world.subtitle}</span></div>
  </div>;
}
