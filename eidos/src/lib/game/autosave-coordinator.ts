export interface SaveRevision { scope: string; references: unknown[] }
interface Options {
  revision: () => SaveRevision;
  write: () => Promise<void>;
  interval: () => number;
  busy: () => boolean;
  onError: (cause: unknown) => void;
}
const equal = (a: SaveRevision | null, b: SaveRevision) => a?.scope === b.scope && a.references.length === b.references.length && a.references.every((value, index) => value === b.references[index]);

/** One writer per store. Compare immutable references before doing expensive serialization. */
export class AutosaveCoordinator {
  private saved: SaveRevision | null = null;
  private inFlight: Promise<void> | null = null;
  private lastSavedAt = Date.now();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private queuedScope: string | null = null;
  private idle: number | null = null;
  private timingScope: string | null = null;
  constructor(private options: Options) {}

  async checkpoint(): Promise<void> {
    this.cancelBackground();
    if (this.inFlight) { await this.inFlight; return this.checkpoint(); }
    const revision = this.options.revision();
    if (equal(this.saved, revision)) return;
    const write = Promise.resolve().then(() => this.options.write());
    this.inFlight = write;
    try { await write; this.saved = revision; this.lastSavedAt = Date.now(); this.timingScope = revision.scope; }
    finally { if (this.inFlight === write) this.inFlight = null; }
  }

  request(): void {
    if (this.options.interval() <= 0) { this.cancelBackground(); return; }
    const scope = this.options.revision().scope;
    if (this.timingScope !== scope) { this.timingScope = scope; this.lastSavedAt = Date.now(); }
    if (this.queuedScope !== scope) this.cancelBackground();
    this.queuedScope = scope;
    if (this.timer) return;
    this.schedule(Math.max(500, this.options.interval() * 1000 - (Date.now() - this.lastSavedAt)));
  }
  private schedule(delay: number) {
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.queuedScope !== this.options.revision().scope || this.options.interval() <= 0) { this.cancelBackground(); return; }
      const remaining = this.options.interval() * 1000 - (Date.now() - this.lastSavedAt);
      if (remaining > 0 || this.options.busy()) { this.schedule(Math.max(1000, remaining)); return; }
      // Wait for browser idle time; the fallback also yields a rendering opportunity.
      const run = () => {
        this.timer = null; this.idle = null;
        if (this.queuedScope !== this.options.revision().scope || this.options.interval() <= 0) { this.cancelBackground(); return; }
        if (this.options.busy()) { this.schedule(1000); return; }
        void this.checkpoint().catch(this.options.onError);
      };
      if (typeof window !== 'undefined' && window.requestIdleCallback) this.idle = window.requestIdleCallback(run, { timeout: 2000 });
      else this.timer = setTimeout(run, 50);
    }, delay);
  }
  cancelBackground(): void {
    if (this.timer) clearTimeout(this.timer);
    if (this.idle !== null && typeof window !== 'undefined') window.cancelIdleCallback?.(this.idle);
    this.idle = null;
    this.timer = null; this.queuedScope = null;
  }
  invalidate(): void { this.saved = null; }
}

/** Persisted data only: UI navigation, token counters and draft input do not rotate saves. */
export const AUTOSAVE_STATE_KEYS = [
  'currentWorld', 'currentPlaythroughId', 'gameTime', 'playerName', 'entryContext', 'currentSceneId', 'sceneNarrative', 'history', 'availableActions',
  'rewindMemory',
  'sceneDetailLevels', 'discoveredSecrets', 'worldFlags', 'gameplayResources', 'gameplayModState', 'resolvedTimelineEvents', 'deviatedEvents',
  'visitedScenes', 'inventory', 'clues', 'encyclopedia', 'criticalFacts', 'questLog', 'npcStates', 'relationships', 'npcBehaviors', 'npcPersonalities',
  'diary', 'weather', 'protagonistState', 'notebookEvents', 'causalProjections', 'sandboxToolAudit', 'sandboxSaveMarks',
  'sandboxActionLock', 'realityArtifacts', 'boundaryEvents', 'metaChannelManifest', 'midoriSettings', 'midoriAssetRegistry', 'voiceAssets',
  'momoiSettings', 'voiceConfig', 'defaultVoiceProfileId', 'defaultVoiceEnabled', 'worldLine', 'allNodes', 'currentNode',
] as const;
