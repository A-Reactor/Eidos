import type { WorkspaceSession } from '../workspace/session';
import type { WorkspaceToolResult } from '../workspace/types';

/** A final patch includes its unselected ancestors, but publishes only selected paragraph states. */
export function libraryRevisionEffects(session: WorkspaceSession, selected: WorkspaceToolResult[]): WorkspaceToolResult[] {
  const heads = new Map<string, string>();
  return selected.map(receipt => {
    const path = receipt.path!, base = heads.get(path) ?? session.initialFiles[path]?.id;
    let cursor = receipt.beforeVersion;
    const index = session.receipts.findIndex(item => item.operationId === receipt.operationId);
    for (let i = index - 1; cursor !== base && i >= 0; i--) {
      const ancestor = session.receipts[i];
      if (ancestor.path === path && ancestor.status === 'staged' && ancestor.afterVersion === cursor) cursor = ancestor.beforeVersion;
    }
    if (!base || cursor !== base || !receipt.afterVersion) throw new Error('文档修改版本链不完整，请重新读取并修改');
    heads.set(path, receipt.afterVersion);
    return { ...receipt, beforeVersion: base };
  });
}
