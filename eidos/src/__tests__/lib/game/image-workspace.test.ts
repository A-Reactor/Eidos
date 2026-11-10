// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { afterEach, expect, it, vi } from 'vitest';
import { useGameStore } from '@/store/game-store';
import { buildRiftCityStartState } from '@/lib/test/fixtures';
import { createActionWorkspace } from '@/lib/game/workspace/action-session';
import { runWorkspaceTool } from '@/lib/game/workspace/session';
import { createStreamRequestScope } from '@/lib/game/stream-lifecycle';
import { storeResource } from '@/lib/game/workspace/resources';
import { workspaceImageInputs } from '@/lib/game/workspace/image-inputs';
import { prepareActionArtifacts } from '@/lib/game/documents/action-artifacts';
import { mergeWorkspaceBranchAt } from '@/lib/game/workspace/branch';
import { selectImageResource, selectDialogueImageResource } from '@/lib/game/midori/image-selection';
import { buildDialogueReadoutModel } from '@/components/game/DialogueReadout';
import { loadWorldAssetRegistry } from '@/lib/game/midori/asset-library';
import { imageCatalogForState } from '@/lib/game/midori/image-context';
import { saveDocument } from '@/lib/game/documents/repository';
import { assertFileOutcome, continueActionTools } from '@/lib/game/action-tool-continuation';
import { parseWorkspaceRequest, validateWorkspaceContext } from '@/lib/ai/workspace-tools';
import { workspacePromptContext } from '@/lib/game/workspace/context';
import { currentDocumentScope } from '@/lib/game/model-documents';
import type { DocumentLink } from '@/lib/game/documents/types';
import type { ImageResource } from '@/lib/game/midori/image-resource';
import { processPlayerAction } from '@/lib/ai/action-handler';
import { processPlayerActionStream } from '@/lib/ai/action-stream';

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aJmUAAAAASUVORK5CYII=';
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); localStorage.clear(); });

async function setup(sandbox = true, documentOnly = false) {
  const { world } = buildRiftCityStartState();
  world.id = crypto.randomUUID();
  const character = Object.keys(world.npcs)[0];
  useGameStore.setState({ ...useGameStore.getInitialState(), currentWorld: world, currentPlaythroughId: crypto.randomUUID(), sandboxMode: sandbox, sandboxDossierId: '002' });
  await useGameStore.getState().initWorldLine(useGameStore.getState().currentPlaythroughId!, world.id);
  const originalResource = await storeResource({ name: '角色表情.png', mimeType: 'image/png', base64: png });
  const image: ImageResource = { id: 'image:test', worldId: world.id, type: 'illustration', targetId: '', slot: 'detail', label: '表情参考', description: '', tags: [],
    imageUrl: `/generated/${world.id}/uploads/expression.png`, source: 'uploaded', originalResource, createdAt: 1, updatedAt: 1 };
  if (!documentOnly) useGameStore.setState({ midoriAssetRegistry: { version: 1, bindings: {}, images: { [image.id]: image } } });
  const scope = currentDocumentScope(useGameStore.getState())!;
  const descriptor = await storeResource({ name: '图像.md', mimeType: 'text/markdown', text: '图像原件的文字说明' });
  const document = await saveDocument(scope, { title: '表情参考', origin: 'imported', resource: descriptor, originalResource, idempotencyKey: 'eidos-image:image:test' });
  const upload = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => Response.json({ imageUrl: `/generated/${world.id}/uploads/placed.png`, relativePath: 'uploads/placed.png' }));
  vi.stubGlobal('fetch', upload);
  const start = async (refs: DocumentLink[] = []) => {
    const state = useGameStore.getState();
    return (await createActionWorkspace(state, refs, createStreamRequestScope(state), () => true, crypto.randomUUID(), useGameStore.getState))!;
  };
  return { world, character, scope, image, document, start, upload };
}

type Fixture = Awaited<ReturnType<typeof setup>>;
type Session = Awaited<ReturnType<Fixture['start']>>;

async function edit(f: Fixture, session: Session) {
  const path = Object.keys(session.imageLibrary!.entries)[0];
  const read = await runWorkspaceTool(session, parseWorkspaceRequest({ method: 'files.read', params: { path } }));
  const spec = { ...JSON.parse(read.text!), type: 'character', targetId: f.character, slot: 'portrait', tags: ['开心'] };
  const receipt = await runWorkspaceTool(session, parseWorkspaceRequest({ method: 'files.write', params: { path, expectedVersion: read.version, text: JSON.stringify(spec) } }));
  return { path, read, spec, receipt };
}

