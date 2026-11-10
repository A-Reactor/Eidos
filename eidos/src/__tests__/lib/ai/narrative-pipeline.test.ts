import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildRiftCityStartState } from '@/lib/test/fixtures';
import { usage } from './kei-fixtures';
import type { AIGameResponse, StorySegment } from '@/lib/ai/types';
vi.mock('@/lib/ai/client', async original => ({ ...await original<typeof import('@/lib/ai/client')>(), callAi: vi.fn(), callAiStream: vi.fn(), callDeepSeek: vi.fn() }));
import * as client from '@/lib/ai/client';
import { callAi, callAiStream } from '@/lib/ai/client';
import { processPlayerAction } from '@/lib/ai/action-handler';
import { processPlayerActionStream } from '@/lib/ai/action-stream';
import { buildWorldContextSections } from '@/lib/ai/context-builder';
import { buildEntryContext } from '@/lib/game/world-entry';
import { worldForModel } from '@/lib/game/plugins/model-manifest';
import { parsePluginFile } from '@/lib/game/plugins/manifest';
import { readFileSync } from 'node:fs';
const frame = { kind: 'cutaway' as const, actor: '白槿', location: '夜车', timeLabel: '与此同时' };
const response: AIGameResponse = { narrativeFrame: frame, narrativeBeat: { chapter: { id: 'letter', title: '未寄出的信' }, recap: '白槿藏信', boundary: 'chapter' }, validity: { isPossible: true, fantasyResponse: null, reason: null },
  segments: [{ type: 'narration', text: '白槿在空车厢里把信藏进座椅。主角此刻仍在站台。' }], summary: '白槿藏信',
  sceneChanges: ['night-train'], discoveredSecrets: ['sender'], npcsReacted: ['白槿'], availableActions: ['读信'],
  timeSpent: { day: 0, hour: 0, minute: 20 }, itemsGained: [], itemsUsed: [], cluesDiscovered: ['sender'],
  worldImpacts: ['车厢里留下一封信'], criticalFactsDiscovered: ['白槿藏信'] };
