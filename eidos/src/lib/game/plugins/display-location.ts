import type { GameplayDisplayLocation } from './types';
import { PluginInputError } from './validation';

export function parseDisplayLocation(value: Record<string, unknown>): GameplayDisplayLocation {
  if (value.placement !== undefined && (typeof value.placement !== 'string' || !['left', 'right'].includes(value.placement))
    || value.tone !== undefined && (typeof value.tone !== 'string' || !['cyan', 'mint', 'amber', 'coral'].includes(value.tone))) throw new PluginInputError('HUD 位置或颜色无效');
  return { placement: (value.placement ?? 'left') as GameplayDisplayLocation['placement'], tone: (value.tone ?? 'cyan') as GameplayDisplayLocation['tone'] };
}