async function accept(f: Fixture, session: Session, operationId: string) {
  const state = useGameStore.getState();
  const segments = [{ type: 'narration' as const, text: '她取出一张图片。' }, { type: 'narration' as const, text: '开心的表情已安排妥当。', workspaceEffects: [operationId] }];
  const prepared = await prepareActionArtifacts({ scope: f.scope, actionId: session.actionId, session, inputs: [], segments });
  const node = await state.addActionNode({ id: session.actionId, summary: '配置表情', worldImpacts: [], availableActions: [], sceneId: state.currentSceneId, sceneName: '', timestamp: Date.now(),
    playerInput: '将这张图作为开心表情', aiResponse: '', gameTime: state.gameTime, timeSpent: { day: 0, hour: 0, minute: 0 }, workspaceBranch: prepared.branch } as never, state.createSnapshot(), segments);
  return node;
}

it('reads image metadata and pixels, stages a real expression assignment, and applies it only at its paragraph', async () => {
  const f = await setup(), session = await f.start();
  const listing = await runWorkspaceTool(session, { method: 'files.list', params: { path: 'images' } });
  expect(listing.entries?.some(entry => entry.writable)).toBe(true);
  const { receipt, path } = await edit(f, session);
  expect(receipt.status).toBe('staged');
  expect((await workspaceImageInputs(session))?.[0]).toMatchObject({ path, mimeType: 'image/png', data: png });
  expect(validateWorkspaceContext(workspacePromptContext(session))?.results.at(-1)?.afterVersion).toBe(receipt.afterVersion);
  expect(() => assertFileOutcome(session, {})).toThrow('终局未选择');
  expect(useGameStore.getState().midoriAssetRegistry.images![f.image.id].type).toBe('illustration');
  const node = await accept(f, session, receipt.operationId!);
  expect(f.upload).not.toHaveBeenCalled();
  await mergeWorkspaceBranchAt(useGameStore, node.id, 0);
  expect(useGameStore.getState().midoriAssetRegistry.images![f.image.id].type).toBe('illustration');
  await mergeWorkspaceBranchAt(useGameStore, node.id, 1);
  const live = useGameStore.getState();
  const selected = selectImageResource(live.midoriAssetRegistry, { worldId: f.world.id, targetType: 'character', targetId: f.character, slot: 'portrait', emotion: 'happy' });
  expect(selected).toMatchObject({ id: f.image.id, targetId: f.character, tags: ['开心'], imageUrl: `/generated/${f.world.id}/uploads/placed.png`, originalResource: f.image.originalResource });
  const form = f.upload.mock.calls[0][1]!.body as FormData;
  expect(form.get('targetType')).toBe('character'); expect(form.get('targetId')).toBe(f.character);
  expect(loadWorldAssetRegistry(f.world, null, live).images![f.image.id].tags).toEqual(['开心']);
  expect(imageCatalogForState(live).find(image => image.id === f.image.id)?.targetId).toBe(f.character);
  await mergeWorkspaceBranchAt(useGameStore, node.id, 1);
  expect(Object.keys(useGameStore.getState().midoriAssetRegistry.images!)).toHaveLength(1);
  const exported = await live.exportWorldLine(node.id);
  expect(exported.modResources?.[f.image.originalResource!.id]?.base64 ?? exported.documents?.resources[f.image.originalResource!.id]?.base64).toBe(png);
});

