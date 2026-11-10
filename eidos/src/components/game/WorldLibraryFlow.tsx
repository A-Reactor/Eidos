'use client';
import { useGameStore } from '@/store/game-store';
import { WorldSelectScreen } from './WorldSelectScreen';
import { WorldCreateScreen } from './WorldCreateScreen';

/** Keep the same collection underneath creation so returning reveals its scroll and selection. */
export function WorldLibraryFlow() {
  const phase = useGameStore(state => state.phase);
  const creating = phase === 'world_create';
  return <>
    <div data-world-collection-underlay className={creating ? 'absolute inset-0' : 'contents'} inert={creating} aria-hidden={creating || undefined}>
      <WorldSelectScreen preview={creating} />
    </div>
    {creating && <div className="absolute inset-0 z-10 bg-[var(--eidos-paper)]"><WorldCreateScreen /></div>}
  </>;
}
