'use client';
import { useInterfaceText } from "@/components/shell/useInterfaceText";

import { useEffect, useState } from 'react';
import type { ResourceRef } from '@/lib/game/workspace/types';
import { readResource } from '@/lib/game/workspace/resources';
import { isImageMimeType } from '@/lib/game/midori/image-format';

/** Only the original explicitly attached to this document version can be displayed. */
export function StoredDocumentImage({ resource, alt }: { resource: ResourceRef; alt: string }) {
  const ui = useInterfaceText();
  const [shown, setShown] = useState<{ id: string; url?: string; error?: string }>();
  useEffect(() => {
    let alive = true;
    void readResource(resource).then(original => {
      if (!isImageMimeType(original.mimeType) || !original.base64) throw new Error('图片原件格式无效');
      if (alive) setShown({ id: resource.id, url: `data:${original.mimeType};base64,${original.base64}` });
    }).catch(cause => { if (alive) setShown({ id: resource.id, error: cause instanceof Error ? cause.message : '图片读取失败' }); });
    return () => { alive = false; };
  }, [resource]);
  const current = shown?.id === resource.id ? shown : undefined;
  if (current?.error) return <span role="alert">{alt}：{current.error}</span>;
  return current?.url ? <img className="eidos-document-image" src={current.url} alt={alt} /> : <span role="status">{ui("正在读取图片…")}</span>;
}
