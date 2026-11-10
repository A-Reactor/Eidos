// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useGameStore } from '@/store/game-store';
import { buildRiftCityStartState } from '@/lib/test/fixtures';
import { speechProfile } from '../../fixtures/npc-speech';
import { makeResponse } from '../../lib/ai/kei-fixtures';
import { buildWorldOnlyExportPackage } from '@/lib/game/world-export';

const initial = useGameStore.getInitialState();
beforeEach(() => {
  const { world, snapshot } = buildRiftCityStartState();
  useGameStore.setState({ ...initial, currentWorld: { ...world, npcs: { 千代: '开咖啡店的店主。' }, npcSpeechProfiles: { 千代: speechProfile() } }, gameTime: snapshot.currentGameTime });
});
afterEach(() => useGameStore.setState(initial, true));
const reply = () => makeResponse({ segments: [{ type: 'dialogue', speaker: '佐吉', emotion: 'neutral', text: '我回去问问。' }], npcSpeechProfiles: { 佐吉: speechProfile('客气，但有时会说漏自己的顾虑。') } });

describe('speech profile persistence', () => {
  it('initializes a world seed even for a minimally tracked character', () => {
    useGameStore.getState().ensurePersonality('千代', '开咖啡店的店主。', false);
    const character = useGameStore.getState().npcPersonalities.千代;
    expect(character.isImportant).toBe(false);
    expect(character.speechProfile).toEqual(speechProfile());
  });
  it('saves a new speaking character once without adding sample dialogue to knowledge', () => {
    useGameStore.getState().acceptNpcSpeechProfiles(reply());
    const first = useGameStore.getState().npcPersonalities.佐吉;
    expect(first.speechProfile?.baseline).toBe('客气，但有时会说漏自己的顾虑。');
    useGameStore.getState().acceptNpcSpeechProfiles({ ...reply(), npcSpeechProfiles: { 佐吉: speechProfile('改成严谨的科学家') } });
    expect(useGameStore.getState().npcPersonalities.佐吉).toEqual(first);
    expect(useGameStore.getState().encyclopedia).toEqual([]);
  });
  it('does not commit profiles for introspection or non-speaking characters', () => {
    useGameStore.getState().acceptNpcSpeechProfiles(reply(), true);
    expect(useGameStore.getState().npcPersonalities.佐吉).toBeUndefined();
    useGameStore.getState().acceptNpcSpeechProfiles({ ...reply(), segments: [{ type: 'narration', text: '你想起了佐吉。' }] });
    expect(useGameStore.getState().npcPersonalities.佐吉).toBeUndefined();
  });
  it('preserves runtime profiles through the actual save and snapshot restoration paths', () => {
    useGameStore.getState().acceptNpcSpeechProfiles(reply());
    const state = useGameStore.getState(), snapshot = state.createSnapshot(), saved = state.serializeState(), world = state.currentWorld!;
    expect(snapshot.npcMemory?.records.佐吉.personality?.speechProfile).toEqual(reply().npcSpeechProfiles!.佐吉);
    state.resetPersonalities(); state.restoreSnapshot(snapshot);
    expect(useGameStore.getState().npcPersonalities.佐吉.speechProfile).toEqual(reply().npcSpeechProfiles!.佐吉);
    state.resetPersonalities(); state.deserializeState(saved, world);
    expect(useGameStore.getState().npcPersonalities.佐吉.speechProfile).toEqual(reply().npcSpeechProfiles!.佐吉);
  });
  it('exports creation profiles as part of the reusable world definition', () => {
    const pkg = buildWorldOnlyExportPackage(useGameStore.getState().currentWorld!);
    const content = pkg.files.find(file => file.path === 'world/world.json')!.content;
    expect(JSON.parse(String(content)).npcSpeechProfiles.千代).toEqual(speechProfile());
  });
});
