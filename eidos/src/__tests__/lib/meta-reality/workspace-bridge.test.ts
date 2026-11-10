// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { expect, it } from 'vitest';
import { checkMetaWorkspaceAccess, prepareMetaWorkspaceEffects, applyMetaWorkspaceEffects } from '@/lib/meta-reality/workspace-bridge';
import { normalizeMetaChannelManifest } from '@/lib/meta-reality/manifest-editor';
import { createWorkspaceSession, runWorkspaceTool } from '@/lib/game/workspace/session';
import { storeResource } from '@/lib/game/workspace/resources';
import { workspaceOf } from '@/lib/game/plugins/workspace';
import { prepareActionArtifacts } from '@/lib/game/documents/action-artifacts';
import type { MetaChannelManifest } from '@/lib/meta-reality/types';

const actor = { kind: 'character' as const, npcId: '铃音', channelId: 'letters' };
const manifest: MetaChannelManifest = { id: 'm', title: '书信', tone: 'mysterious', forbiddenMoves: [], channels: [{ id: 'letters', kind: 'text', promptToPlayer: '', worldInterpretation: '', allowedConsumers: ['铃音'], consequenceTemplate: '', refusalFallback: '',
  workspaceGrants: [{ mountId: 'desk', pathPrefix: 'letters', npcIds: ['铃音'], operations: ['read', 'write'] }] }] };
async function setup() {
  const original = await storeResource({ name: 'letter.txt', text: '原始信件', mimeType: 'text/plain' });
  let liveFiles = { 'letters/letter.txt': original };
  const session = await createWorkspaceSession({ scope: { worldId: crypto.randomUUID(), playthroughId: 'meta' }, actionId: 'write', parentNodeId: 'old', inputs: [], manifest,
    metaMounts: [{ id: 'desk', files: structuredClone(liveFiles), currentFiles: () => liveFiles }] });
  return { session, original, replace: () => { liveFiles = { 'letters/letter.txt': { ...original, id: 'material_ffffffffffffffff' } }; } };
}
it('checks role, channel, mount and bounded paths; legacy manifests grant no file rights', () => {
  const args = { manifest, actor, mountId: 'desk', path: 'letters/letter.txt', operation: 'write' as const };
  expect(checkMetaWorkspaceAccess(args)).toEqual({ allowed: true });
  for (const patch of [{ actor: { ...actor, npcId: '陌生人' } }, { actor: { ...actor, channelId: 'other' } }, { mountId: 'other' }, { path: 'letters-other/letter.txt' }, { path: '../letters/letter.txt' }, { manifest: { ...manifest, channels: manifest.channels.map(c => ({ ...c, workspaceGrants: undefined })) } }]) expect(checkMetaWorkspaceAccess({ ...args, ...patch }).allowed).toBe(false);
  expect(() => normalizeMetaChannelManifest({ ...manifest, channels: [{ ...manifest.channels[0], workspaceGrants: [{ mountId: 'desk', pathPrefix: '../secret', npcIds: ['铃音'], operations: ['write'] }] }] })).toThrow();
});
it('stages an authorized role edit and publishes only selected, verified receipts through the original plugin workspace', async () => {
  const { session, original } = await setup();
  const changed = await runWorkspaceTool(session, { actor, method: 'files.patch', params: { path: 'meta/desk/letters/letter.txt', oldText: '原始', newText: '改写后的', expectedVersion: original.id } });
  expect(changed.status).toBe('staged'); expect(session.metaMounts[0].files['letters/letter.txt'].id).toBe(original.id);
  const prepared = await prepareActionArtifacts({ scope: session.scope, actionId: session.actionId, session, inputs: [], documents: [], effectIds: [changed.operationId!] });
  const old = { desk: { authorKey: 42, _eidosWorkspace: { files: { 'letters/letter.txt': original }, stages: [], events: [], interpretations: {} } } };
  const next = applyMetaWorkspaceEffects(old, prepared.metaEffects!);
  expect(workspaceOf(next.desk).files['letters/letter.txt'].id).toBe(changed.afterVersion);
  expect(workspaceOf(old.desk).files['letters/letter.txt'].id).toBe(original.id);
  expect(next.desk.authorKey).toBe(42); expect(prepared.validatedEffects[0]).toMatchObject({ actor, status: 'committed', beforeVersion: original.id });
  expect(applyMetaWorkspaceEffects(next, prepared.metaEffects!)).toEqual(next);
});
it('rejects whole effect batches on a stale version, fake ID, or unselected intermediate change', async () => {
  const { session, original, replace } = await setup();
  const a = await runWorkspaceTool(session, { actor, method: 'files.write', params: { path: 'meta/desk/letters/letter.txt', text: 'A', expectedVersion: original.id } });
  const b = await runWorkspaceTool(session, { actor, method: 'files.write', params: { path: 'meta/desk/letters/letter.txt', text: 'B', expectedVersion: a.afterVersion } });
  expect(() => prepareMetaWorkspaceEffects(session, [b.operationId!])).toThrow();
  expect(() => prepareMetaWorkspaceEffects(session, [a.operationId!, 'fake'])).toThrow();
  expect(prepareMetaWorkspaceEffects(session, [a.operationId!, b.operationId!]).receipts).toHaveLength(2);
  replace(); expect(() => prepareMetaWorkspaceEffects(session, [a.operationId!, b.operationId!])).toThrow('版本');
});
it('keeps assistant drafts separate from character effects and refuses cancelled edits', async () => {
  const { session, original } = await setup();
  expect((await runWorkspaceTool(session, { method: 'files.read', params: { path: 'meta/desk/letters/letter.txt' } })).status).toBe('denied');
  const ordinary = await runWorkspaceTool(session, { method: 'files.write', params: { path: 'drafts/write/letter.txt', text: '只是副本', expectedVersion: null } });
  expect(() => prepareMetaWorkspaceEffects(session, [ordinary.operationId!])).toThrow();
  session.closed = true;
  expect((await runWorkspaceTool(session, { actor, method: 'files.write', params: { path: 'meta/desk/letters/letter.txt', text: '迟到', expectedVersion: original.id } })).status).toBe('failed');
  expect(session.metaMounts[0].files['letters/letter.txt'].id).toBe(original.id);
});
