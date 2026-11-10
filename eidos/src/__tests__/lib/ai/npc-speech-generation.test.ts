import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildRiftCityStartState } from '@/lib/test/fixtures';
import { generateWorldData, generateWorldDataStream } from '@/lib/ai/world-generator';
import { callDeepSeek } from '@/lib/ai/client';
import { streamCreationJSON } from '@/lib/ai/creation-stream';
import { buildWorldContextSections } from '@/lib/ai/context-builder';
import { extractPersonalityFromDescription } from '@/lib/personality/context';
import { speechProfile } from '../../fixtures/npc-speech';

vi.mock('@/lib/ai/client', async original => ({ ...await original<typeof import('@/lib/ai/client')>(), callDeepSeek: vi.fn() }));
vi.mock('@/lib/ai/creation-stream', async original => ({ ...await original<typeof import('@/lib/ai/creation-stream')>(), streamCreationJSON: vi.fn() }));
const base = buildRiftCityStartState();
const name = Object.keys(base.world.npcs)[0];
beforeEach(() => {
  const content = JSON.stringify({ ...base.world, npcSpeechProfiles: { [name]: speechProfile(), 无此人物: speechProfile(), 错误: { version: 1 } } });
  vi.mocked(callDeepSeek).mockResolvedValue({ content, usage: {} as never, elapsedMs: 1 });
  vi.mocked(streamCreationJSON).mockResolvedValue(content);
});

describe('speech profiles across creation and narration', () => {
  it.each(['normal', 'stream'] as const)('retains valid declared character profiles in %s world creation', async mode => {
    const world = mode === 'normal' ? await generateWorldData('山间小镇')
      : (await generateWorldDataStream('山间小镇', () => {}, () => {}, 'speech_test')).world;
    expect(world.npcSpeechProfiles).toEqual({ [name]: speechProfile() });
  });
  it('keeps world seeds static and new characters dynamic, including characters absent from the scene roster', () => {
    const world = { ...base.world, npcSpeechProfiles: { [name]: speechProfile() } };
    const character = { npcId: '佐吉', isImportant: false as const, awareness: 0, lastUpdated: 1,
      archive: extractPersonalityFromDescription('管材料的工人。', '佐吉'), speechProfile: speechProfile('客气的工人') };
    const first = buildWorldContextSections({ world, snapshot: base.snapshot, npcPersonalities: { 佐吉: character } });
    expect(first.stablePrefix).toContain('话少，声线低而暖');
    expect(first.dynamicSuffix).toContain('客气的工人');
    expect(first.stablePrefix).not.toContain('客气的工人');
    const changed = buildWorldContextSections({ world, snapshot: base.snapshot, npcPersonalities: { 佐吉: { ...character, speechProfile: speechProfile('直爽的工人') } } });
    expect(changed.stablePrefix).toBe(first.stablePrefix);
    expect(changed.dynamicSuffix).toContain('直爽的工人');
  });
});
