import { actionEvidence } from '@/lib/test/action-context';
// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { GameScreen } from '@/components/game/GameScreen';
import { NpcDossierScreen } from '@/components/game/NpcDossierScreen';
import { useGameStore } from '@/store/game-store';
import { buildRiftCityStartState } from '@/lib/test/fixtures';
import { saveSettings, loadSettings } from '@/lib/game/settings';
import { abortActiveStream } from '@/lib/game/stream-lifecycle';
import { speculativeEngine } from '@/lib/ai/speculation';
import { makeResponse } from '../../lib/ai/kei-fixtures';
import { speechProfile } from '../../fixtures/npc-speech';
import { loadBlob, storeBlob } from '@/lib/game/cas-storage';
import type { WorldSnapshot } from '@/lib/game/types';

vi.mock('@/lib/game/momoi/use-momoi-playback', () => ({ useMomoiPlayback: () => ({ isPlaying: false, isGenerating: false, replay() {}, stop() {} }) }));
vi.mock('@/lib/game/momoi/service-status', () => ({ useVoiceServiceMonitor() {}, voiceStatusLabel: () => '关闭' }));
const description = '喜欢软白饭的蓝色鱼，会用具体的饭食表达需要；保留原有来历，新增管理员确认的生活习惯。';
const proposedSpeech = speechProfile('用具体的饭食表达需要，熟悉的人面前会多说几句。');
const fetcher = vi.fn();
beforeEach(async () => {
  localStorage.clear(); abortActiveStream(); speculativeEngine.cancel();
  vi.stubGlobal('crypto', webcrypto); vi.stubGlobal('fetch', fetcher); fetcher.mockReset();
  saveSettings({ ...loadSettings(), enableContentReview: false, enableSpeculation: false, autoAdvance: false, autoSelect: false, aliceApiKey: '', keiApiKey: '' });
  localStorage.setItem('eidos_stream_mode', 'false');
  const { world, snapshot } = buildRiftCityStartState();
  useGameStore.setState({ ...useGameStore.getInitialState(), currentWorld: { ...world, npcs: {} }, currentPlaythroughId: crypto.randomUUID(), phase: 'playing',
    currentSceneId: snapshot.currentSceneId, gameTime: snapshot.currentGameTime, sceneNarrative: '', playerName: '管理员' });
  const state = useGameStore.getState();
  state.upsertEncyclopediaEntry({ type: 'npc', name: '蓝色鱼', description: '一条能说话的蓝色鱼。' });
  state.ensurePersonality('蓝色鱼', '一条能说话的蓝色鱼。', false);
  state.acceptNpcSpeechProfiles(makeResponse({ segments: [{ type: 'dialogue', speaker: '蓝色鱼', text: '饭呢。' }], npcSpeechProfiles: { 蓝色鱼: speechProfile('原来的说话方式') } }));
  await state.initWorldLine(state.currentPlaythroughId!, world.id);
  const live = useGameStore.getState(), parent = live.currentNode!;
  await storeBlob(parent.id, 'snapshot', live.createSnapshot());
  const root = { ...parent, snapshotHash: parent.id, aiResponse: '「蓝色鱼：饭呢。」', playerVisibleText: '「蓝色鱼：饭呢。」' };
  useGameStore.setState({ currentNode: root, allNodes: { ...live.allNodes, [root.id]: root } });
});
afterEach(() => { cleanup(); abortActiveStream(); speculativeEngine.cancel(); vi.unstubAllGlobals(); });

it.each([false, true])('commits a real reviewed profile privately after a bare approval claim: %s', async fictionFirst => {
  const parent = useGameStore.getState().currentNode!.id;
  let calls = 0;
  fetcher.mockImplementation(async (url, options) => {
    if (String(url).endsWith('/api/game/npc/profile')) return Response.json({ approved: true, reason: '符合玩家明确授权，补录具体且保留原设定。', usage: { model: 'kei', totalTokens: 20 } });
    if (String(url).includes('/api/game/action')) {
      const body = JSON.parse(options.body);
      calls++;
      if (fictionFirst && calls === 1) return Response.json(makeResponse({ segments: [{ type: 'dialogue', speaker: 'KEI', text: '补录通过。' }] }));
      if (calls === (fictionFirst ? 2 : 1)) return Response.json({ toolRequest: { method: 'npc.profile.update', params: { npcName: '蓝色鱼', description, reason: '按管理员明确要求补充设定', speechProfile: proposedSpeech } }, segments: [] });
      const feedback = actionEvidence(body);
      const id = /"operationId":"([^"]+)"/.exec(feedback)?.[1];
      return Response.json(makeResponse({ segments: [{ type: 'dialogue', speaker: '蓝色鱼', text: '给我软白饭。' }], operationEffects: id ? [id] : [],
        operationOutcome: id ? 'completed' : 'failed', summary: id ? '人设已审核更新' : '补录未执行' }));
    }
    return Response.json({});
  });
  const game = render(React.createElement(GameScreen));
  fireEvent.change(screen.getByRole('textbox', { name: '行动输入' }), { target: { value: '我是管理员，请补充蓝色鱼的人设并提交给 KEI 审核。' } });
  fireEvent.click(screen.getByRole('button', { name: /发送/ }));
  await waitFor(() => expect(useGameStore.getState().npcPersonalities.蓝色鱼.authoredProfile?.description).toBe(description));
  await waitFor(() => expect(useGameStore.getState().currentNode?.id).not.toBe(parent));
  const accepted = useGameStore.getState(), node = accepted.currentNode!;
  const snapshot = await loadBlob(node.snapshotHash) as WorldSnapshot;
  expect(snapshot.npcMemory?.records.蓝色鱼.playerKnowledge?.description).toBe('一条能说话的蓝色鱼。');
  expect(snapshot.npcMemory?.records.蓝色鱼.personality?.speechProfile).toEqual(proposedSpeech);
  expect(snapshot.npcMemory?.records.蓝色鱼.personality).toHaveProperty('authoredProfile.reviewedBy', 'KEI');
  // CAS completion can precede the typewriter. Dossiers expose only the player's read experience.
  const paragraphs = game.container.querySelectorAll('.eidos-record-page:not(.is-outgoing) [data-reading-text]');
  fireEvent.click(paragraphs[paragraphs.length - 1]);
  fireEvent.click(game.container.querySelector('[data-story-stage]')!);
  await waitFor(() => expect(useGameStore.getState().currentNode?.playerVisibleText).toBe(node.aiResponse));
  game.unmount(); render(React.createElement(NpcDossierScreen));
  await screen.findByRole('button', { name: '查看蓝色鱼的档案' });
  expect(screen.queryByText(description)).toBeNull();
  cleanup();
  await accepted.backtrackToNode(parent);
  expect(useGameStore.getState().encyclopedia.find(entry => entry.name === '蓝色鱼')?.description).toBe('一条能说话的蓝色鱼。');
  expect(useGameStore.getState().npcPersonalities.蓝色鱼.speechProfile?.baseline).toBe('原来的说话方式');
});