it.each([[false, false], [true, false], [false, true], [true, true]])('binds an uploaded document through native file calls and selects its custom expression after playback, streaming=%s, formatRepair=%s', async (streaming, formatRepair) => {
  const f = await setup(true, true), session = await f.start([f.document]);
  const path = Object.keys(session.imageLibrary!.entries)[0];
  const initial = useGameStore.getState(), snapshot = initial.createSnapshot();
  const playerInput = `将上传的图片挂成${f.character}的表情，标签惊讶、猫猫脸`;
  let modelCalls = 0;
  const model = vi.fn(async (url: RequestInfo | URL, options?: RequestInit) => {
    if (!String(url).endsWith('/chat/completions')) return f.upload(url, options);
    modelCalls++;
    const body = JSON.parse(String(options?.body));
    expect(body.tools.map((entry: { function: { name: string } }) => entry.function.name)).toContain('workspaceRequest');
    let command: unknown;
    if (modelCalls === 1) command = { method: 'files.read', params: { path } };
    if (modelCalls === 2) {
      const read = session.receipts.at(-1)!;
      expect(read).toMatchObject({ method: 'files.read', status: 'committed', path });
      expect(JSON.stringify(body.messages)).toContain('data:image/png;base64,');
      command = { method: 'files.write', params: { path, expectedVersion: read.version, text: JSON.stringify({ ...JSON.parse(read.text!), type: 'character', targetId: f.character, slot: 'portrait', tags: ['惊讶', '猫猫脸'] }) } };
    }
    const receipt = session.receipts.at(-1);
    if (modelCalls === 4) {
      expect(body.messages[0].content).toContain('行动响应格式无效');
      expect(body.messages[0].content).toContain(receipt!.operationId);
    }
    const content = command ? null : formatRepair && modelCalls === 3 ? '内部回复格式错误，不能成为玩家文件。' : JSON.stringify({ segments: [{ type: 'narration', text: '她收好图片。' },
      { type: 'dialogue', speaker: f.character, expressionTags: ['猫猫脸'], text: '这张脸就是我啦。', workspaceEffects: [receipt!.operationId] }],
    timeSpent: { day: 0, hour: 0, minute: 0 }, summary: '设置猫猫脸表情' });
    const calls = command ? [{ id: `file-${modelCalls}`, type: 'function', function: { name: modelCalls === 1 ? 'workspaceRequest' : 'toolRequest', arguments: JSON.stringify(command) } }] : [];
    const usage = { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 };
    if (!body.stream) return Response.json({ choices: [{ message: { content, ...(calls.length ? { tool_calls: calls } : {}) }, finish_reason: calls.length ? 'tool_calls' : 'stop' }], usage });
    return new Response(`data: ${JSON.stringify({ choices: [{ delta: calls.length ? { tool_calls: calls.map((call, index) => ({ ...call, index })) } : { content }, finish_reason: calls.length ? 'tool_calls' : 'stop' }] })}\n\ndata: ${JSON.stringify({ choices: [], usage })}\n\ndata: [DONE]\n\n`, { headers: { 'Content-Type': 'text/event-stream' } });
  });
  vi.stubGlobal('fetch', model);
  const invoke = async (context: import('@/lib/game/action-tool-continuation').ActionToolContext) => {
    const options = { playerInput, snapshot, world: f.world, sandboxMode: true, workspaceContext: context.workspaceContext,
      imageInputs: await workspaceImageInputs(session), longMemoryContext: context.longMemoryContext,
      clientSettings: { aliceProviderId: 'deepseek', aliceModel: 'deepseek-flash', aliceApiKey: 'offline-only', aliceEndpoint: 'https://api.deepseek.com/v1' } };
    if (!streaming) return processPlayerAction(options);
    let result: import('@/lib/ai/types').AIGameResponse | undefined;
    await processPlayerActionStream({ ...options, callbacks: { onDone: response => { result = response; }, onError: error => { throw error; } } });
    expect(result).toBeDefined(); return result!;
  };
  const context = { longMemoryContext: '', workspaceContext: workspacePromptContext(session) };
  const final = await continueActionTools({ response: await invoke(context), playerInput, session, historySource: initial, engine: initial,
    context, isCurrent: () => true, onResponse() {}, invoke });
  expect(modelCalls).toBe(formatRepair ? 4 : 3);
  expect(session.receipts.map(receipt => receipt.status)).toEqual(['committed', 'staged']);
  expect(final.document).toBeUndefined();
  expect(useGameStore.getState().midoriAssetRegistry.images?.[f.image.id]).toBeUndefined();
  const prepared = await prepareActionArtifacts({ scope: f.scope, actionId: session.actionId, session, inputs: [], segments: final.segments });
  const state = useGameStore.getState();
  const node = await state.addActionNode({ id: session.actionId, summary: '猫猫脸表情', worldImpacts: [], availableActions: [], sceneId: state.currentSceneId, sceneName: '', timestamp: Date.now(),
    playerInput, aiResponse: '', gameTime: state.gameTime, timeSpent: { day: 0, hour: 0, minute: 0 }, workspaceBranch: prepared.branch } as never, snapshot, final.segments!);
  await mergeWorkspaceBranchAt(useGameStore, node.id, 0);
  expect(f.upload).not.toHaveBeenCalled();
  await mergeWorkspaceBranchAt(useGameStore, node.id, 1);
  const selected = selectDialogueImageResource(useGameStore.getState().midoriAssetRegistry, { worldId: f.world.id, targetId: f.character, expressionTags: ['猫猫脸'] });
  expect(selected).toMatchObject({ id: f.image.id, type: 'character', targetId: f.character, tags: ['惊讶', '猫猫脸'], originalResource: f.image.originalResource });
  expect(f.upload).toHaveBeenCalledOnce();
});

