export const openPlugin = {
  format: 'eidos-gameplay-plugin', version: 2, id: 'open-story', name: '自由设定', description: '作者自由组织数据与提示', tags: [],
  prompts: { creation: '按设定安排世界', action: '允许玩家自由行动', review: '只检查实际事实' },
  data: { deck: ['灯塔', '旧信'], clues: { signal: { notes: ['从不同方向探索'], discovered: false } }, arbitrary: [null, 0, false] },
  resources: { energy: { name: '精力', initial: 2, min: 0, max: 3 } },
  readouts: [{ id: 'signal', text: '寻找未知信号', requires: { found: false } },
    { id: 'rest', text: '可以休息或继续探索', resourceRequires: { energy: { max: 0 } }, placement: 'right', tone: 'amber' }],
};
