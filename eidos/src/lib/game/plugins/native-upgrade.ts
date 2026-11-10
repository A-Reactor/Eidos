import type { GameplayPlugin } from './types';
import { gameplayLedger } from './gameplay-state';

/** Translate already accepted legacy progress; never infer a discovery from hidden case answers. */
export function legacyNativeFlags(previous: GameplayPlugin, target: GameplayPlugin, state: Record<string, unknown>, flags: Record<string, unknown>): Record<string, boolean> {
  if (previous.ui?.presentation === 'native' || target.ui?.presentation !== 'native' || !gameplayLedger(state)) return {};
  const result: Record<string, boolean> = {};
  const list = (value: unknown): string[] => Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
  if (target.ui.actions?.some(action => action.ruleId === 'n-begin')) {
    result['n-started'] = state.started === true;
    result['n-read'] = state.examined === true;
    result['n-resolved'] = state.resolution === 'send' || state.resolution === 'hold';
    return result;
  }
  const data = target.data ?? {}, caseDef = data.case as { testimony?: Array<{ id: string; evidenceId: string }>; rounds?: Array<{ id: string; evidenceId: string }> } | undefined;
  const sequence = caseDef?.testimony ?? caseDef?.rounds;
  if (sequence) {
    const resolved = list(state.resolved), pressed = list(state.pressed);
    sequence.forEach((line, index) => {
      if (resolved.includes(line.id)) { result['n-done-' + index] = true; result['n-found-' + line.evidenceId] = true; }
      if (pressed.includes(line.id)) result['n-pressed-' + index] = true;
    });
    result['n-closed'] = state.completed === true;
  } else if (Array.isArray(data.testimonies)) {
    for (const id of list(state.foundClues)) result['n-found-' + id] = true;
    for (const id of list(state.challengedStatements)) { result['n-heard-' + id] = true; result['n-challenged-' + id] = true; }
    if (typeof state.selectedTestimony === 'string' && state.selectedTestimony) result['n-heard-' + state.selectedTestimony] = true;
    result['n-verdict'] = state.verdict === 'resolved' || state.verdict === 'guilty';
    result['n-closed'] = Boolean(state.privacyChoice);
    for (const rule of target.rules) if (rule.id.startsWith('discover-') && flags['done:' + rule.id]) result['n-found-' + rule.id.slice(9)] = true;
  } else return {};
  result['n-started'] = true;
  result['n-active'] = state.paused !== true && !result['n-closed'];
  return result;
}
