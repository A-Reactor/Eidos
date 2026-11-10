import type { AIGameResponse } from '@/lib/ai/types';
import type { WorkspacePromptContext } from '@/lib/game/workspace/context';

/** Offline provider boundary: the production executor still performs and validates every tool. */
export function documentPreviewResponse(input: string, ctx?: WorkspacePromptContext): Partial<AIGameResponse> | null {
  if (!ctx || !/报告|文档|改写|整理|书信|越权|更名|重命名/.test(input)) return null;
  const results = ctx.results, last = results.at(-1);
  const request = (method: 'files.search' | 'files.read' | 'files.write' | 'files.rename', params: Record<string, unknown>, actor?: { kind: 'character'; npcId: string; channelId: string }) => ({ workspaceRequest: { method, params, ...(actor ? { actor } : {}) } });
  const terminal = (text: string): Partial<AIGameResponse> => ({ segments: [{ type: 'narration', text }], summary: '整理文档', availableActions: ['核对资料并生成另一份报告'], timeSpent: { day: 0, hour: 0, minute: 1 }, workspaceEffects: [] });
  if (/书信|越权/.test(input) && ctx.channels?.length) {
    const grant = ctx.channels[0], actor = { kind: 'character' as const, npcId: input.includes('越权') ? '未授权角色' : grant.npcIds[0], channelId: grant.channelId };
    const file = ctx.mounts.find(entry => entry.path.startsWith(`meta/${grant.mountId}/`));
    if (!last && file) return request('files.read', { path: file.path, version: file.version }, actor);
    if (last?.status === 'denied' || last?.status === 'failed') return { ...terminal('文件通道拒绝了这次请求。桌上的书信保持原样。'), fileOutcome: 'failed' };
    if (last?.method === 'files.read') return request('files.write', { path: last.path, text: `${last.text}\n\n铃音的补记：我会保留信里的约定。`, expectedVersion: last.version }, actor);
    if (last?.operationId && last.status === 'staged') return { ...terminal('铃音读过原信，写下补记，再把书信放回桌上。'), workspaceEffects: [last.operationId] };
  }
  if (/冲突演示/.test(input)) {
    const file = ctx.mounts.find(entry => entry.path.startsWith('library/'));
    if (!last && file) return request('files.write', { path: file.path, expectedVersion: file.version, text: '共同记录\n模型添加：核对船夫的签名。' });
    if (last?.operationId) return { ...terminal(''), segments: [{ type: 'narration', text: '你在书桌前摊开资料，准备核对签名。' }, { type: 'narration', text: '你收好[核对报告](document:' + last.path!.split('/')[1] + ')，准备出发。', workspaceEffects: [last.operationId] }], workspaceEffects: [last.operationId], availableActions: ['沿河前往集市'] };
  }
  if (/更名|重命名/.test(input)) {
    const file = ctx.mounts.find(entry => entry.path.startsWith('library/'));
    if (!last && file) return request('files.rename', { path: file.path, expectedVersion: file.version, newName: '渡口核对清单.txt' });
    if (last?.status === 'denied' || last?.status === 'failed') return { ...terminal('未获得本次更名授权，文件保持原样。'), fileOutcome: 'failed' };
    if (last?.operationId) return { ...terminal('你将[核对清单](document:' + last.path!.split('/')[1] + ')更名后收好。'), workspaceEffects: [last.operationId], availableActions: ['核对[核对清单](document:' + last.path!.split('/')[1] + ')里的签名'] };
  }
  const source = ctx.mounts.find(entry => entry.selected) ?? ctx.mounts.find(entry => !entry.path.startsWith('meta/') && !entry.path.startsWith('drafts/'));
  if (!last && source) return request('files.search', { query: '签名', path: source.path });
  if (last?.method === 'files.search' && source) return request('files.read', { path: last.matches?.[0]?.path ?? source.path });
  if (!last || last.method === 'files.read') return request('files.write', { path: `${ctx.draftRoot}/report.md`, expectedVersion: null, text: '# 核对报告\n\n' + (last?.text ? `资料原文：\n\n${last.text}\n\n` : '') + '已将可见资料整理为报告。\n\n全文末尾：人物说法和未核实的推断仍需区分。' });
  if (last.method === 'files.write' && last.status === 'staged') return { ...terminal('你把整理好的[渡口资料核对报告](document:report)递给船夫。船夫仍在等你的下一句话。'), availableActions: ['核对[渡口资料核对报告](document:report)里的签名'], documents: [{ key: 'report', title: '渡口资料核对报告', format: 'markdown', artifactRef: { path: last.path!, version: last.afterVersion! } }] };
  return terminal('文件操作未能完成，原有资料保持原样。');
}
