// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { expect, it } from 'vitest';
import { createWorkspaceSession, runWorkspaceTool } from '@/lib/game/workspace/session';

it('reports changed text lines from actual staged versions, including replacements and final newlines', async () => {
  const session = await createWorkspaceSession({ scope: { worldId: crypto.randomUUID(), playthroughId: 'stats' }, actionId: 'lines', parentNodeId: null, inputs: [] });
  const path = 'drafts/lines/a.txt';
  const written = await runWorkspaceTool(session, { method: 'files.write', params: { path, expectedVersion: null, text: '一\n二\n三\n' } });
  expect(written.changes).toEqual({ added: 3, removed: 0 });
  const patched = await runWorkspaceTool(session, { method: 'files.patch', params: { path, expectedVersion: written.afterVersion, oldText: '二', newText: '四\n五' } });
  expect(patched.changes).toEqual({ added: 2, removed: 1 });
  const failed = await runWorkspaceTool(session, { method: 'files.patch', params: { path, expectedVersion: written.afterVersion, oldText: '一', newText: '伪造' } });
  expect(failed.status).toBe('failed'); expect(failed.changes).toBeUndefined();
});