it('enforces normal-game write grants and an explicit read-only choice in sandbox 002', async () => {
  const f = await setup(false);
  const readonly = await f.start();
  expect((await edit(f, readonly)).receipt.status).toBe('denied');
  const granted = await f.start([{ ...f.document, allowWrite: true }]);
  const catalog = validateWorkspaceContext(workspacePromptContext(granted))!.mounts;
  expect(catalog.find(entry => entry.path.startsWith('inputs/'))?.imagePath).toBe(Object.keys(granted.imageLibrary!.entries)[0]);
  expect(catalog.find(entry => entry.path.startsWith('images/') && entry.path !== 'images/targets.json')?.selected).toBe(true);
  expect((await edit(f, granted)).receipt.status).toBe('staged');
  useGameStore.setState({ sandboxMode: true, sandboxDossierId: '002' });
  // The selected document must belong to the sandbox archive too.
  const sandboxScope = currentDocumentScope(useGameStore.getState())!;
  const resource = await storeResource({ name: '图像.md', mimeType: 'text/markdown', text: '沙箱图像' });
  const doc = await saveDocument(sandboxScope, { title: '参考图', origin: 'imported', resource, originalResource: f.image.originalResource, idempotencyKey: 'eidos-image:image:test' });
  const denied = await f.start([{ ...doc, allowWrite: false }]);
  expect((await edit(f, denied)).receipt.status).toBe('denied');
});

it('returns invalid targets, injected URLs and stale versions as actionable failures without moving the version', async () => {
  const f = await setup(), session = await f.start();
  const { path, read, spec } = await edit(f, session);
  const version = session.files[path].id;
  for (const invalid of [{ ...spec, targetId: '不存在的角色' }, { ...spec, imageUrl: 'file:///etc/passwd' }]) {
    const result = await runWorkspaceTool(session, { method: 'files.write', params: { path, text: JSON.stringify(invalid), expectedVersion: version } });
    expect(result.status).toBe('failed'); expect(result.error).toBeTruthy();
    expect(session.files[path].id).toBe(version);
  }
  const stale = await runWorkspaceTool(session, { method: 'files.write', params: { path, text: JSON.stringify(spec), expectedVersion: read.version } });
  expect(stale.error).toContain('版本'); expect(session.files[path].id).toBe(version);
  const repaired = await runWorkspaceTool(session, { method: 'files.write', params: { path, text: JSON.stringify({ ...spec, tags: ['思考'] }), expectedVersion: version } });
  expect(repaired.status).toBe('staged');
  expect(() => assertFileOutcome(session, { segments: [{ type: 'narration', text: '配置完成。', workspaceEffects: [repaired.operationId!] }] })).not.toThrow();
});

it('publishes an imported image original without a prior gallery entry, with no upload during prediction', async () => {
  const f = await setup(true, true), session = await f.start();
  const upload = vi.fn(async () => Response.json({ imageUrl: `/generated/${f.world.id}/uploads/placed.png`, relativePath: 'uploads/placed.png' }));
  vi.stubGlobal('fetch', upload);
  const { receipt } = await edit(f, session);
  expect(receipt.status).toBe('staged');
  const node = await accept(f, session, receipt.operationId!);
  expect(upload).not.toHaveBeenCalled();
  await mergeWorkspaceBranchAt(useGameStore, node.id, 1);
  expect(upload).toHaveBeenCalledOnce();
  expect(useGameStore.getState().midoriAssetRegistry.images!['image:test']).toMatchObject({ targetId: f.character, tags: ['开心'], originalResource: f.image.originalResource });
});

it('preserves a player gallery edit made after prediction and reports the merge conflict', async () => {
  const f = await setup(), session = await f.start();
  const { receipt } = await edit(f, session), node = await accept(f, session, receipt.operationId!);
  await useGameStore.getState().saveImageResource({ ...f.image, label: '玩家刚改的名称', updatedAt: Date.now() });
  await expect(mergeWorkspaceBranchAt(useGameStore, node.id, 1)).rejects.toThrow('已变化');
  const live = useGameStore.getState();
  expect(live.currentNode?.id).toBe(node.id);
  expect(live.currentNode?.workspaceBranch?.mergeFailure?.message).toContain('已变化');
  expect(live.midoriAssetRegistry.images![f.image.id].label).toBe('玩家刚改的名称');
  const retry = await f.start();
  const feedback = validateWorkspaceContext(workspacePromptContext(retry))?.committedEffects;
  expect(feedback).toContainEqual(expect.objectContaining({ status: 'failed', error: expect.stringContaining('已变化') }));
});

