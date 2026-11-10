import type { AiChatRequest } from './types';

export interface AiMediaPart { type: 'image' | 'document'; mimeType: string; data: string }
/** Transport support is distinct from the selected model's actual capabilities. */
export function validateMedia(request: AiChatRequest, images: boolean, documents: boolean): AiMediaPart[] {
  const media = request.media ?? [];
  if (media.length > 8) throw new Error('单次材料过多，请分批处理');
  for (const part of media) {
    if (part.type === 'image' ? !images : part.type === 'document' ? !documents : true) throw new Error('当前接口不支持这类媒体输入，请换用支持的接口或提供文本');
    if (part.type === 'image' && !['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(part.mimeType) || part.type === 'document' && part.mimeType !== 'application/pdf') throw new Error('当前接口不支持此材料格式');
    if (!part.data || part.data.length > 5_600_000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(part.data)) throw new Error('媒体数据无效或过大');
  }
  return media;
}
export function openAiUserContent(request: AiChatRequest, supported: boolean): unknown {
  const media = validateMedia(request, supported, false);
  return media.length ? [{ type: 'text', text: request.userMessage }, ...media.map(part => ({ type: 'image_url', image_url: { url: `data:${part.mimeType};base64,${part.data}` } }))] : request.userMessage;
}
export function anthropicUserContent(request: AiChatRequest, message: string): unknown {
  const media = validateMedia(request, true, true);
  return media.length ? [...media.map(part => ({ type: part.type, source: { type: 'base64', media_type: part.mimeType, data: part.data } })), { type: 'text', text: message }] : message;
}
export function geminiUserParts(request: AiChatRequest): unknown[] {
  return [{ text: request.userMessage }, ...validateMedia(request, true, true).map(part => ({ inlineData: { mimeType: part.mimeType, data: part.data } }))];
}
