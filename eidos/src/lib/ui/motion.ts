export const MOTION = {
  feedback: 140,
  component: 220,
  spatial: 320,
  scene: 760,
  easing: "cubic-bezier(.22, 1, .36, 1)",
} as const;

export function shouldReduceMotion(
  setting: boolean,
  systemPreference: boolean,
): boolean {
  return setting || systemPreference;
}