it('feeds a placement failure back to the same model continuation and accepts its corrected assignment', async () => {
  const f = await setup(), session = await f.start();
  const path = Object.keys(session.imageLibrary!.entries)[0];
  const read = await runWorkspaceTool(session, { method: 'files.read', params: { path } });
  const spec = { ...JSON.parse(read.text!), type: 'character', targetId: f.character, slot: 'portrait', tags: ['开心'] };
  let calls = 0;
  const final = await continueActionTools({ session, historySource: { allNodes: {}, currentNode: null },
    response: { toolRequest: { method: 'files.write', params: { path, expectedVersion: read.version, text: JSON.stringify({ ...spec, targetId: '虚构目标' }) } } },
    context: { longMemoryContext: '', workspaceContext: workspacePromptContext(session) }, isCurrent: () => true, onResponse() {},
    invoke: async context => {
      if (++calls === 1) {
        expect(context.workspaceContext.results.at(-1)?.error).toContain('角色');
        return { toolRequest: { method: 'files.write', params: { path, expectedVersion: read.version, text: JSON.stringify(spec) } } };
      }
      return { segments: [{ type: 'narration', text: '配置好开心的表情。', workspaceEffects: [session.receipts.at(-1)!.operationId!] }] };
    }, validateFinal: response => { assertFileOutcome(session, response); } });
  expect(calls).toBe(2);
  expect(session.receipts.map(receipt => receipt.status)).toEqual(['committed', 'failed', 'staged']);
  expect(final.operationOutcome).toBeUndefined();
  const prepared = await prepareActionArtifacts({ scope: f.scope, actionId: session.actionId, session, inputs: [], segments: final.segments });
  expect(prepared.branch?.images?.[0].image.tags).toEqual(['开心']);
});

it('merges sequential image edits at separate paragraphs, including an original restored from a document', async () => {
  const f = await setup(true, true), session = await f.start();
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ imageUrl: `/generated/${f.world.id}/uploads/placed.png` })));
  const { path, spec, receipt } = await edit(f, session);
  const first = await runWorkspaceTool(session, { method: 'files.write', params: { path, expectedVersion: receipt.afterVersion, text: JSON.stringify({ ...spec, makeDefault: true }) } });
  const second = await runWorkspaceTool(session, { method: 'files.write', params: { path, expectedVersion: first.afterVersion, text: JSON.stringify({ ...spec, tags: ['思考'], makeDefault: true }) } });
  const state = useGameStore.getState();
  const segments = [{ type: 'narration' as const, text: '配置开心表情。', workspaceEffects: [first.operationId!] }, { type: 'narration' as const, text: '换成思考表情。', workspaceEffects: [second.operationId!] }];
  const prepared = await prepareActionArtifacts({ scope: f.scope, actionId: session.actionId, session, inputs: [], segments });
  const node = await state.addActionNode({ id: session.actionId, summary: '两次表情', worldImpacts: [], availableActions: [], sceneId: state.currentSceneId, sceneName: '', timestamp: Date.now(), playerInput: '', aiResponse: '', gameTime: state.gameTime, timeSpent: { day: 0, hour: 0, minute: 0 }, workspaceBranch: prepared.branch } as never, state.createSnapshot(), segments);
  await mergeWorkspaceBranchAt(useGameStore, node.id, 0);
  expect(useGameStore.getState().midoriAssetRegistry.images![f.image.id].tags).toEqual(['开心']);
  await mergeWorkspaceBranchAt(useGameStore, node.id, 1);
  expect(useGameStore.getState().midoriAssetRegistry.images![f.image.id].tags).toEqual(['思考']);
});