beforeEach(() => {
  vi.mocked(client.callDeepSeek).mockReset().mockResolvedValue({ content: JSON.stringify({ narrative: '我还不知道车厢里的事。', summary: '回忆已知信息' }), usage, elapsedMs: 1 });
  vi.mocked(callAi).mockReset().mockResolvedValue({ content: JSON.stringify(response), usage, elapsedMs: 1 });
  vi.mocked(callAiStream).mockReset().mockImplementation(async options => { options.onChunk(JSON.stringify(response)); options.onDone(JSON.stringify(response), usage); });
});
describe('narrative request in both ALICE paths', () => {
  it('keeps selected identity and native Meta protocol in actual complete and streaming prompts after transport', async () => {
    const { world, snapshot } = buildRiftCityStartState();
    const meta = parsePluginFile(JSON.parse(readFileSync('mods/dist/palimpsest-stage.eidos-plugin.json', 'utf8')))[0];
    const projected = worldForModel({ ...world, gameplayPlugins: [{ ...meta, ui: { ...meta.ui!, html: '<script>private-source-code</script>' } }] });
    const entryContext = buildEntryContext({ world, playerName: '茶客', startingSceneId: snapshot.currentSceneId, customIdentity: '广场卖茶的老人' });
    const options = { world: projected, snapshot: { ...snapshot, playerName: '茶客', entryContext }, playerInput: '看看门上的字迹' };
    await processPlayerAction(options);
    await processPlayerActionStream({ ...options, callbacks: { onDone: () => {} } });
    for (const prompt of [vi.mocked(callAi).mock.calls[0][0].systemPrompt, vi.mocked(callAiStream).mock.calls[0][0].systemPrompt]) {
      expect(prompt).toContain('广场卖茶的老人'); expect(prompt).toContain('本周目入场上下文');
      expect(prompt).toContain('原生文字演出协议'); expect(prompt).toContain('独立于受限回溯');
      expect(prompt).not.toContain('private-source-code');
    }
  });
  it('transports read-only history requests with usage, without requiring or inventing narrative segments', async () => {
    const { world, snapshot } = buildRiftCityStartState();
    const tool = { historyRequest: { query: '第三声钟响' } };
    vi.mocked(callAi).mockResolvedValue({ content: JSON.stringify(tool), usage, elapsedMs: 1 });
    vi.mocked(callAiStream).mockImplementation(async options => { options.onChunk(JSON.stringify(tool)); options.onDone(JSON.stringify(tool), usage); });
    const complete = await processPlayerAction({ world, snapshot, playerInput: '回到钟声之后' });
    const onDone = vi.fn(), onSegments = vi.fn(), onError = vi.fn();
    await processPlayerActionStream({ world, snapshot, playerInput: '回到钟声之后', callbacks: { onDone, onSegments, onError } });
    expect(complete).toMatchObject({ ...tool, segments: [], _tokenUsage: usage });
    expect(onDone.mock.calls[0][0]).toMatchObject({ ...tool, segments: [], _tokenUsage: usage });
    expect(onSegments).not.toHaveBeenCalled(); expect(onError).not.toHaveBeenCalled();
  });
  it('carries chapter recap in dynamic context with a reader knowledge boundary without changing the stable prefix', () => {
    const { world, snapshot } = buildRiftCityStartState();
    const original = buildWorldContextSections({ world, snapshot });
    const current = buildWorldContextSections({ world, snapshot: { ...snapshot, narrativeProgress: { chapter: { id: 'letter', title: '未寄出的信' }, recap: '读者看到白槿藏信。', threads: ['寄件人'] } } });
    expect(current.dynamicSuffix).toContain('读者看到白槿藏信');
    expect(current.dynamicSuffix).toContain('不是主角的亲历或已知信息');
    expect(current.stablePrefix).toBe(original.stablePrefix);
  });
  it('keeps reader-only history separate during protagonist introspection too', async () => {
    const { world, snapshot } = buildRiftCityStartState();
    await processPlayerAction({ world, snapshot, playerInput: '思考：我知道白槿做了什么吗？', introspection: true,
      recentHistory: [{ playerInput: '继续故事', summary: '[旁观剧情，主角未知] 白槿藏信' }] });
    const prompt = vi.mocked(client.callDeepSeek).mock.calls[0][0];
    expect(prompt).toContain('主角并未因此知道');
    expect(prompt).toContain('[旁观剧情，主角未知] 白槿藏信');
  });
  it('retains the reader camera when recovering a truncated JSON response', async () => {
    const { world, snapshot } = buildRiftCityStartState();
    const truncated = JSON.stringify(response).slice(0, -1);
    const parse = vi.spyOn(client, 'parseJSON').mockImplementationOnce(() => { throw new Error('fixture: truncated JSON'); }).mockImplementationOnce(() => { throw new Error('fixture: truncated JSON'); });
    vi.mocked(callAi).mockResolvedValue({ content: truncated, usage, elapsedMs: 1 });
    vi.mocked(callAiStream).mockImplementation(async options => { options.onChunk(truncated); options.onDone(truncated, usage); });
    const complete = await processPlayerAction({ world, snapshot, playerInput: '继续故事', narrativeRequest: { kind: 'continue' } });
    let streamed: AIGameResponse | undefined;
    await processPlayerActionStream({ world, snapshot, playerInput: '继续故事', narrativeRequest: { kind: 'continue' }, callbacks: { onDone: data => { streamed = data; } } });
    expect(complete.narrativeFrame).toEqual(frame); expect(streamed?.narrativeFrame).toEqual(frame);
    expect(complete.cluesDiscovered).toEqual([]); expect(streamed?.criticalFactsDiscovered).toEqual([]);
    expect(parse).toHaveBeenCalledTimes(2); parse.mockRestore();
  });
  it('preserves the same camera and knowledge boundary in streamed and complete responses', async () => {
    const { world, snapshot } = buildRiftCityStartState();
    const narrativeRequest = { kind: 'choice' as const, frame, choice: '藏起信件' };
    const options = { world, snapshot, playerInput: '剧情选择：白槿选择藏信', narrativeRequest };
    const complete = await processPlayerAction(options);
    let streamed: AIGameResponse | undefined; const chunks: StorySegment[][] = [];
    await processPlayerActionStream({ ...options, callbacks: { onSegments: segments => chunks.push(segments), onDone: data => { streamed = data; } } });
    expect(streamed?.cluesDiscovered).toEqual([]); expect(complete.cluesDiscovered).toEqual([]);
    expect(streamed?.timeAfter).toEqual(snapshot.currentGameTime);
    expect(streamed?.segments).toEqual(complete.segments);
    expect(streamed?.segments.at(-1)?.beat).toEqual(response.narrativeBeat);
    expect(chunks.every(segments => segments.every(segment => segment.view?.actor === '白槿'))).toBe(true);
    for (const prompt of [vi.mocked(callAi).mock.calls[0][0].systemPrompt, vi.mocked(callAiStream).mock.calls[0][0].systemPrompt]) {
      expect(prompt).toContain('不是主角说出这句指令'); expect(prompt).toContain('主角并未因此知道');
      expect(prompt).toContain('"actor":"白槿"');
    }
  });
});
