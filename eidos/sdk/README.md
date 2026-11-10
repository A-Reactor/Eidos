# @eidos/engine

Eidos 的游戏接入 SDK，Node.js 20+ 可运行，无第三方运行时依赖。

- `@eidos/engine`：通用场景、组件、地图、状态、命令与程序回执协议。
- `@eidos/engine/rpg`：与 Eidos 正式游戏共用的 RPG 初始化、结算及公开世界适配器。

包内已包含 CommonJS JavaScript 和完整 TypeScript 声明，可使用 require 或 ES module 导入。浏览器游戏交给自己的打包器处理。无需 React、Next、Zustand、Tauri、IndexedDB 或仓库路径别名。

## 在仓库中构建和打包

```bash
npm run build:sdk
npm run pack:sdk
```

本地安装包位于 `build/sdk/eidos-engine-0.5.2.tgz`，随包提供 [MIT 许可证](LICENSE)。这些命令不发布到 npm。

在另一个游戏项目中安装：

```bash
npm install /path/to/eidos/build/sdk/eidos-engine-0.5.2.tgz
```

## 执行并恢复宿主命令

```ts
import { createEngineHost, restoreEngineHost, type EngineHostOptions, type EngineHostSnapshot } from '@eidos/engine';

const options: EngineHostOptions<GameState> = {
  project: projectPublicWorld,
  execute: ({ game, request }) => runGameRule(game, request),
  persistence: { save: compareAndSaveSlot },
  context: { maxHistory: 24, maxReceipts: 12, maxBytes: 128_000 },
};
const saved = await readSlot();
const host = saved
  ? restoreEngineHost(saved, options)
  : createEngineHost({ ...options, id: 'save-01', game: initialGame });
if (!saved) await host.persist();
await host.resumePending();
await host.requestCommands({
  id: clickId, expectedRevision: host.getSnapshot().engine.revision,
  commands: [{ commandId: 'unlock' }],
});
const outcome = await host.resumePending();
```

`projectPublicWorld` 根据给定游戏状态确定性地产生完整的 `EngineWorld`。当前场景和已发现地图由 SDK 在发送上下文时筛选。`runGameRule` 校验参数和游戏规则，成功时返回 `{ status: 'completed', game: nextGame, output? }`，失败时返回 `{ status: 'failed' | 'denied', message? }`。宿主运行时计算世界差异，保存游戏状态、执行日志和引擎检查点，再提交回执。

宿主保存回调的 `previousRevision` 是上一份磁盘存档的顶层 `revision`。首次写入传 `null`。读取、比较和写入应在同一事务中完成。

```ts
async function compareAndSaveSlot(next: EngineHostSnapshot<GameState>, previousRevision: number | null) {
  await slot.transaction(async tx => {
    const current = await tx.read();
    if ((current?.revision ?? null) !== previousRevision) throw new Error('Save revision conflict');
    await tx.write(next);
  });
}
```

游戏调用 `act`、`requestCommands` 或 `synchronize` 时，操作的 `expectedRevision` 取自 `host.getSnapshot().engine.revision`。例如，分别保存执行和回执时，两次写入之间宿主存档版本可以从 1 增至 2，引擎版本仍为 1。直接用低层 `EnginePersistence` 时，保存比较引擎检查点版本，首次值为 0。

存档失败时可以重试 `resumePending()`。从磁盘恢复时，SDK 验证日志和游戏投影，并复用已保存的结果。处理器在隔离的游戏状态上准备变更。若调用其他服务，由该服务以 `request.id` 持久化去重。

战斗、时钟或其他独立程序可以直接同步真实结果。传入新的完整游戏状态，SDK 会在一次写入中保存它和对应回执。失败或拒绝可只提交消息与输出。遇到保存失败，用同一 ID 和原输入重试。

```ts
await host.synchronize({
  id: battleResultId, expectedRevision: host.getSnapshot().engine.revision,
  source: 'combat', summary: '战斗结算完成',
  game: gameAfterBattle, output: { victory: true },
});
```

`EngineHost.synchronize()` 使用 Web Crypto 计算 SHA-256，浏览器与 WebView 需在提供 Web Crypto 的安全上下文运行。缺少该能力时会返回 `crypto_unavailable`。宿主和低层会话均把省略 `status` 与显式传 `completed` 视为相同操作。

新同步会在引擎日志中记录宿主输入摘要，恢复时与 v2 存档的摘要表交叉核对。两处摘要用于发现记录错配和单处改动。摘要覆盖完整输入，包括私有游戏状态。请按私有存档的权限管理引擎检查点，尤其是私有状态只有少量可能值时。需要防止存档整体被修改时，由宿主使用可信存储或给整份存档做认证。旧版 v2 的未绑定摘要会被丢弃，已接受状态和回执可恢复。再次用这些旧 ID 发起同步会返回 `operation_conflict`。