it('rejects assigning an illustration plan without original pixels while allowing its description to be edited', async () => {
  const f = await setup();
  useGameStore.setState({ midoriAssetRegistry: { version: 1, bindings: {}, images: { plan: { ...f.image, id: 'plan', imageUrl: undefined, originalResource: undefined } } } });
  const session = await f.start();
  const path = Object.keys(session.imageLibrary!.entries).find(path => session.imageLibrary!.entries[path].image.id === 'plan')!;
  const read = await runWorkspaceTool(session, { method: 'files.read', params: { path } });
  const spec = JSON.parse(read.text!);
  const failed = await runWorkspaceTool(session, { method: 'files.write', params: { path, expectedVersion: read.version, text: JSON.stringify({ ...spec, type: 'character', slot: 'portrait', targetId: f.character }) } });
  expect(failed.error).toContain('没有图片原件');
  expect(session.files[path].id).toBe(read.version);
  const changed = await runWorkspaceTool(session, { method: 'files.write', params: { path, expectedVersion: read.version, text: JSON.stringify({ ...spec, description: '黄昏街头的构图。' }) } });
  expect(changed.status).toBe('staged');
  const node = await accept(f, session, changed.operationId!);
  await mergeWorkspaceBranchAt(useGameStore, node.id, 1);
  expect(useGameStore.getState().midoriAssetRegistry.images!.plan.description).toBe('黄昏街头的构图。');
});

it('folds the unselected image collection, keeps default pagination consistent, and reveals searchable configuration on demand', async () => {
  const f = await setup();
  const { saveLocalDocument } = await import('@/lib/game/documents/ingest');
  for (let i = 0; i < 10; i++) await saveLocalDocument(f.scope, { title: `正文${i}`, content: `保留的文档正文${i}` });
  const session = await f.start();
  const context = validateWorkspaceContext(workspacePromptContext(session))!;
  expect(context.imageLibrary).toEqual({ count: 1 });
  expect(context.mounts).toHaveLength(8);
  expect(context.mounts.some(entry => entry.path.startsWith('images/') || entry.name === '表情参考')).toBe(false);
  const first = await runWorkspaceTool(session, { method: 'files.list', params: {} });
  expect(first.entries).toEqual(context.mounts);
  expect(first.nextOffset).toBe(context.nextOffset);
  const second = await runWorkspaceTool(session, { method: 'files.list', params: { offset: context.nextOffset } });
  expect(second.entries).toHaveLength(2);
  expect(second.nextOffset).toBeNull();
  const found = await runWorkspaceTool(session, { method: 'files.search', params: { path: 'images', query: '表情参考' } });
  expect(found.matches).toHaveLength(1);
  expect(found.matches![0]).toMatchObject({ writable: true, name: '表情参考 · 图像配置' });
  const read = await runWorkspaceTool(session, { method: 'files.read', params: { path: found.matches![0].path, version: found.matches![0].version } });
  expect(JSON.parse(read.text!).imageId).toBe(f.image.id);
  expect(validateWorkspaceContext(workspacePromptContext(session))!.results.at(-2)?.matches![0]).toEqual(found.matches![0]);
  expect(await workspaceImageInputs(session)).toHaveLength(1);
});

it('displays an existing expression through the standard read-only file channel without copying an image ID or writing a binding', async () => {
  const f = await setup(false);
  const state = useGameStore.getState(), image = { ...f.image, type: 'character' as const, targetId: f.character, slot: 'portrait' as const, tags: ['开心', '礼服'] };
  useGameStore.setState({ midoriAssetRegistry: { ...state.midoriAssetRegistry, images: { [image.id]: image } } });
  const session = await f.start();
  const found = await runWorkspaceTool(session, { method: 'files.search', params: { path: 'images', query: '开心 礼服' } });
  const match = found.matches![0];
  expect(match.writable).toBe(false);
  const read = await runWorkspaceTool(session, { method: 'files.read', params: { path: match.path, version: match.version } });
  expect(read.status).toBe('committed');
  const segment = { type: 'dialogue' as const, speaker: f.character, imagePath: match.path, text: '很高兴见到你。' };
  const registry = useGameStore.getState().midoriAssetRegistry;
  expect(selectDialogueImageResource(registry, { worldId: f.world.id, targetId: f.character, imagePath: match.path })?.id).toBe(image.id);
  expect(buildDialogueReadoutModel({ currentSegment: segment, displayedText: segment.text, sceneName: '', hasSceneImage: false, worldId: f.world.id, assetRegistry: registry })?.imageUrl).toBe(image.imageUrl);
  expect(session.receipts.every(receipt => ['files.search', 'files.read'].includes(receipt.method))).toBe(true);
  expect(registry).toBe(useGameStore.getState().midoriAssetRegistry);
  expect(f.upload).not.toHaveBeenCalled();
});
