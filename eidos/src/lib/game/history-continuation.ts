import { renderExecutionContext } from './action-execution-context';
import type { HistoryReadSource } from './history-reader';
import { continueActionTools, type ActionToolResponse } from './action-tool-continuation';

/** Compatibility adapter; history and file reads share the same continuation budget. */
export function continueHistoryRead(input: {
  response: ActionToolResponse; source: HistoryReadSource; context?: string;
  isCurrent: () => boolean; onReadResponse: (response: ActionToolResponse) => void;
  invoke: (context: string) => Promise<ActionToolResponse>;
}): Promise<ActionToolResponse> {
  return continueActionTools({ response: input.response, historySource: input.source, session: null,
    context: { longMemoryContext: input.context ?? '', workspaceContext: { draftRoot: 'drafts/history', mounts: [], nextOffset: null, results: [] } },
    isCurrent: input.isCurrent, onResponse: input.onReadResponse, invoke: context => input.invoke(context.longMemoryContext + (context.workspaceContext.execution ? renderExecutionContext(context.workspaceContext.execution) : '')) });
}
