import { useGameStore } from '@/store/game-store';
import type { MapTravelRequest } from '@/store/slices/phase-slice';
import { getSceneById } from './scene-utils';
import { mapRoutes } from './map-state';
import { validateTravelSegments, type TravelSegment } from './map-journey';
import { loadSettings } from './settings';
import type { StorySegment } from '@/lib/ai/types';

interface JourneyCallbacks {
  ready: (segments: StorySegment[]) => void;
  present: (index: number) => void;
  loading: (busy: boolean) => void;
  stopped: () => void;
  error: (message: string) => void;
}

/** One generation, incremental commits. Unpresented text stays in this disposable controller. */
export class MapJourneyController {
  index = -1;
  private steps: TravelSegment[] = [];
  private stopped = false;
  private stopNotified = false;
  private abort = new AbortController();
  private pending: Promise<void> | null = null;
  private expectedScene: string;
  private expectedNode = useGameStore.getState().currentNode?.id;
  private playthrough = useGameStore.getState().currentPlaythroughId;
  private unsubscribe: (() => void) | null = null;
  constructor(private request: MapTravelRequest, private callbacks: JourneyCallbacks) { this.expectedScene = request.from; }
  private valid() {
    const state = useGameStore.getState();
    return state.phase === 'playing' && state.currentWorld?.id === this.request.worldId && state.currentPlaythroughId === this.playthrough && state.currentSceneId === this.expectedScene;
  }
  async start() {
    this.callbacks.loading(true);
    const initial = useGameStore.getState();
    this.unsubscribe = useGameStore.subscribe(state => {
      if (!this.pending && (!this.valid() || state.currentNode?.id !== this.expectedNode)) void this.stop();
    });
    const timer = setTimeout(() => this.abort.abort(), 100000);
    try {
      const response = await fetch('/api/game/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: this.abort.signal, body: JSON.stringify({ playerInput: '沿地图路线旅行并观察沿途', snapshot: initial.createSnapshot(), world: initial.currentWorld, travelPath: this.request.path, _settings: loadSettings() }) });
      const data = await response.json();
      if (this.stopped || !this.valid()) return;
      if (!response.ok || data.error) throw new Error(data.error ?? '旅行准备失败');
      this.steps = validateTravelSegments(data.travelSegments, this.request.path);
      if (data._tokenUsage) {
        initial.addTokenUsage(data._tokenUsage, this.request.worldId);
        initial.setAliceContextUsage(data._tokenUsage, this.request.worldId);
      }
      this.callbacks.ready(this.steps.map(step => ({ type: 'narration', text: step.text })));
      await this.advance();
    } catch (cause) {
      if (!this.stopped) {
        this.callbacks.error(this.abort.signal.aborted ? '旅行准备超时，尚未出发。' : cause instanceof Error ? cause.message : '旅行准备失败');
        await this.stop();
      }
    } finally { clearTimeout(timer); }
  }
  async advance() {
    if (this.stopped || this.pending || !this.valid()) return;
    const step = this.steps[this.index + 1];
    if (!step) return;
    // Defer to a microtask so store notifications see the commit lock before any writes.
    this.pending = Promise.resolve().then(() => this.commit(step));
    await this.pending;
    this.pending = null;
    if (!this.valid()) this.stopped = true;
    if (this.stopped) this.finishStop();
    else this.callbacks.loading(false);
  }
  private async commit(step: TravelSegment) {
    if (this.stopped || !this.valid()) return;
    const state = useGameStore.getState();
    if (state.currentSceneId !== step.from || !mapRoutes(state.currentWorld!).some(route => route.from === step.from && route.to === step.to && route.status === 'open')) {
      this.callbacks.error('通路已经变化，旅行停在当前位置。'); this.stopped = true; return;
    }
    this.callbacks.loading(true);
    const before = state.createSnapshot();
    try {
      if (step.arrived) {
        state.navigateToScene(step.to);
        if (useGameStore.getState().currentSceneId !== step.to) throw new Error('未能到达下一地点，旅行已停止。');
        this.expectedScene = step.to;
      }
      const timeSpent = { day: 0, hour: 0, minute: step.minutes };
      state.advanceTime(timeSpent);
      state.setSceneNarrative(step.text);
      const live = useGameStore.getState();
      const shown: StorySegment[] = [{ type: 'narration', text: step.text }];
      const input = `旅行：${getSceneById(live.currentWorld, step.from)?.name} → ${getSceneById(live.currentWorld, step.to)?.name}`;
      const record = { id: crypto.randomUUID(), timestamp: Date.now(), gameTime: { ...live.gameTime }, sceneId: live.currentSceneId, sceneName: live.currentScene?.name ?? '', playerInput: input, aiResponse: step.text, summary: input, timeSpent, worldImpacts: [], availableActions: ['观察周围环境'], snapshot: before };
      live.addToHistory(record);
      live.setAvailableActions(['观察周围环境']);
      live.saveSegmentState(shown, 0, true);
      this.index++;
      this.callbacks.present(this.index);
      const node = await live.addActionNode(record, live.createSnapshot(), shown, { reuseExisting: false });
      if (!this.valid() || useGameStore.getState().currentNode?.id !== node.id) { this.stopped = true; return; }
      this.expectedNode = node.id;
      // Reading visibility is advanced by GameScreen as the text is displayed.
      useGameStore.getState().requestAutoSave();
    } catch (cause) {
      if (this.valid()) this.callbacks.error(cause instanceof Error ? cause.message : '旅行记录保存失败，已停止继续。');
      this.stopped = true;
    }
  }
  async stop() {
    this.stopped = true; this.abort.abort(); this.unsubscribe?.(); this.unsubscribe = null;
    if (this.pending) await this.pending;
    this.finishStop();
  }
  private finishStop() {
    this.unsubscribe?.(); this.unsubscribe = null;
    if (this.stopNotified) return;
    this.stopNotified = true;
    this.callbacks.loading(false);
    this.callbacks.stopped();
  }
}
