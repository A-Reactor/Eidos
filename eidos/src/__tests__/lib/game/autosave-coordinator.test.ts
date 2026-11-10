import { afterEach, expect, it, vi } from 'vitest';
import { AutosaveCoordinator } from '@/lib/game/autosave-coordinator';
afterEach(() => vi.useRealTimers());
function setup() {
  let state = { scope: 'world:one', references: [{}] };
  let busy = false, interval = 180;
  const write = vi.fn().mockResolvedValue(undefined), error = vi.fn();
  const coordinator = new AutosaveCoordinator({ revision: () => state, write, interval: () => interval, busy: () => busy, onError: error });
  return { coordinator, write, error, change: () => { state = { ...state, references: [{}] }; }, scope: (scope: string) => { state = { ...state, scope }; }, busy: (v: boolean) => { busy = v; }, interval: (v: number) => { interval = v; } };
}
it('deduplicates identical recovery points and serializes concurrent writes, retaining the newest change', async () => {
  const s = setup();
  let finish!: () => void;
  s.write.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
  const first = s.coordinator.checkpoint(); await Promise.resolve();
  const duplicate = s.coordinator.checkpoint();
  expect(s.write).toHaveBeenCalledTimes(1);
  s.change(); const changed = s.coordinator.checkpoint();
  finish(); await Promise.all([first, duplicate, changed]);
  expect(s.write).toHaveBeenCalledTimes(2);
  await s.coordinator.checkpoint(); expect(s.write).toHaveBeenCalledTimes(2);
});
it('combines requests over three minutes, waits for reading to finish, and writes the latest revision', async () => {
  vi.useFakeTimers(); const s = setup();
  for (let i = 0; i < 8; i++) { s.change(); s.coordinator.request(); }
  s.busy(true); await vi.advanceTimersByTimeAsync(181000); expect(s.write).not.toHaveBeenCalled();
  s.busy(false); await vi.advanceTimersByTimeAsync(1100); expect(s.write).toHaveBeenCalledTimes(1);
  s.coordinator.request(); await vi.advanceTimersByTimeAsync(181000); expect(s.write).toHaveBeenCalledTimes(1);
});
it('cancels stale-world requests and disabled background saves, while exit checkpoints still work', async () => {
  vi.useFakeTimers(); const s = setup();
  s.coordinator.request(); s.scope('world:two'); await vi.advanceTimersByTimeAsync(181000);
  expect(s.write).not.toHaveBeenCalled();
  s.interval(0); s.coordinator.request(); await vi.advanceTimersByTimeAsync(181000); expect(s.write).not.toHaveBeenCalled();
  await s.coordinator.checkpoint(); expect(s.write).toHaveBeenCalledTimes(1);
});
it('does not remember a failed write as saved and allows a real retry', async () => {
  const s = setup(); s.write.mockRejectedValueOnce(new Error('disk full'));
  await expect(s.coordinator.checkpoint()).rejects.toThrow('disk full');
  await s.coordinator.checkpoint(); expect(s.write).toHaveBeenCalledTimes(2);
});
it('recreates a removed recovery point even when the live story has not changed', async () => {
  const s = setup(); await s.coordinator.checkpoint();
  s.coordinator.invalidate(); await s.coordinator.checkpoint();
  expect(s.write).toHaveBeenCalledTimes(2);
});
