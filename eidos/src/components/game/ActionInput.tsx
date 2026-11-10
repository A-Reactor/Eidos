"use client";
import { useInterfaceText } from "@/components/shell/useInterfaceText";


import { useRef, useLayoutEffect, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { ActionButton } from '@/components/ui/ActionButton';
import { ActionIcon } from '@/components/ui/ActionIcon';
import { InlineDocumentText } from './InlineDocumentText';
import { editVisibleText } from '@/lib/game/documents/composer';
import { inlineDocumentTokens, plainDocumentText } from '@/lib/game/documents/inline-links';
import { useGameStore } from "@/store/game-store";
import { actionActivityText, type ActionActivityPhase } from '@/lib/game/action-activity';
import type { DocumentLink } from '@/lib/game/documents/types';
import type { ActionRecord } from '@/lib/game/types';

interface ActionInputProps {
  tools?: ReactNode;
  toolsMenu?: ReactNode;
  divider?: ReactNode;
  inputElementRef?: RefObject<HTMLTextAreaElement | null>;
  onStop?: () => void;
  allSegmentsShown: boolean;
  isLoading: boolean;
  generationPhase?: ActionActivityPhase;
  generationError?: string | null;
  onRetry?: () => void;
  inputValue: string;
  onInputChange: (v: string) => void;
  onFileDrop?: (file: File) => void | Promise<void>;
  onFilesDrop?: (files: File[]) => void | Promise<void>;
  onSubmit: (text?: string) => void;
  documentLinks?: DocumentLink[];
  onPickDocuments?: () => void;
  documentPicker?: ReactNode;
  onRestoreDocuments?: (links: DocumentLink[]) => void;
  onRecallAction?: (action: ActionRecord) => void;
  /** 提交前的输入文字（加载中时显示） */
  preActionInput: string;
}

export function ActionInput({
  allSegmentsShown, isLoading, inputValue,
  onInputChange, onFileDrop, onFilesDrop, onSubmit,
  tools, toolsMenu, divider, inputElementRef, onStop,
  generationPhase = 'waiting', generationError, onRetry,
  documentLinks = [], onPickDocuments, documentPicker, onRecallAction, onRestoreDocuments,
}: ActionInputProps) {
  const ui = useInterfaceText();
  const linkLayer = useRef<HTMLDivElement>(null);
  const localInputRef = useRef<HTMLTextAreaElement>(null);
  const inputRef = inputElementRef ?? localInputRef;
  const historyDraft = useRef("");
  const historyRefs = useRef<DocumentLink[]>([]);
  const historyIdx = useRef(-1);
  useLayoutEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.style.height = 'auto';
    input.style.height = `${Math.min(160, Math.max(48, input.scrollHeight))}px`;
    if (linkLayer.current) { linkLayer.current.scrollTop = input.scrollTop; linkLayer.current.scrollLeft = input.scrollLeft; }
  }, [inputValue, inputRef]);
  const placeholder = isLoading
    ? "生成中，可先编辑下一步行动…"
    : !allSegmentsShown
      ? "随时输入行动…"
      : "描述你的行动…";
  const actionLabel = isLoading ? onStop ? '停止生成' : '正在生成' : '发送行动';
  const actionDisabled = isLoading ? !onStop : !inputValue.trim();
  const send = () => { if (!isLoading && inputValue.trim()) onSubmit(); };
  const handleFileDrop = (event: React.DragEvent<HTMLTextAreaElement>) => {
    const files = Array.from(event.dataTransfer.files ?? []);
    if (files.length === 0 || (!onFilesDrop && !onFileDrop)) return;
    event.preventDefault();
    event.stopPropagation();
    if (onFilesDrop) {
      onFilesDrop(files);
    } else {
      onFileDrop?.(files[0]);
    }
    inputRef.current?.focus();
  };

  return (
    <div className="eidos-action-composer relative">
      {isLoading && <div role="status" aria-label={ui("生成状态")} className="relative z-0 px-4 py-1 text-xs text-white/60">
        {actionActivityText[generationPhase]}
      </div>}
      {generationError && <div role="alert" className="eidos-file-notice relative z-0">
        <ActionIcon name="alert" /><span className="min-w-0 flex-1">{generationError}</span>
        {onRetry && <ActionButton icon="refresh" label={ui("重试文档保存")} onClick={onRetry} />}
      </div>}
      {divider}
      {/* Anchor menus to the input bar so notices cannot push them upward. */}
      <div className="eidos-composer-controls relative">
      {toolsMenu}
      {documentPicker}

      {/* 文本输入区 */}
      <div className="eidos-inputglass flex min-h-12 items-center overflow-hidden text-white">
        {tools}
        {onPickDocuments && <ActionButton icon="attach" label={ui("引用文档")} data-document-picker-trigger aria-expanded={Boolean(documentPicker)} className="eidos-composer-attachment" onClick={onPickDocuments} />}
        <div className="eidos-composer-editor">
        {inlineDocumentTokens(inputValue).length > 0 && <div ref={linkLayer} className="eidos-composer-text-metrics eidos-composer-link-layer"><InlineDocumentText text={inputValue} /><span aria-hidden="true">{'\u200b'}</span></div>}
        <textarea
          ref={inputRef}
          aria-label={ui("行动输入")}
          value={plainDocumentText(inputValue)}
          onChange={(e) => { historyIdx.current = -1; onInputChange(editVisibleText(inputValue, e.target.value)); }}
          onScroll={event => { if (linkLayer.current) { linkLayer.current.scrollTop = event.currentTarget.scrollTop; linkLayer.current.scrollLeft = event.currentTarget.scrollLeft; } }}
          onDragOver={(e) => {
            if ((onFilesDrop || onFileDrop) && e.dataTransfer.types.includes("Files")) e.preventDefault();
          }}
          onDrop={handleFileDrop}
          onKeyDown={(e: KeyboardEvent<HTMLTextAreaElement>) => {
            if (e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) return;
            if (e.key === "Enter" && !e.shiftKey) {
              if (window.matchMedia?.('(max-width: 767px) and (pointer: coarse)').matches) return;
              e.preventDefault();
              send();
            } else if (e.key === "Escape") {
              e.preventDefault();
              (e.target as HTMLTextAreaElement).blur();
            } else if (e.key === "ArrowUp" && e.altKey) {
              e.preventDefault();
              const h = useGameStore.getState().history;
              if (h.length > 0) {
                if (historyIdx.current < 0) { historyDraft.current = inputValue; historyRefs.current = documentLinks; }
                const ni = historyIdx.current < 0 ? h.length - 1 : Math.max(0, historyIdx.current - 1);
                historyIdx.current = ni; onInputChange(h[ni].playerInput); onRecallAction?.(h[ni]);
              }
            } else if (e.key === "ArrowDown" && e.altKey) {
              e.preventDefault();
              const h = useGameStore.getState().history;
              if (historyIdx.current >= 0 && historyIdx.current < h.length - 1) {
                const ni = historyIdx.current + 1;
                historyIdx.current = ni; onInputChange(h[ni].playerInput); onRecallAction?.(h[ni]);
              } else { historyIdx.current = -1; onInputChange(historyDraft.current); onRestoreDocuments?.(historyRefs.current); }
            }
          }}
          placeholder={placeholder}
          title={isLoading ? ui("生成中可编辑草稿，点击方块停止后发送；Shift+Enter 换行") : ui("Enter 发送，Shift+Enter 换行，Alt+↑↓ 输入历史；触屏键盘回车换行")}
          rows={1}
          className="eidos-composer-text-metrics min-h-12 min-w-0 max-h-40 w-full resize-none border-0 bg-transparent text-zinc-100 placeholder:text-white/54 outline-none disabled:opacity-50"
        />
        </div>
        <button
          type="button"
          aria-label={actionLabel}
          title={actionLabel}
          data-state={isLoading ? 'generating' : actionDisabled ? 'empty' : 'ready'}
          onClick={isLoading ? onStop : send}
          disabled={actionDisabled}
          className="eidos-composer-action eidos-focus"
        >
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none">
            {isLoading ? <rect x="6" y="6" width="12" height="12" rx="1.5" fill="currentColor" />
              : <path d="M12 19V5m-6 6 6-6 6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />}
          </svg>
        </button>
      </div>
      </div>
    </div>
  );
}
