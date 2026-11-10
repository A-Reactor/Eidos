import type { WorldLineNode } from '../types';
import { getPlayerVisibleText } from '../player-reading';
import { recordPresentationRuns, presentationParagraphs } from '../presentation';

/** Project source segment boundaries too: lettering can add or erase visible paragraphs. */
export function receiptParagraphs(node: WorldLineNode, nodes: Record<string, WorldLineNode>, origin?: string | null): Record<number, number[]> {
  const result: Record<number, number[]> = {}, branch = node.workspaceBranch;
  const indices = new Set([...(branch?.documents ?? []).map(d => d.segmentIndex), ...[...branch?.effects ?? node.workspaceEffects ?? [], ...branch?.attempts ?? []].map(r => r.segmentIndex ?? 0)]);
  const visible = getPlayerVisibleText(node);
  for (const index of indices) {
    const range = node.presentation?.ranges[index];
    if (range && range.textEnd > visible.length) continue;
    const prefix = range ? visible.slice(0, range.end) : visible.split(/\n\n+/).slice(0, index + 1).join('\n\n');
    if (!prefix) continue;
    const paragraph = Math.max(0, presentationParagraphs(recordPresentationRuns({ ...node, playerVisibleText: prefix }, nodes, origin)).length - 1);
    (result[paragraph] ??= []).push(index);
  }
  return result;
}