`reportSave: 'atomic'` 适用于能从存档重新计算游戏状态的处理器。开启后，`resumePending()` 把执行和回执合并保存，普通按钮命令由三次全量写变为两次。进程在合并保存前退出时，恢复会从上一次存档重新执行。需要先把结果单独落盘时，可以调用 `executePending()`。

`maxSettledExecutions` 限制宿主存档里重复保存的已结算结果，设为 `0` 可只保留待回执的结果。已接受的回执与操作去重记录仍存于引擎检查点。`getStorageStats()` 按 UTF-8 字节报告宿主存档、引擎检查点和执行日志的大小。`synchronizationBytes` 统计宿主摘要表，引擎日志中的摘要计入 `checkpointBytes`。首次同步或裁剪后，宿主存档升级为 v2。SDK 可读旧 v1 和 v2 宿主存档。使用新摘要绑定或专用续写后的检查点需用 0.4.0 或更新版本恢复。

需要让模型承接实际结果时，回执提交后可以选择调用 `host.narrateReceipts({ id, expectedRevision, instruction? })`。可选的 `instruction` 替换默认提示，例如 `Describe the observed result in English.`。它发起一次独立叙事请求，模型提议新命令时会拒绝本次续写，已接受回执仍可使用。每次续写保存一个操作 ID，界面重试时复用原 ID、版本和指令。换用新 ID 会发起新的续写，适合主动请求另一种语言或风格。按钮交互也可以直接显示程序消息。

## 长局紧凑存档

SDK 0.5.0 起可在宿主事务内把 SDK 提供的快照编码后写入。上例的 `await tx.write(next)` 可改为 `await tx.write(encodeEngineHostSnapshot(next))`。存储层可用 `CompactEngineHostSnapshot<GameState>` 表示编码后的对象，仍以顶层 `revision` 比较版本。低层 `EnginePersistence.save` 可用 `encodeEngineCheckpoint(checkpoint)` 编码引擎检查点。

`restoreEngineHost` 和 `restoreEngineSession` 自动读取紧凑或完整格式，`getSnapshot()` 始终返回完整快照。紧凑格式保留全部操作，从日志重建历史、待执行命令、回执和事件，历史操作仍可按原输入重试。存储空间仍随已接受操作增长，每次保存仍是一次全量写入。`getStorageStats()` 统计的是完整快照，实际紧凑存档大小可对编码后的 JSON 按 UTF-8 计量。紧凑存档需要 SDK 0.5.0 或更新版本读取。

## 初始化 RPG

```ts
import { createEngineSession } from '@eidos/engine';
import {
  createRpgSnapshot, prepareRpgAction, buildEidosEngineWorld,
  type WorldDefinition, type AIGameResponse,
} from '@eidos/engine/rpg';

declare const world: WorldDefinition;
const snapshot = createRpgSnapshot({ world, playerName: '旅人' });
const session = createEngineSession({
  id: 'my-save', world: buildEidosEngineWorld({ world, snapshot }),
});
```

`createRpgSnapshot` 只用于新游戏。可指定 `sceneId` 和 `time:{day,hour,minute}`；缺省为第一个场景、第 0 天 08:00。初始插件资源与作者状态来自世界定义，线索从未发现开始，各局的数据彼此隔离。恢复进度时读取保存的快照，不重新初始化。

TypeScript 消费者可以开启 `strict` 和 `skipLibCheck:false`。网络端口使用标准 fetch/AbortSignal 类型；可由 TypeScript 的 DOM 类型库或宿主对应的平台类型提供，运行时无需浏览器。

## 接受行动或程序结果

```ts
declare const response: AIGameResponse;
const result = prepareRpgAction({
  world, snapshot, response, input: '用钥匙开门',
  actionId: 'action-001', timestamp: Date.now(),
});
// 程序验证通过后，一起保存 result.world、result.snapshot、result.record。
// result.effects 交由宿主处理人物初始化、日记、界面通知等。
```

准备过程不修改输入、读取存储或调用模型。它返回完整结算、显示正文和行动记录，记录中的 snapshot 保留行动前状态。无效规则不会留下部分写入。无法确认的地图变化会保留旧地图并跳过该轮移动，通过 map.rejected 通知宿主。

游戏自己执行命令，以 request.id 去重，再调用 session.report 回传真实结果。失败也应回传，且不携带状态变化。把游戏快照、EngineSession 检查点和程序执行日志放在同一个可靠存档边界内；恢复待回传结果时复用执行日志。文件、审核、人物推演和外部工具通过宿主接入。

## 可复制的离线示例

仓库的 `examples/rpg/locked-door.mjs` 和 `world.json` 可整体复制到已安装 SDK 的外部项目，直接运行 `node locked-door.mjs`。示例覆盖失败开门、对话、拾取钥匙、规则资源、地图移动、恢复待回传结果及重复回传。

在 Eidos 仓库中运行相同代码：

```bash
npm run demo:rpg
```

SDK 构建只追踪实际运行代码与公开类型，不复制前端 store。构建失败时保留上次有效产物，目录恢复失败会报告备份位置；生成目录是构建器维护的完整产物，请勿手动混入其他文件。
