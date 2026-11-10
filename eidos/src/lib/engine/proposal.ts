import type { EngineCommandCall, EngineContext, EngineProposal, EngineSegment, EngineUsage } from './types';
import { fields, identifier, invalid, jsonObject, list, object, string } from './validation';
import { proposalShape } from './input';

export function parseEngineSegments(raw: unknown, context?: EngineContext): EngineSegment[] {
  return list(raw, 'segments').map(entry => {
    const s = object(entry); fields(s, ['type', 'text', 'speakerId']); string(s.text, 'segment text');
    if (s.type !== 'narration' && s.type !== 'dialogue') invalid('Unknown segment type');
    if (s.type === 'dialogue') {
      identifier(s.speakerId);
      if (context && !Object.hasOwn(context.components, String(s.speakerId))) invalid('Unknown or unavailable speaker');
    } else if (s.speakerId !== undefined) invalid('Narration cannot have a speaker');
    return { type: s.type, text: s.text as string, ...(s.speakerId === undefined ? {} : { speakerId: s.speakerId as string }) };
  });
}
export function parseEngineCalls(raw: unknown, context: EngineContext): EngineCommandCall[] {
  const seen = new Set<string>();
  return list(raw, 'commands').map(entry => {
    const c = object(entry); fields(c, ['commandId', 'args']); const commandId = identifier(c.commandId);
    if (!Object.hasOwn(context.commands, commandId)) invalid(`Unknown or unavailable command: ${commandId}`);
    if (seen.has(commandId)) invalid('Duplicate command in one operation'); seen.add(commandId);
    return { commandId, args: c.args === undefined ? {} : jsonObject(c.args) };
  });
}
export function parseEngineUsage(raw: unknown): EngineUsage {
  const u = object(raw); fields(u, ['inputTokens', 'outputTokens', 'totalTokens', 'provider', 'model', 'elapsedMs', 'estimated']);
  for (const k of ['inputTokens', 'outputTokens', 'totalTokens']) {
    if (!Number.isSafeInteger(u[k]) || Number(u[k]) < 0) invalid('Invalid token usage');
  }
  for (const k of ['provider', 'model']) if (u[k] !== undefined) string(u[k], k);
  if (u.elapsedMs !== undefined && (typeof u.elapsedMs !== 'number' || !Number.isFinite(u.elapsedMs) || u.elapsedMs < 0)) invalid('Invalid elapsedMs');
  if (u.estimated !== undefined && typeof u.estimated !== 'boolean') invalid('Invalid estimated usage');
  return jsonObject(u) as unknown as EngineUsage;
}
export function parseEngineProposal(raw: unknown, context: EngineContext): EngineProposal {
  const p = jsonObject(raw, { label: 'proposal', shape: proposalShape }); fields(p, ['segments', 'commands', 'usage']);
  const segments = parseEngineSegments(p.segments, context), commands = parseEngineCalls(p.commands === undefined ? [] : p.commands, context);
  if (!segments.length && !commands.length) invalid('A proposal needs prose or a command');
  return { segments, commands, ...(p.usage === undefined ? {} : { usage: parseEngineUsage(p.usage) }) };
}
