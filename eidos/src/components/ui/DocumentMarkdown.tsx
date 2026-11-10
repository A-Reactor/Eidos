'use client';
import { useInterfaceText } from "@/components/shell/useInterfaceText";

import Markdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { ResourceRef } from '@/lib/game/workspace/types';
import { isImageMimeType } from '@/lib/game/midori/image-format';
import { imageDocumentUrl } from '@/lib/game/midori/image-documents';
import { StoredDocumentImage } from './StoredDocumentImage';

/** Model text remains data: no raw HTML, scripts, or automatic remote image requests. */
export function DocumentMarkdown({ content, image }: { content: string; image?: ResourceRef }) {
  const ui = useInterfaceText();
  const local = image && isImageMimeType(image.mimeType) ? imageDocumentUrl(image.id) : undefined;
  return <Markdown remarkPlugins={[remarkGfm]} skipHtml urlTransform={url => url === local ? url : defaultUrlTransform(url)} components={{
    a: ({ href, children }) => <a href={href} target={href?.startsWith('#') ? undefined : '_blank'} rel="noopener noreferrer">{children}</a>,
    img: ({ src, alt }) => {
      if (image && src === local) return <StoredDocumentImage resource={image} alt={alt || ui("图片原件")} />;
      const href = typeof src === 'string' ? defaultUrlTransform(src) : '';
      return href ? <a href={href} target="_blank" rel="noopener noreferrer">{alt || ui("查看图片")}</a> : <span>{alt || ui("图片")}</span>;
    },
    table: ({ children }) => <div className="eidos-markdown-table"><table>{children}</table></div>,
    pre: ({ children }) => local ? <details className="eidos-image-document-metadata"><summary>{ui("图片资源信息")}</summary><pre>{children}</pre></details> : <pre>{children}</pre>,
  }}>{content}</Markdown>;
}
