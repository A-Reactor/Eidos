import { createCourtyardGame, hasUnfinishedWork, restoreCourtyardGame, type CourtyardSave } from './game';
import { courtyardWorld } from './world';
import { projectNpcMemoryState } from '@/lib/game/npc-memory-save';
import { formatGameTime } from '@/lib/game/time';
import type { EngineCommand } from '@/lib/engine';
import './style.css';

const STORAGE = 'eidos-courtyard-demo-v1';
const app = document.querySelector<HTMLDivElement>('#app')!;
let loaded: string | null = null, loadedRevision: number | null = null;
async function lockSlot(action: () => void) {
  if (navigator.locks) await navigator.locks.request(STORAGE, action);
  else action();
}
function writeSlot(save: CourtyardSave) {
  const serialized = JSON.stringify(save);
  localStorage.setItem(STORAGE, serialized);
  loaded = serialized; loadedRevision = save.revision;
}
async function writeCheckpoint(save: CourtyardSave, previous: number | null) {
  await lockSlot(() => {
    if (previous !== loadedRevision || localStorage.getItem(STORAGE) !== loaded) throw new Error('存档已在别处更新，请先恢复进度。');
    writeSlot(save);
  });
}
function loadSlot(raw: string) {
  const restored = restoreCourtyardGame(JSON.parse(raw), writeCheckpoint);
  loaded = raw; loadedRevision = restored.getSnapshot().revision || null;
  return restored;
}
let game = createCourtyardGame(writeCheckpoint), busy = false, message = '先试试门锁，再向守门人问路。';
let initialize = false;
try {
  const saved = localStorage.getItem(STORAGE);
  if (saved) { game = loadSlot(saved); message = '已恢复上次的庭院进度。'; }
  else initialize = true;
} catch { message = '上次存档无法恢复，可以重新开始。'; }

