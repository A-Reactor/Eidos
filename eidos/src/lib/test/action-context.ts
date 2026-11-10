import { renderExecutionContext } from '@/lib/game/action-execution-context';
import type { WorkspacePromptContext } from '@/lib/game/workspace/context';
import type { HistoryReadResult } from '@/lib/game/history-reader';
/** Inspect the evidence actually routed to the model, independently of its transport field. */
export function actionEvidence(context: { workspaceContext?: WorkspacePromptContext; longMemoryContext?: string; _longMemoryContext?: string }): string {
 return (context.longMemoryContext ?? context._longMemoryContext ?? '') + (context.workspaceContext?.execution ? renderExecutionContext(context.workspaceContext.execution) : '');
}
export function historyEvidence(context: { workspaceContext?: WorkspacePromptContext }): HistoryReadResult | undefined {
 return context.workspaceContext?.execution?.records.filter(r=>r.kind==='history').at(-1)?.result;
}
