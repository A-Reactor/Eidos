import type { EngineWorld } from '@/lib/engine';

export function courtyardWorld(): EngineWorld {
  return {
    id: 'courtyard', name: '庭院', currentSceneId: 'hall', state: { keys: 1, alarm: false },
    scenes: {
      hall: { id: 'hall', name: '门厅', description: '通往庭院的门锁着。', state: {} },
      garden: { id: 'garden', name: '庭院', description: '门外有一棵树。', state: {} },
    },
    components: {
      door: { id: 'door', kind: 'door', name: '庭院门', sceneId: 'hall', state: { open: false } },
      guide: { id: 'guide', kind: 'npc', name: '向导', sceneId: 'hall', state: { trust: 0 } },
      clock: { id: 'clock', kind: 'clock', name: '时钟', state: { hour: 8 } },
      secret: { id: 'secret', kind: 'note', name: '内部答案', sceneId: 'hall', visible: false, state: { password: '秘密' } },
      tree: { id: 'tree', kind: 'object', name: '树', sceneId: 'garden', state: {} },
    },
    map: {
      nodes: {
        entrance: { id: 'entrance', sceneId: 'hall', name: '门厅', position: { x: 0, y: 0 }, state: {} },
        yard: { id: 'yard', sceneId: 'garden', name: '庭院', position: { x: 10, y: 0 }, state: {} },
      },
      edges: { path: { id: 'path', from: 'entrance', to: 'yard', bidirectional: true, blocked: true, state: {} } },
    },
    commands: {
      unlock: { id: 'unlock', name: '打开庭院门', description: '宿主检查钥匙，解锁门和地图通路。', target: { kind: 'component', id: 'door' } },
      talk: { id: 'talk', name: '与向导交谈', target: { kind: 'component', id: 'guide' } },
      travel: { id: 'travel', name: '前往庭院', target: { kind: 'mapEdge', id: 'path' } },
      secret: { id: 'secret', name: '读取内部答案', target: { kind: 'component', id: 'secret' } },
    },
  };
}
