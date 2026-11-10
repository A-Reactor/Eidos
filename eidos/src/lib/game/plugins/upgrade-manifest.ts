import { allowedFields, PluginInputError, record, text } from './validation';
import { parseGameplayPatches } from './json-patch';
import type { GameplayPlugin } from './types';

export function parseUpgradeDeclaration(input: Record<string, unknown>): Pick<GameplayPlugin, 'release' | 'stateVersion' | 'migrations'> {
  if (input.stateVersion !== undefined && (!Number.isSafeInteger(input.stateVersion) || Number(input.stateVersion) < 1)) throw new PluginInputError('模组状态版本须为正整数');
  if (input.migrations !== undefined && (!Array.isArray(input.migrations) || input.migrations.length > 64)) throw new PluginInputError('模组迁移须为列表');
  const seen = new Set<number>();
  const migrations = (input.migrations as unknown[] | undefined)?.map(raw => {
    const step = record(raw); allowedFields(step, ['from', 'to', 'patches']);
    if (!Number.isSafeInteger(step.from) || Number(step.from) < 1 || !Number.isSafeInteger(step.to) || Number(step.to) <= Number(step.from) || Number(step.to) > Number(input.stateVersion ?? 1) || seen.has(Number(step.from))) throw new PluginInputError('模组迁移版本无效或重复');
    seen.add(Number(step.from));
    return { from: Number(step.from), to: Number(step.to), patches: parseGameplayPatches(step.patches) };
  });
  return { ...(input.release === undefined ? {} : { release: text(input.release, Infinity) }),
    ...(input.stateVersion === undefined ? {} : { stateVersion: Number(input.stateVersion) }), ...(migrations ? { migrations } : {}) };
}
