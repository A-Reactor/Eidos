"use client";
import { useInterfaceText } from "@/components/shell/useInterfaceText";


import { useEffect, useState } from "react";
import { useGameStore } from "@/store/game-store";
import { voiceStatusLabel } from "@/lib/game/momoi/service-status";
import { fetchGalleryImages } from '@/lib/game/midori/image-manager';
import { imageResourceId } from '@/lib/game/midori/image-resource';
import { currentDocumentScope, documentScopeKey } from '@/lib/game/model-documents';
import { loadDocuments } from '@/lib/game/documents/repository';
import { playerDocuments } from '@/lib/game/documents/visibility';
import { ArchiveStatButton } from "./ArchiveStatButton";

export function ArchiveResourceActions({ onGallery, onMomoi, onDocuments }: {
  onGallery: () => void; onMomoi: () => void; onDocuments: () => void;
}) {
  const ui = useInterfaceText();
  const state = useGameStore();
  const scope = currentDocumentScope(state);
  const scopeKey = scope ? documentScopeKey(scope) : '';
  const [documents, setDocuments] = useState<{ key: string; count: number } | null>(null);
  useEffect(() => {
    if (!scope) return;
    let cancelled = false, sequence = 0;
    const refresh = () => { const version = ++sequence; void loadDocuments(scope).then(items => {
      if (!cancelled && version === sequence) setDocuments({ key: scopeKey, count: playerDocuments(items).length });
    }).catch(() => { if (!cancelled && version === sequence) setDocuments(null); }); };
    refresh(); window.addEventListener('eidos-documents-updated', refresh);
    return () => { cancelled = true; window.removeEventListener('eidos-documents-updated', refresh); };
  // The scope key includes every document owner field.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeKey]);
  const worldId = useGameStore(s => s.currentWorld?.id);
  const bindings = useGameStore(s => s.midoriAssetRegistry.bindings);
  const resources = useGameStore(s => s.midoriAssetRegistry.images);
  const removedImageIds = useGameStore(s => s.midoriAssetRegistry.removedImageIds);
  const voiceStatus = useGameStore(voiceStatusLabel);
  const [images, setImages] = useState<{ worldId: string; urls: string[] | null } | null>(null);
  useEffect(() => {
    if (!worldId) return;
    const abort = new AbortController();
    void (async () => {
      try {
        const data = await fetchGalleryImages(worldId, abort.signal);
        const urls = [...data.sceneImages, ...data.detailImages, ...data.illustrations, ...(data.npcImages ?? []), ...(data.regionImages ?? [])].map(image => image.url);
        if (!abort.signal.aborted) setImages({ worldId, urls });
      } catch {
        if (!abort.signal.aborted) setImages({ worldId, urls: null });
      }
    })();
    return () => abort.abort();
  }, [worldId]);
  const result = images?.worldId === worldId ? images : null;
  // Bindings may reuse generated images or belong to another world in the same session.
  const removed = new Set(removedImageIds ?? []);
  const count = result?.urls ? new Set([...result.urls, ...Object.values(bindings)
    .filter(binding => binding.worldId === worldId).map(binding => binding.imageUrl), ...Object.values(resources ?? {})
    .filter(image => image.worldId === worldId && !removed.has(image.id)).map(image => image.imageUrl)]
    .filter((url): url is string => Boolean(url && !removed.has(imageResourceId(url))))).size : null;
  return <div className="eidos-archive-actions" aria-label={ui("资源与服务")}>
    <ArchiveStatButton value={count ?? "—"} label={ui("图像管理")} hint={count !== null ? ui("张图像") : result ? ui("数量读取失败 · 打开资源库") : ui("正在读取数量…")} accessibleName="打开图像管理" onClick={onGallery} />
    <ArchiveStatButton value="MOMOI" label={ui("音频管理")} hint={voiceStatus} accessibleName="MOMOI 音频管理" onClick={onMomoi} />
    <ArchiveStatButton value={documents?.key === scopeKey ? documents.count : "—"} label={ui("文档管理")} hint={ui("报告与阅读笔记")} accessibleName="打开文档管理" onClick={onDocuments} />
  </div>;
}
