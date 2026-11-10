import { updateDurableMeta } from './storage';

type Change<T> = (value: T) => T;

export function createUsageLedger<T>(key: string, parse: (value: unknown) => T | null, publish: (value: T) => void) {
  const pending: Change<T>[] = [];
  let inFlight: Promise<void> | null = null;
  let baseline: T | undefined;
  let warned = false;
  let invalidRaw: string | undefined;

  function legacy() {
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(key);
      if (!raw) return null;
      const value = parse(JSON.parse(raw));
      if (value !== null) return { raw, value };
    } catch { /* Preserve unreadable or malformed legacy data. */ }
    if (raw && raw !== invalidRaw) {
      invalidRaw = raw;
      console.warn(`[Usage] Invalid legacy record ${key}`);
    }
    return null;
  }

  async function flush(initial: T) {
    try {
      do {
        const batch = pending.slice();
        const old = legacy();
        const saved = await updateDurableMeta<T>(key, current => batch.reduce<T>((value, change) => change(value), current ?? old?.value ?? initial));
        pending.splice(0, batch.length);
        // Free space only after commit and only if another tab has not replaced the legacy record.
        try { if (old && localStorage.getItem(key) === old.raw) localStorage.removeItem(key); } catch { /* The IndexedDB copy is committed. */ }
        publish(pending.reduce<T>((value, change) => change(value), saved));
        warned = false;
      } while (pending.length);
      baseline = undefined;
    } catch (error) {
      // Retry unapplied changes on the next update or hydration.
      if (!warned) console.warn(`[Usage] Could not commit ${key}`, error);
      warned = true;
    } finally {
      inFlight = null;
    }
  }

  return {
    legacy: () => legacy()?.value,
    sync(initial: T, change?: Change<T>): Promise<void> {
      if (typeof window === 'undefined' || typeof indexedDB === 'undefined') return Promise.resolve();
      baseline ??= initial;
      if (change) pending.push(change);
      return inFlight ??= flush(baseline);
    },
  };
}
