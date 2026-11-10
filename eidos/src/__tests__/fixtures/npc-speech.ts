import type { NpcSpeechProfile } from '@/lib/game/npc-speech';

export function speechProfile(baseline = '话少，声线低而暖；熟悉的人面前更随意。'): NpcSpeechProfile {
  return {
    version: 1, baseline, wording: ['称呼熟人时直接叫名字', '用眼前的生活小事表达关心'], rhythm: '日常简短，真正着急时会反复叮嘱。',
    relationships: [{ audience: '熟人', style: '少些客套，允许省略彼此知道的事。' }, { audience: '陌生人', style: '客气但不主动谈私事。' }],
    emotions: [{ state: '紧张', style: '转去说眼前的小事，话可能停在一半。' }, { state: '高兴', style: '愿意多问一句对方的近况。' }],
    examples: [{ situation: '招呼熟人', text: '坐吧，水还热着。' }, { situation: '不愿继续谈往事', text: '你杯子空了。再添一点？' }],
  };
}
