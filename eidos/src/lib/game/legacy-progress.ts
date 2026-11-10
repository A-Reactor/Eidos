/** Retired host fields are ignored at boundaries; plugin state and narrative text stay intact. */
export function withoutLegacyProgress<T extends object>(value: T): Omit<T, 'endings' | 'achievements'> {
  const { endings: _endings, achievements: _achievements, ...current } = value as T & { endings?: unknown; achievements?: unknown };
  return current;
}
