export function formatUsage(tokens: number, cost: number, expanded = false): string {
  const count = Math.max(0, Math.round(Number.isFinite(tokens) ? tokens : 0));
  const scale = count >= 999_950_000 ? [1e9, 'B'] as const : count >= 999_950 ? [1e6, 'M'] as const : count >= 1000 ? [1e3, 'K'] as const : [1, ''] as const;
  const label = expanded ? String(count) : `${(count / scale[0]).toFixed(1)}${scale[1]}`;
  return `${label} token - ${(Number.isFinite(cost) ? cost : 0).toFixed(expanded ? 2 : 1)}¥`;
}
