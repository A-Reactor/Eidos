import { voiceIdentity, type VoiceAsset, type VoiceRequest } from "./model";
import { VoiceGenerationQueue, voiceCancelled, type VoiceQueueItem, type VoiceQueueOptions } from "./generation-queue";
export interface AudioData { audioBase64: string; mimeType: string; spokenText?: string; speechLanguage?: string }
type Synthesize = (request: VoiceRequest, signal: AbortSignal) => Promise<AudioData>;

/** One library per archive scope. Playback cancellation does not cancel shared synthesis. */
export class VoiceLibrary {
  assets: Record<string, VoiceAsset>;
  private queue: VoiceGenerationQueue<VoiceAsset>;
  private revisions = new Map<string, number>();
  private revision = 0;
  private controllers = new Set<AbortController>();
  private writing: Promise<unknown> = Promise.resolve();
  private registering: Promise<unknown> = Promise.resolve();
  private disposed = false;
  private foregroundSuccess = new Set<() => void>();
  constructor(assets: Record<string, VoiceAsset>, private persist: (assets: Record<string, VoiceAsset>) => Promise<void | Record<string, VoiceAsset>>, private synthesize: Synthesize, changed?: (items: VoiceQueueItem[]) => void) {
    this.assets = assets;
    this.queue = new VoiceGenerationQueue(changed);
  }
  get queueItems() { return this.queue.items; }
  subscribeForegroundSuccess(listener: () => void) {
    this.foregroundSuccess.add(listener);
    return () => { this.foregroundSuccess.delete(listener); };
  }
  cancelWaiting(id?: string) { this.queue.cancelWaiting(id); }
  evict(ids: string[]) {
    const next = { ...this.assets };
    for (const id of ids) delete next[id];
    this.assets = next;
  }
  async ensure(request: VoiceRequest, force = false, options: VoiceQueueOptions = {}): Promise<VoiceAsset> {
    const submitted = this.revision;
    // Digest promises may finish out of order; register in submission order for FIFO peers.
    const identity = this.registering.catch(() => {}).then(() => voiceIdentity(request));
    this.registering = identity;
    const id = await identity;
    if (this.disposed || options.signal?.aborted) throw voiceCancelled();
    if (!force && this.assets[id]) return this.assets[id];
    if (!force && (this.revisions.get(id) ?? 0) > submitted) throw voiceCancelled();
    if (force) { this.revisions.set(id, ++this.revision); this.queue.invalidate(id); }
    // Capture the revision before queuing; deletion/upload must invalidate waiting work too.
    const revision = this.revisions.get(id) ?? 0;
    this.revisions.set(id, revision);
    const asset = await this.queue.enqueue({ id, text: request.text, speaker: request.speaker }, async () => {
      this.check(id, revision);
      const controller = new AbortController();
      this.controllers.add(controller);
      try {
        const data = await this.synthesize(request, controller.signal);
        this.check(id, revision);
        const asset = this.asset(id, request, data, request.config.provider);
        await this.commit(id, asset, revision);
        return asset;
      } finally { this.controllers.delete(controller); }
    }, options);
    // A cache hit cannot establish that an offline backend has recovered.
    if (options.priority === 'current' || options.priority === 'manual') for (const listener of this.foregroundSuccess) {
      try { listener(); } catch (error) { console.warn('[MOMOI] 恢复语音预生成失败', error); }
    }
    return asset;
  }
  async remove(id: string) {
    const revision = ++this.revision;
    this.revisions.set(id, revision);
    this.queue.invalidate(id);
    await this.commit(id, null, revision);
  }
  async replace(request: VoiceRequest, data: AudioData) {
    const id = await voiceIdentity(request);
    const revision = ++this.revision;
    this.revisions.set(id, revision);
    this.queue.invalidate(id);
    await this.commit(id, this.asset(id, request, data, "uploaded"), revision);
  }
  dispose() {
    this.disposed = true;
    this.queue.dispose();
    this.controllers.forEach(controller => controller.abort());
    this.foregroundSuccess.clear();
  }
  private check(id: string, revision: number) {
    if (this.disposed || this.revisions.get(id) !== revision) throw voiceCancelled();
  }
  private asset(id: string, request: VoiceRequest, data: AudioData, provider: VoiceAsset["provider"]): VoiceAsset {
    if (!data.audioBase64 || !data.mimeType.startsWith("audio/")) throw new Error("服务未返回有效音频");
    return { id, text: request.text, speaker: request.speaker, emotion: request.emotion, ...data, ...(['japanese', 'translated'].includes(request.config.material ?? '') ? { material: request.config.material as 'japanese' | 'translated' } : {}), provider, model: request.voice.modelName || request.config.model, createdAt: Date.now() };
  }
  private async commit(id: string, asset: VoiceAsset | null, revision: number) {
    const operation = this.writing.catch(() => {}).then(async () => {
      this.check(id, revision);
      const next = { ...this.assets };
      if (asset) next[id] = asset; else delete next[id];
      const retained = await this.persist(next);
      this.assets = retained ?? next;
    });
    this.writing = operation;
    await operation;
  }
}