function element<K extends keyof HTMLElementTagNameMap>(tag: K, text = '', className = '') {
  const node = document.createElement(tag); node.textContent = text; node.className = className; return node;
}
function button(label: string, onClick: () => void, disabled = false) {
  const node = element('button', label); node.type = 'button'; node.disabled = disabled || busy; node.onclick = onClick; return node;
}
async function run(action: () => Promise<unknown>, success = '进度已自动保存。') {
  if (busy) return;
  busy = true; render();
  try { await action(); message = success; }
  catch (error) { message = error instanceof Error ? error.message : '操作未完成'; }
  finally { busy = false; render(); }
}
function commandButton(command: EngineCommand, pending: boolean) {
  return button(command.name, () => void run(() => game.interact(command.id)), pending || command.enabled === false);
}
function renderMap(saved: ReturnType<typeof game.getSnapshot>, pending: boolean) {
  const { world } = saved.engine, section = element('section', '', 'map-card');
  section.append(element('h2', '旧宅地图'));
  const map = element('div', '', 'map');
  for (const scene of Object.values(world.scenes)) {
    const path = Object.values(world.map.edges).find(e => e.from === world.currentSceneId && e.to === scene.id);
    const command = Object.values(world.commands).find(c => c.target.kind === 'mapEdge' && c.target.id === path?.id);
    const current = scene.id === world.currentSceneId;
    const node = button(`${scene.name}${current ? ' · 所在地' : path?.blocked ? ' · 门锁着' : ' · 前往'}`, () => {
      if (command) void run(() => game.interact(command.id));
    }, pending || current || !path || path.blocked);
    node.className = `place ${current ? 'current' : ''}`;
    if (current) node.setAttribute('aria-current', 'location');
    map.append(node);
  }
  section.append(map, element('p', saved.game.snapshot.worldFlags['gameplay.courtyard.open'] ? '门厅 ↔ 庭院：通路已打开' : '门厅 ↔ 庭院：铜门上锁', 'muted'));
  return section;
}
function render() {
  const saved = game.getSnapshot(), { world } = saved.engine, s = saved.game.snapshot;
  const pending = hasUnfinishedWork(saved.engine);
  const container = element('main'), header = element('header');
  header.append(element('p', 'EIDOS / DEVELOPMENT PLAYGROUND', 'eyebrow'), element('h1', '庭院门'),
    element('p', '一个独立宿主的小测试：捡起钥匙、打开门，走进晨光里的庭院。', 'intro'));
  const layout = element('div', '', 'layout'), stage = element('section', '', `stage ${s.currentSceneId}`);
  stage.append(element('span', s.currentSceneId === 'hall' ? '01 / 门厅' : '02 / 庭院', 'eyebrow'),
    element('h2', world.scenes[s.currentSceneId].name), element('p', courtyardWorld().regions.courtyard.scenes[s.currentSceneId].initialDescription, 'description'));
  const objects = element('div', '', 'objects');
  for (const command of Object.values(world.commands)) {
    if (command.target.kind !== 'component') continue;
    const component = world.components[command.target.id];
    if (component.sceneId && component.sceneId !== s.currentSceneId) continue;
    objects.append(commandButton(command, pending));
  }
  if (!objects.childElementCount) objects.append(element('p', '风穿过树叶。可以从地图返回门厅。', 'muted'));
  stage.append(objects);
  if (s.visitedScenes.includes('garden')) stage.append(element('p', '✓ 已走进庭院，接入闭环完成。', 'success'));
  const aside = element('aside'), stats = element('section', '', 'stats');
  stats.append(element('h2', '旅人状态'));
  const trust = projectNpcMemoryState(s.npcMemory).relationships.守门人?.trust ?? 0;
  for (const [name, value] of [['时间', formatGameTime(s.currentGameTime)], ['体力', `${s.gameplayResources?.['gameplay.courtyard.stamina']} / 5`],
    ['钥匙', String(s.gameplayResources?.['gameplay.courtyard.keys'])], ['守门人信任', String(trust)], ['背包', s.inventory.map(i => `${i.name} ×${i.quantity}`).join('、') || '空']]) {
    const line = element('div', '', 'stat'); line.append(element('span', name), element('strong', value)); stats.append(line);
  }
  aside.append(stats, renderMap(saved, pending)); layout.append(stage, aside);
  const log = element('section', '', 'log'); log.append(element('h2', '行动记录'));
  for (const turn of saved.engine.turns.slice(-5)) log.append(element('p', turn.segments.map(s => s.text).join('\n')));
  if (!saved.engine.turns.length) log.append(element('p', '你的第一个行动将记录在这里。', 'muted'));
  const status = element('p', busy ? '正在处理行动…' : message, 'status'); status.setAttribute('role', 'status');
  const tools = element('div', '', 'tools');
  tools.append(button('保存进度', () => void run(() => game.persist(), '进度已保存。')),
    button('恢复进度', () => {
      try { const save = localStorage.getItem(STORAGE); if (!save) throw new Error('还没有保存的进度'); game = loadSlot(save); message = '进度已恢复。'; }
      catch (error) { message = error instanceof Error ? error.message : '存档无法恢复'; } render();
    }), button('导出存档', () => {
      const url = URL.createObjectURL(new Blob([JSON.stringify(game.exportSave())], { type: 'application/json' }));
      const link = element('a'); link.href = url; link.download = 'courtyard-save.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    }), button('重新开始', () => void run(async () => {
      const fresh = createCourtyardGame();
      await fresh.persist();
      const checkpoint = fresh.exportSave();
      await lockSlot(() => writeSlot(checkpoint));
      game = restoreCourtyardGame(checkpoint, writeCheckpoint);
    }, '已重新开始。')));
  if (pending) tools.prepend(button('继续未完成的程序', () => void run(() => game.resumePending())));
  const detail = element('details'), summary = element('summary', `接入状态 · 版本 ${saved.engine.revision} · 程序回执 ${saved.engine.receipts.length}`);
  detail.append(summary, element('pre', JSON.stringify({ scene: world.currentSceneId, pending: saved.engine.pending.length, resources: world.state.resources,
    lastReceipt: saved.engine.receipts.at(-1), hostExecutions: saved.executions.length, saveRevision: saved.revision,
    storedJsonBytes: new TextEncoder().encode(loaded ?? '').byteLength }, null, 2)));
  const footer = element('footer', '仅供开发测试 · 离线运行 · 使用与 Eidos 正式游戏相同的场景、背包、关系与玩法结算');
  container.append(header, layout, log, status, tools, detail, footer); app.replaceChildren(container);
}
render();
if (initialize) void run(() => game.persist(), message);
