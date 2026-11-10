import type { ActionToolRequest } from './action-operations';

// Paginated discovery must leave room for the edit it was preparing.
export const ACTION_TOOL_LIMITS = { read: 32, write: 16, game: 8, continuations: 60 } as const;
export function actionToolCategory(request: ActionToolRequest): 'read' | 'write' | 'game' {
  if (['files.list', 'files.search', 'files.read', 'history.read', 'web.search', 'web.open'].includes(request.method)) return 'read';
  if (['files.write', 'files.patch', 'files.rename'].includes(request.method)) return 'write';
  return 'game';
}
