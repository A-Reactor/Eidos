'use client';
import { useInterfaceText } from "@/components/shell/useInterfaceText";

import { useState, useSyncExternalStore } from 'react';
import { useGameStore } from '@/store/game-store';
import { getActionDiagnostics, selectActionDiagnostics, subscribeActionDiagnostics, type ActionDiagnostic } from '@/lib/game/action-diagnostics';
import type { CardSelectionTrace } from '@/lib/game/cards/types';
import { cardContextText } from '@/lib/game/cards/types';
import { AuthorReproControl } from './AuthorReproControl';
import { NativeTextAuthorTools } from './NativeTextAuthorTools';
import { saveFile } from '@/lib/game/save-file';

const empty: ActionDiagnostic[] = [];
const number = (n: number) => n.toLocaleString();
const labels = { received: '响应已收到，尚未结算', accepted: '已接受', rejected: '未执行', failed: '请求失败', discarded: '已丢弃（请求或分支已变化）' };
function download(entry: ActionDiagnostic) {
  return saveFile(new Blob([JSON.stringify(entry, null, 2)], { type: 'application/json' }), `eidos-context-${entry.id}.json`);
}
function Sources({ title, rows }: { title: string; rows: CardSelectionTrace[] }) {
  const ui = useInterfaceText();
  const bindings = useGameStore(s => s.currentWorld?.cardBindings);
  return <details className="border-t border-current/15 py-3"><summary className="cursor-pointer text-sm">{title}（{rows.length} {ui("条）")}</summary>
    <div className="mt-3 overflow-x-auto"><table className="w-full text-left text-xs"><thead><tr><th className="p-2">{ui("来源")}</th><th className="p-2">{ui("原因")}</th><th className="p-2">{ui("原文字符")}</th></tr></thead><tbody>
      {rows.slice(0, 200).map((row, i) => <tr key={`${row.assetId}:${row.pointer}:${i}`} className="border-t border-current/10"><td className="p-2 align-top"><b>{bindings?.find(b => b.assetId === row.assetId)?.name ?? row.assetId.slice(0, 12)}</b><code className="mt-1 block break-all opacity-65">{row.pointer || ui("（原卡根）")}</code></td><td className="p-2 align-top">{row.reason}</td><td className="p-2 align-top">{number(row.chars)}</td></tr>)}
    </tbody></table></div>{rows.length > 200 && <p className="text-xs opacity-60">{ui("显示前 200 条；导出本轮诊断包含完整记录。")}</p>}
  </details>;
}
export function AuthorToolsPage() {
  const ui = useInterfaceText();
  const [exportError, setExportError] = useState('');
  const state = useGameStore();
  const all = useSyncExternalStore(subscribeActionDiagnostics, getActionDiagnostics, () => empty);
  const records = selectActionDiagnostics(all, state), latest = records[0], previous = records[1];
  const budget = latest?.context?.budget ?? latest?.usage?.promptBudget;
  const prior = previous?.context?.budget ?? previous?.usage?.promptBudget;
  const cards = latest?.context?.cards;
  return <section className="eidos-settings-page" aria-label={ui("作者上下文工具")}>
    <h2>{ui("作者工具")}</h2><p className="text-sm opacity-65">{ui("只查看当前世界、周目与沙箱的最近请求。展开原文与变量会显示隐藏设定。记录仅保留在本机会话，刷新后清空；查看不会调用模型。")}</p>
    <AuthorReproControl />
    <NativeTextAuthorTools />
    {exportError && <p role="alert" className="eidos-document-notice">{exportError}</p>}
    {!latest ? <p role="status" className="py-6 text-sm">{ui("尚无当前周目的请求记录。进行一次行动后可查看实际检索、预算与结算结果。")}</p> : <>
      <div className="border-b border-current/15 py-4 text-sm"><p><b>{ui(labels[latest.status])}</b> · {latest.input}</p><p className="mt-1 text-xs opacity-60">{ui("请求来源节点（可来自回溯前）：")}{latest.scope.nodeId ?? ui("开场")} · {new Date(latest.timestamp).toLocaleTimeString()}</p>{latest.reason && <p className="mt-2" role="status">{latest.reason}</p>}</div>
      {(latest.fileOutcome || latest.operationOutcome || latest.selectedFileEffects?.length) && <p className="py-3 text-sm" role="status">
        {latest.fileOutcome === 'failed' ? ui("文件操作未完成。") : latest.operationOutcome === 'failed' ? ui("本轮操作未全部完成。") : ui("已记录终局操作结果。")}
        {ui("终局选择文件改动")}{latest.selectedFileEffects?.length ?? 0} {ui("项；接受正文不代表文件已合并，实际生效以文件回执为准。")}</p>}
      <h3 className="pt-4 font-medium">{ui("完整请求预算")}</h3>
      {budget ? <><p className="py-2 text-sm">{ui("文本输入估算")}{number(budget.inputTokensEstimated)} {ui("+ 生成预留")}{number(budget.outputTokens)} / {budget.windowTokens ? number(budget.windowTokens) : ui("上限未知")} token · {budget.modelId}</p>
        <p className="text-xs opacity-65">{ui("估算按 UTF-8 文本计算，并非模型 tokenizer 的精确结果。缓存命中的输入仍占上下文。")}{budget.outputAdjusted && ui(" 本次已缩减额外思考预留，保留正文额度。")}{budget.mediaUnestimated && ui(" 媒体 token 尚未估算。")}</p>
        <table className="my-3 w-full text-left text-xs"><thead><tr><th className="py-2">{ui("组成")}</th><th>{ui("字符")}</th><th>{ui("估算 token")}</th></tr></thead><tbody>{budget.sections.map(row => <tr key={row.id} className="border-t border-current/10"><td className="py-2">{ui(row.label)}</td><td>{number(row.chars)}</td><td>{number(row.estimatedTokens)}</td></tr>)}</tbody></table>
        <p className="text-xs opacity-65">{ui("稳定前缀")}{number(budget.stablePrefixChars)} {ui("字符")}{prior ? budget.stablePrefixHash === prior.stablePrefixHash && budget.stablePrefixChars === prior.stablePrefixChars ? ui(" · 与上一请求一致") : ui(" · 与上一请求不同") : ''}{ui("。实际是否命中以供应商返回为准。")}</p>
      </> : <p className="py-2 text-sm opacity-60">{ui("此请求没有完整预算记录。")}</p>}
      {latest.usage && <p className="py-3 text-sm">{latest.usage.usageEstimated ? ui("返回用量为估算") : ui("返回输入用量")}：{number(latest.usage.promptTokens)} token · {latest.usage.cacheUsageReported ? ui("缓存命中 {0} token", {"0": number(latest.usage.cachedTokens ?? 0)}) : ui("缓存统计未知")}</p>}
      {latest.context?.history && <p className="py-2 text-xs opacity-65">{ui("最近行动记录：提供")}{latest.context.history.provided} {ui("条，保留")}{latest.context.history.retained} {ui("条")}{latest.context.history.omitted ? ui("；为完整预算整条省略最早的 {0} 条，关键事实和原卡保持完整。", {"0": latest.context.history.omitted}) : '。'}</p>}
      {cards ? <><Sources title={ui("实际选入的原卡")} rows={cards.selected} /><Sources title={ui("未选入的原卡")} rows={cards.omitted} />
        <details className="border-t border-current/15 py-3"><summary className="cursor-pointer text-sm">{ui("查看实际选入原文与条件求值结果（含隐藏设定）")}</summary><pre className="mt-3 whitespace-pre-wrap break-words text-xs leading-6">{cardContextText(cards)}</pre></details></> : <p className="border-t border-current/15 py-3 text-sm opacity-60">{ui("此轮没有原卡检索记录。")}</p>}
      <details className="border-t border-current/15 py-3"><summary className="cursor-pointer text-sm">{ui("变量与模组规则提案 ·")}{latest.status === 'accepted' ? ui("已按接受结果结算") : ui("尚未结算或已拒绝")}</summary><pre className="mt-3 whitespace-pre-wrap break-words text-xs leading-6">{JSON.stringify({ cardVariableUpdates: latest.variableUpdates ?? [], pluginEvents: latest.pluginEvents ?? [] }, null, 2)}</pre></details>
      {Boolean(latest.operations?.length) && <details className="border-t border-current/15 py-3"><summary className="cursor-pointer text-sm">{ui("文件与游戏操作回执")}</summary><pre className="mt-3 whitespace-pre-wrap break-words text-xs leading-6">{JSON.stringify(latest.operations, null, 2)}</pre></details>}
      <button className="eidos-focus eidos-dossier-action min-h-10 px-4 py-2 text-sm" onClick={async () => {
        try { await download(latest); setExportError(''); } catch (cause) { setExportError(cause instanceof Error ? cause.message : ui("诊断导出失败")); }
      }}>{ui("导出本轮诊断")}</button>
    </>}
  </section>;
}
