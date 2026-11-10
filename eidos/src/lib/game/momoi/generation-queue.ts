export type VoicePriority = "manual" | "current" | "next" | "prefetch" | "batch" | "speculative";
export const VOICE_PRIORITY: Record<VoicePriority, number> = { manual: 0, current: 1, next: 2, prefetch: 3, batch: 4, speculative: 5 };
export interface VoiceQueueItem { id: string; text: string; speaker: string; priority: VoicePriority; status: "running" | "waiting" }
export interface VoiceQueueOptions { priority?: VoicePriority; signal?: AbortSignal }
export const voiceCancelled = () => new DOMException("语音任务已取消", "AbortError");
interface Waiter<T> { priority: VoicePriority; resolve: (value: T) => void; reject: (reason: unknown) => void; cleanup: () => void }
interface Job<T> { item: VoiceQueueItem; run: () => Promise<T>; waiters: Set<Waiter<T>>; order: number }

/** Only waiting work is reordered. Shared work survives cancellation by one consumer. */
export class VoiceGenerationQueue<T> {
  private jobs = new Map<string, Job<T>>();
  private active: Job<T> | null = null;
  private sequence = 0;
  private disposed = false;
  constructor(private changed: (items: VoiceQueueItem[]) => void = () => {}) {}
  get items(): VoiceQueueItem[] {
    const waiting = [...this.jobs.values()].filter(j => j !== this.active).sort((a, b) => this.compare(a, b));
    return [...(this.active ? [this.active] : []), ...waiting].map(job => ({ ...job.item }));
  }
  enqueue(item: Omit<VoiceQueueItem, "status" | "priority">, run: () => Promise<T>, options: VoiceQueueOptions = {}): Promise<T> {
    if (this.disposed || options.signal?.aborted) return Promise.reject(voiceCancelled());
    let job = this.jobs.get(item.id);
    if (!job) {
      job = { item: { ...item, priority: options.priority ?? "prefetch", status: "waiting" }, run, waiters: new Set(), order: this.sequence++ };
      this.jobs.set(item.id, job);
    }
    const target = job;
    const result = new Promise<T>((resolve, reject) => {
      const waiter: Waiter<T> = { resolve, reject, priority: options.priority ?? "prefetch", cleanup: () => options.signal?.removeEventListener("abort", cancel) };
      const cancel = () => {
        target.waiters.delete(waiter); waiter.cleanup(); reject(voiceCancelled());
        if (!target.waiters.size && target !== this.active) this.jobs.delete(target.item.id);
        this.prioritize(target); this.publish();
      };
      target.waiters.add(waiter);
      options.signal?.addEventListener("abort", cancel, { once: true });
    });
    this.prioritize(target); this.publish();
    queueMicrotask(() => this.pump());
    return result;
  }
  cancelWaiting(id?: string) {
    for (const job of [...this.jobs.values()]) if (job !== this.active && (!id || job.item.id === id)) this.invalidate(job.item.id);
  }
  invalidate(id: string) {
    const job = this.jobs.get(id);
    if (!job) return;
    this.jobs.delete(id);
    this.settle(job, undefined, voiceCancelled());
    this.publish();
  }
  dispose() {
    this.disposed = true;
    for (const id of [...this.jobs.keys()]) this.invalidate(id);
  }
  private prioritize(job: Job<T>) {
    const priorities = [...job.waiters].map(waiter => waiter.priority);
    if (priorities.length) job.item.priority = priorities.sort((a, b) => VOICE_PRIORITY[a] - VOICE_PRIORITY[b])[0];
  }
  private compare(a: Job<T>, b: Job<T>) { return VOICE_PRIORITY[a.item.priority] - VOICE_PRIORITY[b.item.priority] || a.order - b.order; }
  private publish() { this.changed(this.items); }
  private settle(job: Job<T>, value?: T, error?: unknown) {
    for (const waiter of job.waiters) { waiter.cleanup(); if (error !== undefined) waiter.reject(error); else waiter.resolve(value!); }
    job.waiters.clear();
  }
  private pump() {
    if (this.active || this.disposed) return;
    const job = [...this.jobs.values()].sort((a, b) => this.compare(a, b))[0];
    if (!job) return;
    this.active = job; job.item.status = "running"; this.publish();
    void job.run().then(value => this.settle(job, value), error => this.settle(job, undefined, error)).finally(() => {
      if (this.jobs.get(job.item.id) === job) this.jobs.delete(job.item.id);
      this.active = null; this.publish();
      // Let batch failure handlers cancel their remaining waiters before another paid call.
      setTimeout(() => this.pump(), 0);
    });
  }
}
