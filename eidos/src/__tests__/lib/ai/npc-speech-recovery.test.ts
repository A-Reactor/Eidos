import { describe, expect, it } from 'vitest';
import { salvagePartialGameResponse } from '@/lib/ai/salvage';
import { extractSegmentsProgressive } from '@/lib/ai/stream-parser';
import { missingActionTextError } from '@/lib/ai/action-handler';
import { speechProfile } from '../../fixtures/npc-speech';
import { usage } from './kei-fixtures';

describe('speech examples cannot become recovered gameplay', () => {
  it('fails with no prose when generation ends inside the speech profile', () => {
    const raw = '{"npcSpeechProfiles":{"佐吉":{"version":1,"examples":[{"situation":"闲聊","text":"坐吧，水还热着。"},';
    const result = salvagePartialGameResponse(raw);
    expect(result.segments).toEqual([]);
    expect(result.document).toBeUndefined();
    expect(extractSegmentsProgressive(raw).segments).toEqual([]);
    expect(missingActionTextError(result, { ...usage, finishReason: 'length' })?.usage?.finishReason).toBe('length');
  });
  it('recovers only actual incomplete segment prose, keeping complete profiles separately', () => {
    const profiles = { 佐吉: speechProfile() };
    const raw = `{"npcSpeechProfiles":${JSON.stringify(profiles)},"segments":[{"type":"dialogue","speaker":"佐吉","text":"这才是实际说出口的话。", BROKEN`;
    const result = salvagePartialGameResponse(raw);
    expect(result.segments.map(segment => segment.text)).toEqual(['这才是实际说出口的话。']);
    expect(result.npcSpeechProfiles).toEqual(profiles);
  });
  it('does not scan later metadata when an empty segments array was already closed', () => {
    const raw = `{"segments":[],"npcSpeechProfiles":${JSON.stringify({ 佐吉: speechProfile() })}, BROKEN`;
    const result = salvagePartialGameResponse(raw);
    expect(result.segments).toEqual([]);
    expect(result.document).toBeUndefined();
    expect(missingActionTextError(result, { ...usage, finishReason: 'length' })).toBeDefined();
  });
});
