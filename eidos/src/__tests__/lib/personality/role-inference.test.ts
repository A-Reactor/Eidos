import { describe, expect, it } from 'vitest';
import { extractPersonalityFromDescription } from '@/lib/personality/context';
import { getDefaultBehavior } from '@/lib/game/npc-behavior';

const cases = [
  {
    name: '朝仓铃音',
    description: '十九岁的巫女，山守家族最后的直系。母亲去世后，她接下了言灵神社。她发现了家族旧卷里关于山崩真相的记录，却没有任何人可讲。',
    style: 'fantasy_prone',
  },
  {
    name: '佐藤葵',
    description: '十七岁的高中女生，性子像山鸟，坐不住，也藏不住。她熟悉每一条兽径。秘密：她在观测隧道爆破的落点，已经有一阵子了。',
    style: 'intuitive',
  },
  {
    name: '杂货铺老板',
    description: '经营杂货铺的商人，记得每个老客人的赊账。他每天记录账目，也研究哪条路运货便宜。',
    style: 'empirical',
  },
  {
    name: '小夏',
    description: '普通高中生。父亲是研究员，母亲是画家，她每周去神社看猫。',
    style: 'intuitive',
  },
];

describe('NPC role inference from identity rather than incidental actions', () => {
  it.each(cases)('$name retains their own role', ({ name, description, style }) => {
    const archive = extractPersonalityFromDescription(description, name);
    expect(archive.cognitiveStyle).toBe(style);
    expect(archive.fearsAndTaboos).not.toContain('实验失败');
  });

  it('does not give a student observation equipment because she watches a construction site', () => {
    const student = cases[1];
    const behavior = getDefaultBehavior(student.name, student.description, 'town_main', { day: 0, hour: 9, minute: 0 });
    expect(behavior.currentActivity).not.toMatch(/观测设备|观测台|实验|裂隙/);
    expect(behavior.currentScene).toBe('town_main');
  });

  it('keeps genuine academic roles analytical', () => {
    const archive = extractPersonalityFromDescription('一位研究员，负责实验室里的气候观测。', '林教授');
    expect(archive.cognitiveStyle).toBe('analytical');
    expect(getDefaultBehavior('林教授', '一位研究员，负责实验室里的气候观测。', 'lab', { day: 0, hour: 9, minute: 0 }).currentActivity).toBe('在实验室里忙碌');
  });

  it('uses an explicit structured role before unrelated background details', () => {
    const archive = extractPersonalityFromDescription({ role: '高中生', description: '父亲是研究员，家里收着实验记录。' }, '小夏');
    expect(archive.cognitiveStyle).toBe('intuitive');
    expect(archive.fearsAndTaboos).not.toContain('实验失败');
  });

  it.each([
    ['普通高中生，父亲是研究员。', 'intuitive', '在附近走动'],
    ['他不是研究员，是一位商人。', 'empirical', '在招呼客人，讨价还价'],
    ['他总是穿旧外套。如今在镇上当研究员。', 'analytical', '在实验室里忙碌'],
  ])('attributes the role to the described person: %s', (description, style, activity) => {
    expect(extractPersonalityFromDescription(description, '小林').cognitiveStyle).toBe(style);
    expect(getDefaultBehavior('小林', description, 'town', { day: 0, hour: 9, minute: 0 }).currentActivity).toBe(activity);
  });
});
