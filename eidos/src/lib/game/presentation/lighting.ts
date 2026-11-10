import type { ResolvedCue } from './types';

export const DEFAULT_BRIGHTNESS_TRANSITION_MS = 600;
export const DIM_PULSE_MS = 1600;
const clamp = (value: number) => Math.max(0, Math.min(1, value));
const ease = (value: number) => value * value * (3 - 2 * value);

/** Lighting is projected from branch events too, so reopening never invents a new timer. */
export function presentationLighting(cues: ResolvedCue[]) {
  let brightness = 1, stillBrightness = 1;
  const active = cues.filter(cue => cue.active && cue.effect.kind === 'dim');
  for (const cue of active) {
    const target = cue.effect.brightness;
    if (target === undefined) continue;
    const duration = cue.effect.transitionMs ?? DEFAULT_BRIGHTNESS_TRANSITION_MS;
    const progress = duration ? clamp(1 - cue.remainingMs / duration) : 1;
    brightness += (target - brightness) * ease(progress);
    stillBrightness = target;
  }
  // Old declarations remain a short pulse; they never replace the persistent level.
  const pulse = active.findLast(cue => cue.effect.brightness === undefined && cue.remainingMs > 0);
  if (pulse) {
    const progress = clamp(1 - pulse.remainingMs / DIM_PULSE_MS);
    const envelope = Math.min(1, progress * 4, (1 - progress) * 4);
    brightness *= 1 - 0.6 * ease(envelope);
    stillBrightness *= 0.75;
  }
  return { brightness, stillBrightness };
}
