"use client";
import { useInterfaceText } from "@/components/shell/useInterfaceText";


import { useRef, useState, type ReactNode, type RefObject } from "react";

interface Props {
  label: string;
  inputLabel: string;
  accept: string;
  multiple?: boolean;
  disabled?: boolean;
  inputRef?: RefObject<HTMLInputElement | null>;
  className?: string;
  children: ReactNode;
  onFiles: (files: File[]) => Promise<void>;
}

/** Both picker and drop use the same import path; read dropped files before awaiting. */
export function FileImportZone({ label, inputLabel, accept, multiple = false, disabled = false, inputRef, className = "", children, onFiles }: Props) {
  const ui = useInterfaceText();
  const ownInput = useRef<HTMLInputElement>(null);
  const input = inputRef ?? ownInput;
  const activeImport = useRef(false);
  const depth = useRef(0);
  const [hovering, setHovering] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = disabled || pending;
  const submit = async (files: File[]) => {
    if (disabled || activeImport.current) return;
    if (!files.length) { setError("未读取到文件，请拖入文件或点击选择文件。"); return; }
    if (!multiple && files.length > 1) { setError("请一次导入一个文件。"); return; }
    activeImport.current = true; setPending(true); setError(null);
    try { await onFiles(files); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "文件导入失败，请重试。"); }
    finally { activeImport.current = false; setPending(false); }
  };
  const openPicker = () => { if (!disabled && !activeImport.current) input.current?.click(); };

  return <>
    <div role="button" title={label} aria-label={label} aria-disabled={busy} aria-busy={pending} tabIndex={busy ? -1 : 0}
      data-drag-active={hovering && !busy ? "true" : undefined}
      className={`eidos-file-import-zone eidos-focus ${className}`}
      onClick={openPicker}
      onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); openPicker(); } }}
      onDragEnter={(event) => { event.preventDefault(); event.stopPropagation(); depth.current += 1; if (!busy) setHovering(true); }}
      onDragOver={(event) => { event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = busy ? "none" : "copy"; }}
      onDragLeave={(event) => { event.preventDefault(); event.stopPropagation(); depth.current = Math.max(0, depth.current - 1); if (!depth.current) setHovering(false); }}
      onDrop={(event) => {
        event.preventDefault(); event.stopPropagation(); depth.current = 0; setHovering(false);
        // Some webviews expose DataTransferItemList even when FileList is empty.
        const files = Array.from(event.dataTransfer.files ?? []);
        if (!files.length) for (const item of Array.from(event.dataTransfer.items ?? [])) {
          if (item.kind === "file") { const file = item.getAsFile(); if (file) files.push(file); }
        }
        void submit(files);
      }}>
      {children}
      {pending && <span role="status" className="mt-2 block text-xs">{ui("正在导入…")}</span>}
      {error && <span role="alert" className="mt-2 block text-xs text-red-500">{error}</span>}
    </div>
    <input ref={input} aria-label={inputLabel} className="sr-only" tabIndex={-1} type="file" accept={accept} multiple={multiple} disabled={busy}
      onChange={(event) => { const files = Array.from(event.target.files ?? []); event.target.value = ""; if (files.length) void submit(files); }} />
  </>;
}
