import { describe, expect, it } from 'vitest';
import { alteredText, parseTextEffects, textEffectRuns } from '@/lib/game/text-effects';
import { extractSegmentsProgressive } from '@/lib/ai/stream-parser';
import { parseGameplayOperation } from '@/lib/game/plugins/gameplay-state';
import { buildGameplayStaticPrompt } from '@/lib/game/plugins/runtime';
import { parsePluginFile } from '@/lib/game/plugins/manifest';
import { readFileSync } from 'node:fs';

describe('native lettering data', () => {
  it('accepts persistent brightness and transition duration, including an explicit return to normal', () => {
    expect(parseTextEffects([{kind:'dim',brightness:0.25,transitionMs:1400},{kind:'dim',brightness:1,transitionMs:0},
      {kind:'dim',brightness:-0.2},{kind:'dim',brightness:1.2},{kind:'dim',brightness:'dark'},{kind:'dim',brightness:0.4,transitionMs:-1}]))
      .toEqual([{kind:'dim',brightness:0.25,transitionMs:1400},{kind:'dim',brightness:1,transitionMs:0}]);
  });
  it('keeps supported decorations and discards arbitrary CSS, invalid targets and timing', () => {
    expect(parseTextEffects([{ kind: 'mask', quote: '姓名', css: 'position:fixed' }, { kind: 'color', value: 'url(javascript:alert(1))' },
      { kind: 'size', value: 'huge' }, { kind: 'replace', target: 'choice', value: '隐去' }, { kind: 'fracture', delayMs: Infinity }, { kind: 'erase', target: 'menu' }]))
      .toEqual([{ kind: 'mask', quote: '姓名' }, { kind: 'size', value: 'huge' }]);
  });
  it('addresses exact choice identities and repeated phrases without overlapping replacements', () => {
    expect(textEffectRuns('回来，回来。', [{ kind: 'mask', quote: '回来', occurrence: 2 }, { kind: 'color', quote: '回来', occurrence: 2, value: 'accent' }, { kind: 'erase', quote: '来，回来' }], 'text'))
      .toEqual([{ start: 3, end: 5, text: '回来', effects: [{ kind: 'mask', quote: '回来', occurrence: 2 }, { kind: 'color', quote: '回来', occurrence: 2, value: 'accent' }] }]);
    expect(textEffectRuns('留下信件', [{ kind: 'replace', target: 'choice', quote: '留下', value: '烧掉' }], 'choice')).toEqual([]);
    expect(alteredText('你还在吗', [{ kind: 'garble' }])).toBe(alteredText('你还在吗', [{ kind: 'garble' }]));
  });
  it('carries complete effects before streamed text and ignores incomplete declarations', () => {
    const segment = { type: 'dialogue', speaker: '澄', textEffects: [{ kind: 'mask', quote: '明天', delayMs: 700 }], text: '明天你还会来吗？' };
    const json = JSON.stringify({ segments: [segment] });
    expect(extractSegmentsProgressive(json).segments).toEqual([segment]);
    const draft = json.slice(0, json.indexOf('你还'));
    expect(extractSegmentsProgressive(draft)).toEqual({ segments: [{ ...segment, text: '明天' }], lastIsDraft: true });
    expect(extractSegmentsProgressive('{"segments":[{"type":"narration","textEffects":[{"kind":"mask"')).toEqual({ segments: [], lastIsDraft: false });
  });
  it('preserves effects through author acceptance and JSON save round trips without changing canonical text', () => {
    const segment = { type: 'narration', text: '门没有上锁。', textEffects: [{ kind: 'replace', quote: '没有', value: '已经', delayMs: 600 }] };
    const operation = parseGameplayOperation({ id: 'cue', expectedRevision: 0, summary: '门边的字迹', state: {}, facts: {}, segments: [segment] });
    expect(JSON.parse(JSON.stringify(operation)).segments).toEqual([segment]);
  });
  it('does not mistake nested effect targets or values for the streaming prose key', () => {
    const effects = [{ kind: 'replace', target: 'text', quote: '明天', value: 'text' }];
    const prefix = '{"segments":[{"type":"dialogue","textEffects":' + JSON.stringify(effects);
    expect(extractSegmentsProgressive(prefix)).toEqual({ segments: [], lastIsDraft: false });
    expect(extractSegmentsProgressive(prefix + ',"text":"明天')).toEqual({ segments: [{ type: 'dialogue', text: '明天', textEffects: effects }], lastIsDraft: true });
  });
  it('supplies the native contract only when the plugin is active, without injecting its example story', () => {
    const plugin = parsePluginFile(JSON.parse(readFileSync('mods/dist/palimpsest-stage.eidos-plugin.json', 'utf8')))[0];
    expect(plugin.ui).toMatchObject({ reading: 'inherit', presentation: 'native-text' });
    const prompt = buildGameplayStaticPrompt({ gameplayPlugins: [plugin] }, 'action');
    expect(prompt).toContain('textEffects'); expect(prompt).toContain('delayMs');
    expect(plugin.prompts.creation).not.toContain('本包是原创局部短篇');
    expect(buildGameplayStaticPrompt({ gameplayPlugins: [{ ...plugin, activation: { requires: { awake: true } } }] }, 'action')).not.toContain('原生文字演出协议');
  });
});
