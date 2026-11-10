/** Original evaluation stories: expected truths stay separate from model output. */
export const reconstructionCases = [
  { id: 'short', documents: [{ title: '渡口', content: '雨停时，渡口只剩一盏灯。船工阿岚答应等妹妹回来再离港。每次渡河必须交一枚铜币。\n\n第二天，原来的故事里阿岚在洪水中失踪。' }], expectedFacts: ['渡河要交铜币', '阿岚等待妹妹'], expectedKnowledge: ['阿岚不知道明天洪水'], expectedStart: '雨停后的渡口', allowedBranches: ['玩家劝阿岚提前避洪'] },
  { id: 'long', documents: [{ title: '上章', content: '调查员林在港口值班，医师林在山村行医。调查员林被称作小林。\n\n' + '风掠过港口的木桩，船缆轻轻响了一声。\n\n'.repeat(800) }, { title: '末章', content: '小林回到港口。所有人以为闸门自行关闭，最后的记录却证实：关闭闸门的是医师林，目的是阻止疫水流入港口。' }], expectedFacts: ['两位林不是同一人', '医师林关闭闸门以阻止疫水'], expectedKnowledge: ['调查员开局不知道关闸者'], expectedStart: '调查员在港口值班', allowedBranches: ['找到另一条疏散道路'] },
  { id: 'notes', documents: [{ title: '设定', content: '城中铜币只用于渡河。灯塔每晚熄灭一小时。居民不能在熄灯时渡河；违反者会失去一天记忆。' }], expectedFacts: ['熄灯时不能渡河', '违例失去一天记忆'], expectedKnowledge: [], expectedStart: '生成并标明补全的开局', allowedBranches: ['研究熄灯规律'] },
  { id: 'flashback', documents: [{ title: '回忆', content: '现在，阿岚在渡口等人。他想起三年前哥哥离港的夜晚。昨晚他梦到哥哥归来，醒来后码头依旧无人。' }], expectedFacts: ['哥哥三年前离港', '归来只是梦境'], expectedKnowledge: ['阿岚不知道哥哥现在的位置'], expectedStart: '现在的渡口', allowedBranches: ['寻找哥哥'] },
  { id: 'conflict', documents: [{ title: '证词一', content: '守卫说：“我没有开闸。”这是一句谎话，他正把钥匙藏进袖口。' }, { title: '证词二', content: '书记员的记录写着：“开闸者尚不明确。”记录在守卫到达之前写成。' }], expectedFacts: ['守卫否认是谎话', '记录不是全知结论'], expectedKnowledge: ['书记员当时不知道开闸者'], expectedStart: '守卫藏钥匙时', allowedBranches: ['检查钥匙'] },
] as const;
