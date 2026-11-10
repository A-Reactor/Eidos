export type CardRole = 'character' | 'world' | 'persona';
export interface CardBinding {
  assetId: string;
  role: CardRole;
  name: string;
  aliases?: string[];
  enabled: boolean;
}
export interface ParsedCard {
  kind: 'character' | 'worldbook';
  name: string;
  document: Record<string, unknown>;
  data: Record<string, unknown>;
  dataPointer: string;
}
export interface CardAsset extends ParsedCard {
  id: string;
  filename: string;
  originalBytes: Uint8Array;
  createdAt: number;
}
export interface CardSelectionTrace {
  assetId: string;
  pointer: string;
  reason: string;
  chars: number;
}
export interface CardActionContext {
  stablePrefix: string;
  dynamicSuffix: string;
  behaviorPrefix?: string;
  behaviorSuffix?: string;
  examples?: string;
  selected: CardSelectionTrace[];
  omitted: CardSelectionTrace[];
}
export function cardContextText(context: CardActionContext): string {
  return context.stablePrefix + context.dynamicSuffix + (context.behaviorPrefix ?? '') + (context.behaviorSuffix ?? '') + (context.examples ?? '');
}
export const MAX_CARD_FILE_BYTES = 20 * 1024 * 1024;
export const MAX_CARD_JSON_BYTES = 4 * 1024 * 1024;
export const DEFAULT_CARD_CONTEXT_CHARS = 24_000;
export const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
export const cardText = (value: unknown) => typeof value === 'string' ? value : '';
