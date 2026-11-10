import { describe, expect, it } from 'vitest';
import { parseNpcSpeechProfile, parseNpcSpeechProfiles, formatNpcSpeechProfiles, newNpcSpeechProfiles } from '@/lib/game/npc-speech';
import { speechProfile } from '../../fixtures/npc-speech';
import { makeResponse } from '../ai/kei-fixtures';

describe('character speech profiles', () => {
  it('preserves full examples and distinct relationship/emotion styles without truncation', () => {
    const profile = speechProfile(); profile.examples[0].text = '很长的台词。'.repeat(500);
    expect(parseNpcSpeechProfile(profile)).toEqual(profile);
  });
  it.each([null, '谨慎', {}, { ...speechProfile(), version: 2 }, { ...speechProfile(), baseline: '' }, { ...speechProfile(), examples: [] }, { ...speechProfile(), emotions: [{ state: '害怕' }] }])('rejects malformed profile %j', value => {
    expect(parseNpcSpeechProfile(value)).toBeUndefined();
  });
  it('accepts only named allowed characters and copies the input', () => {
    const input = { 千代: speechProfile(), 佐吉: speechProfile('说话客气，怕误事。'), '': speechProfile(), 错误: {} };
    const parsed = parseNpcSpeechProfiles(input, ['千代', '佐吉']);
    expect(Object.keys(parsed)).toEqual(['千代', '佐吉']);
    parsed.千代.examples[0].text = '修改';
    expect(input.千代.examples[0].text).toBe('坐吧，水还热着。');
  });
  it('keeps profiles scoped to their actual names in the rendered context', () => {
    const formatted = formatNpcSpeechProfiles({ 千代: speechProfile(), 佐吉: speechProfile('客气的工人') });
    const data = JSON.parse(formatted.slice(formatted.indexOf('{')));
    expect(data.千代.baseline).toContain('声线低而暖');
    expect(data.佐吉.baseline).toBe('客气的工人');
  });
  it('commits only first profiles for actual speakers, keeping world and saved profiles stable', () => {
    const response = makeResponse({ segments: [{ type: 'dialogue', speaker: '新来人', emotion: 'neutral', text: '你好。' }, { type: 'dialogue', speaker: '千代', emotion: 'neutral', text: '坐吧。' }, { type: 'dialogue', speaker: '佐吉', emotion: 'neutral', text: '我来问问。' }],
      npcSpeechProfiles: { 新来人: speechProfile('说话爽快。'), 千代: speechProfile('试图改写'), 佐吉: speechProfile('试图改写'), 未出场: speechProfile() } });
    expect(newNpcSpeechProfiles(response, { 千代: speechProfile() }, { 佐吉: speechProfile() })).toEqual({ 新来人: speechProfile('说话爽快。') });
  });
  it.each([
    { document: { title: '报告', format: 'markdown' as const, content: '全文', rawOutput: '全文' } },
    { historyRequest: { query: '旧事' } }, { narrativeFrame: { kind: 'cutaway' as const } },
    { _gameplayResult: { pluginId: 'p', id: 'r' } }, { validity: { isPossible: false, fantasyResponse: null, reason: '无效' } },
  ])('keeps non-action metadata inert: %j', mode => {
    const response = { ...makeResponse({ segments: [{ type: 'dialogue', speaker: '千代', emotion: 'neutral', text: '坐吧。' }], npcSpeechProfiles: { 千代: speechProfile() } }), ...mode };
    expect(newNpcSpeechProfiles(response as Parameters<typeof newNpcSpeechProfiles>[0], {}, {})).toEqual({});
  });
});
