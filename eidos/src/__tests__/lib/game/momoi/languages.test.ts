import { expect, it } from 'vitest';
import { availableVoiceLanguages, translationTarget } from '@/lib/game/momoi/languages';
import { installationInput, installationModelNames } from '@/lib/game/momoi/installation-client';
import { DEFAULT_VOICE_CONFIG, normalizeVoiceConfig } from '@/lib/game/momoi/model';
it('offers only the intersection of checked weights and installed resources', () => {
  expect(availableVoiceLanguages({ checks: [], languageResources: [{ id: 'zh', ready: true, detail: '' }, { id: 'ja', ready: false, detail: '缺少词典' }, { id: 'ko', ready: true, detail: '' }],
    models: [{ ready: true, languages: ['zh', 'ja', 'ko'] }, { ready: true, languages: ['zh', 'ja'] }] })).toEqual(['zh']);
  expect(availableVoiceLanguages({ checks: [], languageResources: [{ id: 'zh', ready: true, detail: '' }], models: [{ ready: false, languages: ['zh'] }] })).toEqual([]);
});
it('keeps old Japanese selections and normalizes only supported translation targets', () => {
  expect(translationTarget(normalizeVoiceConfig({ material: 'japanese' }))).toBe('ja');
  expect(translationTarget(normalizeVoiceConfig({ material: 'translated', translationLanguage: 'ko' }))).toBe('ko');
  expect(translationTarget(normalizeVoiceConfig({ material: 'translated', translationLanguage: 'fr' }))).toBeNull();
});
it('does not inspect unrelated default weights for a character that inherits explicitly selected defaults', () => {
  const input = installationInput({ ...DEFAULT_VOICE_CONFIG, gptWeights: '/g', sovitsWeights: '/s' }, { 甲: { referenceAudio: 'UklGRg==' }, 乙: { gptWeights: '/g', sovitsWeights: '/s' } });
  expect(input.models).toEqual([{ gptWeights: '/g', sovitsWeights: '/s' }]);
});
it('labels deduplicated weight checks with the actual default and character names', () => {
  const config = { ...DEFAULT_VOICE_CONFIG, gptWeights: '/g', sovitsWeights: '/s', speakers: {
    甲: { referenceAudio: 'UklGRg==' }, 乙: { gptWeights: '/g', sovitsWeights: '/s' }, 丙: { gptWeights: '/other-g', sovitsWeights: '/other-s' },
  } };
  expect(installationInput(config, config.speakers).models).toHaveLength(2);
  expect(installationModelNames(config)).toEqual(['默认音色、乙', '丙']);
});
