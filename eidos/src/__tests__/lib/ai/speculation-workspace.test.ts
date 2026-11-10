// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { expect, it, vi } from 'vitest';
import { buildRiftCityStartState } from '@/lib/test/fixtures';
import { processPlayerAction } from '@/lib/ai/action-handler';
import { SpeculativeEngine } from '@/lib/ai/speculation';
import { createWorkspaceSession, getWorkspaceSession } from '@/lib/game/workspace/session';
import { loadDocuments } from '@/lib/game/documents/repository';
vi.mock('@/lib/ai/action-handler', () => ({ processPlayerAction: vi.fn() }));
it('runs file tools in a private prediction branch and caches its identity without publishing documents', async () => {
  const { world, snapshot } = buildRiftCityStartState(), scope = { worldId: world.id, playthroughId: crypto.randomUUID() };
  vi.mocked(processPlayerAction).mockImplementation(async args => {
    const result = args.workspaceContext?.results[0];
    return (result ? { segments: [{ type: 'narration', text: '她递来[报告](document:report)。' }], documents: [{ key: 'report', title: '报告', format: 'text', artifactRef: { path: result.path!, version: result.afterVersion! } }] }
      : { workspaceRequest: { method: 'files.write', params: { path: `${args.workspaceContext!.draftRoot}/report.txt`, text: '完整正文', expectedVersion: null } } }) as never;
  });
  const engine = new SpeculativeEngine();
  await engine.triggerSpeculation(['写报告'], { scope: 'prediction', world, snapshot, recentHistory: [], inventory: [], clues: [], encyclopedia: [], criticalFacts: [], questLog: [], weather: '', protagonistState: null, clientSettings: null,
    createWorkspace: async (actionId, isCurrent) => createWorkspaceSession({ scope, actionId, parentNodeId: null, inputs: [], isCurrent }) });
  const response = engine.peekPrimary('prediction')!.response;
  expect(processPlayerAction).toHaveBeenCalledTimes(2);
  expect(response._workspaceSessionId).toBeTruthy();
  const session = getWorkspaceSession(response._workspaceSessionId!)!;
  expect(Object.keys(session.files)).toHaveLength(1);
  expect(await loadDocuments(scope)).toEqual([]);
  engine.cancel();
  expect(session.closed).toBe(true);
});
