# EIDOS 玩法插件

[English quickstart](modding.en.md)

在「创造世界 → 玩法与模组」选择内置玩法，或通过「拖入或选择玩法插件」导入 JSON。初次试用可导入[铜门谜题](examples/gameplay-door-puzzle.json)。导入成功后会为本次创建选中该插件，并保存到本机库。下次创建时可以重新选择。世界和生成材料预设会保存实际采用的清单。

本机插件库按内容去重。同一 ID 下的不同内容可以并列显示，选项附带文件名和版本号。每个世界启用同一 ID 的一个版本，填充预设时保留预设原有选择，已创建的世界继续使用自己的版本。缓存损坏时会提示并保留原数据。保存失败时仍可在当前创建中使用插件并导出备份。

按目的跳转到[编写规则](#自定义玩法)、[添加数值与 HUD](#v2-数值资源)、[编写交互界面](#写操作与界面模组)或[更新已有世界](#更新正在游玩的模组)。

内置七种：剧情分支与回溯、循环与受限回溯、[剧情锚定点](story-anchors.md)、线索探索与知识解谜、定时事件与剧情干预、证据收集与推理、人物关系与日常互动。它们提供机制设计与叙事指南；具体模型生成质量仍取决于世界设定和玩家行动。剧情锚定点只使用三阶段指南与世界专属玩法配置，不新增执行规则或专用界面。

## 自由玩法与扩展原则

插件可以只有叙事指南，不要求任务、数值、奖励或固定阶段。仅在玩法确实需要明确结算时声明规则；规则只作用于相关事件，普通探索和玩家自由输入仍按世界事实推进。任务、线索、卡牌、角色资料等由作者自由组织，不按游戏类型规定字段。后续扩展以实际文字游戏玩法验证为依据。

[`开放探索示例`](examples/gameplay-open-exploration.json) 展示结构化素材和可选提示，玩家可以接近或忽略探索机会。它只记录一个事实，不替玩家规定路线或结束游戏。

## 自定义玩法

可直接导入 [`examples/gameplay-door-puzzle.json`](examples/gameplay-door-puzzle.json)。修改 ID、描述及三阶段指南即可制作新的谜题、调查或关系玩法。

| 字段 | 含义 |
| --- | --- |
| `format` / `version` | `eidos-gameplay-plugin`；`1` 为布尔规则，`2` 增加整数资源 |
| `id` | 字母开头的小写 ID，最长 64 字符，允许数字、`-`、`_`。自定义 ID 须避开内置项，每个世界同一 ID 启用一个版本 |
| `release` | 可选的作者发行标签，最长 80 字符，用于区分同一插件的版本 |
| `name` / `description` / `tags` | 创建界面的名称、说明、标签 |
| `prompts.creation` | KEI 创建世界时使用，生成 `gameModeConfig` |
| `prompts.action` | ALICE 在插件当前启用时使用 |
| `prompts.review` | KEI 审核时使用，与行动前快照及事件提案一起核对 |
| `rules` | 可选的确定性布尔状态转换，默认空数组 |
| `resources` | v2 必填资源声明对象（允许为空）；v1 不接受此字段 |
| `data` | 可选的作者设定 JSON 对象，无固定内部结构，单对象最多 40 KB |
| `readouts` | 可选文字提示；只影响显示，支持 v1/v2 |
| `activation` | 可选剧情启用条件：本插件布尔标记、场景 ID；旧包默认常驻 |
| `settings` | 可选作者偏好声明，自动生成独立设置页，不发送给模型 |
| `ui` | 可选 HTML/JavaScript 操作界面；隔离运行于主舞台，不进入模型上下文 |

每个规则包含 `id`、`description`、`requires`、`sets`、`once`。`requires` 和 `sets` 是局部布尔标记对象；缺失标记视为 false。ALICE 用 `pluginEvents: [{"pluginId":"door-puzzle","ruleId":"find-key"}]` 提议事件。解释器按列表顺序检查前提，整批通过才应用；未知规则或前提失败会拒绝行动且保留输入。`once` 默认为 true，重复事件不重复执行。

标记保存为 `gameplay.<插件ID>.<标记ID>`，一次性记录保存为 `gameplay.<插件ID>.done:<规则ID>`。它们进入现有 worldFlags 与快照，回溯到旧节点会恢复当时状态；同一批中的前置事件可以解锁后续事件。普通 sceneChanges 不能绕过规则写入这类标记。

基础清单仍是数据；可选 `ui` 可以附带作者的 HTML/CSS/JavaScript。界面在独立来源的 sandbox iframe 内运行，不能读取 EIDOS 的存储、密钥或调用宿主文件/沙箱工具。三阶段指南不能当作权限授权。选定插件数量和包大小不设人为上限；单个规则声明仍遵循每个最多 32 条规则和每组最多 32 个布尔标记的当前协议。名称、说明、三阶段提示词、界面源码、设定数据和初始作者状态不设字数上限。不支持的版本和字段会明确报错。

### 结构化设定数据

`data` 可以保存物品表、线索关系、卡牌素材、角色资料或作者自定义内容；引擎不要求它采用特定玩法格式。它随插件保存、导出；创建时进入上下文，行动与审核只装配当前启用的完整资料；`prompts` 说明模型应如何使用这些数据。数组、字符串、布尔值、有限数值和 null 均可嵌套，沿用 JSON 深度限制。设定数据不自动成为动态账本或可执行指令。生成的世界专属配置继续由 `gameModeConfig` 承载；运行中的明确数值和事实由现有资源、标记承载。

世界创建现在在同一作者对话中生成、检查和修改全部内容，设定与 `timeline` 没有先后阶段。既有 `prompts.creation` 和 `data` 可直接使用，持续作用于所有续轮；不需要另写时间线插件。创建指南可以约定人物、地点、可能事件及 `gameModeConfig` 的相互关系，并要求检查后修正。具体玩法和玩家条件优先于通用数量建议；没有预设未来的玩法可以要求 `timeline: []`。世界专属内容依然使用标准字段与自由结构的 `gameModeConfig`，插件清单由宿主保留。生成材料导出包含作者对话、操作回执、草稿字段及中断片段，恢复时继续同一对话。

内容齐备时直接输出完整世界或 `world.finish`；填充进度由浏览器观察现有输出流，不需要为了进度拆分操作或例行 `world.validate`。该检查只在本地验证结构和引用。普通概念创建不再额外购买整世界审核；原文创建或明确固定项只做一次有范围的约束核对，修正后不反复复审。请勿在插件创建指南里要求反复检查丰富度、固定数量或无关的通用模板。

### 可选文字提示

`readouts` 每项只必填 `id` 和 `text`（最多 600 字符）；`placement` / `tone` 与数值 HUD 相同。可选的 `requires` 使用本插件布尔标记，缺少标记视为 false；`resourceRequires` 使用 v2 本插件资源区间，缺少运行账本值时采用初值，零值保留。所有已声明条件同时成立才显示，未声明条件则常驻。每个插件最多 32 项提示。

```json
{
  "id": "signal",
  "text": "可探索陌生信号，也可另寻方向",
  "requires": { "signal-found": false }
}
```

提示只是当前状态的显示，可以表达目标、事实、回合提醒或其他内容。它不触发事件、不奖励或惩罚、不限制输入，不增加模型请求；作者无需设计完整任务流程。舞台中各插件的提示先于该插件的数值，插件之间按选择顺序，共享左右各三个 HUD 位置；空间不足时缩减展示。长文在 HUD 截短，完整内容保留在标题及“世界状态 → 玩法提示”中。提示随已接受状态和回溯变化，显示配置不进入 ALICE、KEI、UZQ 或生成模型上下文。

## v2 数值资源

可直接导入 [生存资源示例](examples/gameplay-survival-resources.json) 或 [侦探调查示例](examples/gameplay-mystery-investigation.json)。内置“生存探索”等指南不会自动变为数值玩法，需选择带 v2 声明的插件。

`resources` 的键是本插件局部资源 ID，每个插件最多 32 个资源。资源字段：`name`、`initial`、`min`、`max` 为必填；`unit` 默认空字符串；`visible` 默认 true，false 时不显示在“世界档案 → 世界状态 → 玩法资源”。所有数值为 ±1,000,000 以内整数，初值在上下限内。允许声明负值区间，例如债务。

### 叙事界面的 HUD

需要频繁关注的资源可以添加可选 `hud` 字段，直接在对话主界面的场景区域常驻显示，不新增按钮、弹窗或侧栏。未声明 `hud` 的旧插件仍只在世界状态抽屉显示；`visible:false` 也会隐藏 HUD。低频的插件说明、规则与创作清单继续放在现有抽屉。

```json
{
  "name": "体力", "initial": 6, "min": 0, "max": 6, "unit": "点",
  "hud": { "style": "gauge", "placement": "left", "tone": "mint", "warningBelow": 2 }
}
```

`style` 必填，可选 `gauge`（弧形仪表）、`bar`（状态条）、`counter`（计数）。`placement` 可选 `left` / `right`，默认 left；`tone` 可选 `cyan` / `mint` / `amber` / `coral`，默认 cyan。`warningBelow` / `warningAbove` 为资源区间内整数，当前值严格低于/高于阈值时显示文字警戒与警戒色；同时声明时低值阈值须小于高值阈值。警戒只影响显示，不修改结算。

多个插件共享舞台空间，按清单顺序左右各最多显示前三项。HUD 根据正文实际高度预留空间；高度不足会缩小仪表、减少项目或收起显示，宽度很窄时只显示左右第一项的紧凑数值。记录面板占满空间时隐藏 HUD，完整数值仍可在抽屉查看。展开抽屉或进入欣赏模式时隐藏 HUD。它读取当前资源账本，接受行动、回溯与恢复存档时随账本更新，不显示模型尚未接受的事件提案。HUD 配置随世界清单导入/导出，不发送给 ALICE、KEI、UZQ 或世界生成模型；没有任意 HTML、CSS 或脚本执行。

生存资源示例已包含体力仪表和补给计数。已创建的世界不会自动采用更新后的示例；导入新版插件并创建新世界即可体验。

v2 规则增加 `resourceRequires` 与 `resourceChanges`。前者按局部资源指定至少一个 `min`/`max` 条件，后者声明固定非零整数增减：

```json
{
  "id": "eat",
  "description": "进食一份补给",
  "once": false,
  "resourceRequires": { "supplies": { "min": 1 }, "stamina": { "max": 5 } },
  "resourceChanges": { "supplies": -1, "stamina": 1 }
}
```

所有资源引用必须在本插件声明；规则至少改变一个布尔标记、资源或声明的作者状态/事实。资源前提在事件执行前检查，所有增减结果须在资源自身上下限内。越界会整批拒绝，不会截断为上限或留下部分扣款。同批重复规则仅执行一次（包括 `once:false`），后续行动可以重新执行 `once:false`；`once:true` 仍默认一次性。AI 的事件只接受 pluginId/ruleId，不能附加任意金额或写入绝对值。

数值存放在独立 `gameplayResources` 账本，键为 `gameplay.<插件ID>.<资源ID>`，布尔状态继续在 worldFlags；两个域互不混用。快照、存档、世界线 CAS 与回溯保存/恢复该账本。旧存档缺少字段时按声明初值恢复，合法的零值会保留；未知资源或超界存档明确拒绝。世界定义导出保留完整声明。

当前启用插件的固定声明进入 ALICE/KEI 前缀，当前数值进入动态后缀；同一场面的声明可复用，切换玩法时前缀会变化；审核使用行动前账本。事件提案的叙事依据仍需要模型遵守指南。自由输入无法通过纯数值检查证明事件是否确实发生，也不能自动推断每句话对应哪个资源规则。设计时应在 action/review 指南明确行动与事件的对应。

## UZQ 玩法设计检查

选择自定义插件后，可按“检查玩法设计”独立调用 UZQ，分析规则矛盾、资源恢复路径、重复收益、一次性阻塞与叙事指南冲突。最多返回 12 条定位到插件/规则的建议。使用系统设置中的 UZQ 配置，点击才调用并计入真实用量；不改写清单，不修改世界状态，不增加每轮 ALICE/KEI 的等待。失败或停止后仍可继续创建。修改插件选择会取消当前检查并移除旧意见。检查结果是建议，不能代替规则验证或证明玩法可达。

内部接口 `POST /api/world/plugins/review`：请求 `{gameplayPlugins, _settings?}`（256 KB 上限），响应 `{review, usage}`；失败 `{error, usage?}`。`review` 为 `{summary, findings:[{pluginId, ruleId?, severity:"warning"|"suggestion", message, suggestion}]}`。本地应用沿用请求中角色配置与模型密钥、同源保护，不新增远端账号鉴权；服务器环境密钥仍遵循现有客户端配置规则。进程内最多 4 个并发、无后台排队、120 秒模型检查限时（请求体读取尚未包含在期限内）。状态 400 无效输入，403 跨站，413 过大，429 并发占满，499 用户取消，502 模型/输出失败，504 检查超时。已返回的真实用量在成功和失败时均记录一次；模型未返回用量或客户端断开时不能凭空推算实际扣费。

## 当前能力边界

声明式规则中，v1 提供布尔转换，v2 增加整数资源和固定增减；不内置骰子、战斗、动态公式或现实时间结算。作者可以在隔离 JavaScript 中自行实现玩法，通过下方正式提交保存任意 JSON 状态与事实，无需等待核心新增某类游戏格式。正式提交的重复保护由操作 ID 与版本提供；自由行动提议已声明的 effects 规则时也会同步作者进度；旧 submit 附带的本地状态仍不代表玩法结果已被接受。解释器确定性检查规则前提；事件是否有叙事依据由 ALICE 与 KEI 判断，不能保证模型完全遵守事实。

在代码中新增内置玩法：更新 `src/lib/game/plugins/catalog.json`，添加 `src/lib/ai/skills/<id>.md` 的 Part A/B/C，然后运行 `node scripts/build-gameplay-guides.mjs`。`npm run dev` / `npm run build` 会自动生成 `builtin-guides.json`。客户端只加载目录元数据，运行指南不依赖服务端路径拼接。

## 玩家创作与分享流程

1. 从创建界面的自定义插件卡片导出，或在已有世界的“世界状态 → 插件与模组说明”中展开插件并导出 JSON。完整创作清单可能包含尚未发现的设定，查看入口会提示。
2. 用文本编辑器修改指南、资源、规则或 HUD。独立玩法使用新的 `id`。迭代同一玩法时保留 `id`，更新 `release`，方便从并列选项中辨认。
3. 将文件拖回创建界面，选择它创建新的世界。需要模型辅助时再按“检查玩法设计”调用 UZQ。
4. 保留原始 JSON、修改后的版本和使用说明，再将文件交给其他玩家导入。世界定义与存档也会携带实际采用的清单，原作者后续修改不会重写旧世界。

分享时交付 JSON 文件。已有世界的升级使用独立的模组更新入口。 [项目许可证](../../LICENSE)

## 写操作与界面模组

`ui` 结构为 `{ "html": "...作者网页...", "reading": "replace", "initialState": {}, "priority": 0 }`。`replace` 接管主阅读舞台；`inherit` 在保留原阅读层时展示一个局部操作区。现有自由输入、档案和世界线保留。可以安装多套舞台，按可选 `ui.priority` 选择当前符合 `activation` 的一个舞台（整数 −1000 至 1000）。未填写时，有 activation 的临时舞台为 1，常驻阅读为 0；同级按安装顺序显示第一套并提示。没有 `ui` 的旧插件照常运行。启动失败会回落到其他可用舞台，或恢复默认阅读。

不需要逐个注册按钮、阶段或玩法类型。作者的 JavaScript 可以组织自己的逻辑、状态与界面。宿主注入 `window.Eidos`：

```js
Eidos.onContext(context => {
  // context.state 是当前世界/分支的本模组 JSON 状态。
  // context.reading 只提供已揭示正文；loading/typing/paused 控制阅读节奏。
  render(context);
});
Eidos.setState({ inspected: ['clock'] }); // 本地操作，不发模型请求
Eidos.submit('针对证人第二句证词出示巡检卡', { inspected: ['clock'], pressed: true });
Eidos.advance(); // 补全当前打字或继续读下一段；不请求新正文
Eidos.release({ inspected: ['clock'], completed: true }); // 保存状态并归还本节点舞台
```

`submit(action, nextState?)` 将普通行动交给已有 ALICE/KEI 管线，可同时附带本地模组状态；模型忙时重复提交会被拒绝。本地状态写入不表示模型已接受相应世界事实，这个旧接口没有提交回执。需要让本地玩法结论成为正式事实时，请使用下方 gameplay.commit；旧接口仍适合将尚待判断的行动交给模型。模型依然可能拒绝不符合当前世界的行动，界面应允许继续调查与自由输入，不把固定案例结果强加到不相容的世界。

上下文包括：`plugin.id/name/data`、`state`、本插件的 `settings`、`world.id/name/playerName/sceneId/sceneName`、`reading.segments/index/displayedText/complete/loading/error/typing/paused`、`surface.active`、`actions`、已发现的 `clues`、`inventory` 和现场 `characters`。`scope` 表示世界、周目、节点和场景，每次消息都会验证。节点推进或回溯会发送新的 context，作者应从该分支 state 重新绘制；同一世界与周目内不保证网页重启。界面不会自动取得未读剧情或世界秘密。作者自己写入 `data` 的内部答案依然在创作文件里，展示时须自行区分公开证据与答案。

键盘：`context.keyboardShortcuts` 提供玩家保存的 `advance/previous/focusInput/status/worldline/gallery` 单键绑定，空字符串表示禁用。默认 Z/X/C/A/S/D；玩家可在设置 → 快捷键修改，保存后实时刷新，不进入剧情状态或模型提示词。SDK 将非确认键交给宿主，阻止这些键再被地图当成 WASD 移动。作者用 `Eidos.keyboard.matches(event, 'advance')` 判断当前确认键（也支持回车/空格），然后自行决定交互或 `Eidos.advance()`；不要写死 Z。方向键可继续用于地图。IME、重复确认、修饰键、输入框/可编辑区域/对话框不触发。暂停舞台与旧分支不能通过快捷键操作宿主。

视觉主题：`context.theme` 只包含当前 `mode`（light / dark）、`background/surface/ink/accent`、`fontSans/fontMono` 与 `reducedMotion`。SDK 在回调前将这些值同步到 iframe 根元素的 `--eidos-paper`、`--eidos-surface`、`--eidos-ink`、`--eidos-accent`、`--font-geist-sans`、`--font-geist-mono`，并设置 `data-theme`、`data-motion` 和 `color-scheme`。建议界面使用这些变量，边框和弱文字用 `color-mix` 从纸色与墨色派生，避免独立硬编码配色。主题变化只刷新上下文，不重建舞台、不提交游戏状态；主题值不属于作者存档或模型提示词。现有自定风格包可逐步迁移，SDK 不覆盖作者的选择器。

```css
body { background: var(--eidos-paper, #fafafa); color: var(--eidos-ink, #191919); font-family: var(--font-geist-sans, sans-serif); }
button { border: 1px solid color-mix(in srgb, var(--eidos-ink) 18%, var(--eidos-paper)); border-radius: 3px; }
button:focus-visible { outline: 2px solid var(--eidos-accent, #9e0000); }
```

模组 JSON 状态随存档、世界线快照与回溯保存；旧记录缺少状态时使用声明初值。状态只作用于本模组，不直接改写核心世界。`ui` 全部排除在 ALICE/KEI/UZQ 与创建模型上下文之外，改界面不会破坏稳定提示词前缀。

示例模组的源码和可导入包位于 [`mods`](../mods/README.md)。编辑包目录的 `manifest.json`、`index.html` 和局部 `logic.js` 后，在 `eidos` 目录运行 `npm run pack:mods`，生成 `mods/dist/*.eidos-plugin.json`。分享包已内联局部脚本，接收者可直接导入。已创建的世界保留原包，直到玩家主动更新。


## 自由行动与按钮共享规则（2026-10-16）

规则可选增加 `effects.state` 和 `effects.facts`。前者更新作者状态，后者更新已确认的事实视图；两者内部字段由作者决定，不要求按游戏类型分表。示例需在 `ui.initialState` 中先声明 `foundClues: []`：

```json
{
  "id": "discover-wick",
  "description": "检查灯芯，发现异色纤维",
  "effects": {
    "state": [{ "op": "add", "path": "/foundClues/-", "value": "wick" }],
    "facts": [{ "op": "add", "path": "/wick", "value": "灯芯夹着异色纤维" }]
  }
}
```

按钮调用 `await Eidos.gameplay.perform('discover-wick', { narrate: false })`，取得回执后再展示成功。该接口可选 `id/expectedRevision/narrate`，沿用 commit 的重复与版本保护。自由输入由模型提议同一个 pluginEvent；JSON、流式响应和预生成均在接受正文时应用同一份效果，不要求额外模型请求。一次性规则不重复发现或扣资源，回溯恢复当时案卷。没有 UI 的插件也可用 effects 维护本地作者状态。

支持 JSON Pointer 路径和 `add/replace/remove/test/copy/move` 操作；copy/move 用 `from` 指向来源，不能读取宿主保留状态或把对象移入自身。父对象或数组须已存在，`add` 支持数组尾部 `-`。每个 state/facts 列表最多 128 项，路径最多 32 层，不能修改 `_eidos` 开头的宿主字段、其他插件或原型字段。`test` 失败、路径错误与其他规则/资源检查失败都会拒绝整轮，不留下部分进度。入场规则可在同一事件中启用自己的舞台并初始化状态。它们是作者写在清单中的固定效果，模型只提供 pluginId/ruleId，不能提供任意补丁。

需要运行自定义算法或动态计算结果时继续使用 gameplay.commit。作者不必把所有逻辑改成规则。自由语言是否应该触发某条规则仍需要模型判断，action/review 指南应说明触发依据；离线测试只能验证接受后的同步机制。

## 舞台交接

临时舞台接管后，已经启动的阅读器保留 iframe，收到 `surface.active:false` 与 `reading.paused:true`；宿主拒绝其后台状态修改、推进、文件和模型请求。材料读取完成后也会再检查舞台是否仍有效。临时舞台 `release()` 归还当前节点的舞台；声明的退场规则则修改 activation 标记，按实际剧情状态归还。回溯会重新按该节点的条件选择舞台。作者应从新 context 绘制，而非把隐藏网页当成正在游玩的场面。

同级舞台冲突会提示，作者可自行用 activation 或 priority 安排顺序；没有新增全局切换按钮。桌面辅助窗在暂停时关闭，工作区保存的舞台仍可作为嵌入纸窗恢复。

## 内容、机制与表现分别维护

单文件分享格式保持不变，作者源码可选用 `pack.json`：

```json
{ "content": "cases/harbor-testimony.json", "presentation": "index.html" }
```

`manifest.json` 放通用机制，内容文件可覆盖 `id/name/description/tags/data/activation`，追加三阶段 prompts 和 rules，合并 `ui.initialState`。内容不能替换界面代码或格式版本。表现 HTML 可引用包内 logic.js，打包时内联；打包器不执行作者脚本。路径与符号链接都必须留在选定模组目录。

```sh
node scripts/pack-mods.mjs cross-examination
node scripts/pack-mods.mjs cross-examination --content cases/station-clock.json
node scripts/pack-mods.mjs cross-examination --content cases/harbor-hearing.json
```

可用 `--presentation` 选另一份包内 HTML。质询示例的雾港案与车站案共用实际玩法逻辑和同一界面；“雾港质询 · 剧情入场”变体可与连续小说一起安装，通过 enter-hearing/leave-hearing 在阅读与质询间交接。生成的文件仍可直接拖入创建界面。原有不带 pack.json 的包继续按 manifest/index.html 打包。

## 正式玩法结果与正文补写（2026-10-15）

纯显示选择、排版、窗口位置继续使用 `setState`。证词被推翻、找到证物或作出分支决定等本地确定结果，先提交，再根据回执更新界面：

```js
const receipt = await Eidos.gameplay.commit({
  id: operationId, // 一个新决定使用一个新 ID；不确定是否收到回执时沿用原 ID
  expectedRevision: context.state._eidosGameplay?.revision ?? 0,
  summary: '第一句证词被巡检卡推翻。',
  state: { ...context.state, currentIndex: 1, resolved: ['line-1'] },
  facts: { resolved: ['line-1'], currentIndex: 1, contradiction: '停电前巡检卡已回收' },
  events: [], // 可选：本插件已声明的 pluginId/ruleId，宿主核验前提和资源
  narrate: true // 默认 true：正文待补写；false：本地结果不需要自动补写
});
// commit 不调用模型；不要在 await 前显示“已成功”或推进关卡。
if (receipt.persistence === 'saved') await Eidos.gameplay.narrate(receipt.id);
```

`id` 和 `expectedRevision` 可省略，由 SDK 生成并读取当前版本；若要在丢失回执后可靠重试，作者应自行保留原请求的 ID 与版本。`state` 是整个作者状态的替换值，`facts` 是当前事实视图的替换值，需包含接下来叙事所需的累计事实；两者内部格式由作者决定。`summary` 表达这一次已发生的结果。只有显式 `facts` 和最近正式结果进入模型，HTML、选中项、工作目录全文仍留在本地；`data` 仍是作者设定资料，不能据此假定隐藏答案对模型保密。读者知识与角色知识需要作者在 facts 中明确区分。

宿主检查当前世界/分支、插件启用、版本、事件前提和资源。确认后原子更新作者进度、事实、声明的资源/标记，并创建独立世界线节点。相同当前结果 ID 返回原回执，不重复结算；旧版本拒绝。作者自己的算法由作者负责，宿主不证明任意 JavaScript 判定正确。`_eidosGameplay` 是宿主保留账本，`setState` 不能伪造或擦除它。

回执包含 `id/revision/summary/createdAt/narration` 与 `persistence`。`narration` 为 `pending`（已确认、正文待完成）、`complete`（正文已接受）或 `none`（作者没有要求正文）。`persistence:'pending'` 表示本地决定已接受但节点写入失败；保留结果并先使用页面保存重试，或重发同 ID 提交，只重试写入。保存恢复前拒绝后续新操作，避免覆盖待保存结果。

`gameplay.narrate(id)` 只请求当前最近结果的现场表现，经现有 ALICE 通道调用；返回的 `queued` 只表示请求是否安排，不表示正文已完成。作者通过后续 context 的账本与 reading 查看接受状态。生成失败、取消可重试同一结果；不重复扣资源、触发时间事件、刷新天气、增加场景熟悉度或激活旧 KEI 意见。正文成功会另存零效果节点，保留原决定节点。角色可有情绪与立场，程序不会接受补写中的再次结算字段，但仍需实机验证正文是否尊重事实。只有回溯才撤销已经确认的决定。

旧 `submit/narrate/setState` 保持原语义，不会自动将历史模组升级为正式玩法。当前逐句质询、焦点辩论、秘密审判的关键结果已迁移；其他模组作者可按实际需要采用，不强制每个动作生成正文。

### 连续小说的明确选择与上下文

正文输出可带 `narrativeChoices: [{"id":"本幕稳定ID","label":"具体选项"}]`。接受后选项附着于最后一段，连续小说读到这里才显示并停止自动续写。提交带 `choiceId`，幕间沿用 `narrativeFrame.actor`；自由输入保留，旧正文关键抉择标记只作回退。无需每轮输出选项，也无需章节状态机。

行动上下文保留最近十次行动记录，并在最近两条中附带实际已接受正文；已知窗口不足时仍按既有预算裁剪整条旧记录。角色卡 description/personality/scenario 作为资料，system_prompt 作为行为前置，post_history_instructions 在历史之后，mes_example 作为低优先级语气示例，first_mes 只在入场使用。原件字节与来源保留；这不等于执行所有酒馆扩展脚本。当前有活动玩法指南或原卡时，默认世界的单轮新事实配额、段落交替和悲剧风格不会强制覆盖该玩法。

## 剧情启用与舞台释放

`activation` 是可选的顶层字段，例如：

```json
"activation": { "requires": { "hearing": true }, "scenes": ["courtroom"] }
```

`requires` 复用本插件状态（完整键为 `gameplay.<id>.hearing`），缺失为 false；`scenes` 是当前场景 ID 的任选列表。所有条件同时成立才启用。两项都可省略，旧包没有条件时常驻；无需采用某种章节或任务格式。

条件不成立时，不挂载作者网页，也不显示该插件的 HUD / 玩法提示。ALICE 与 KEI 的动态上下文标记休眠/启用；休眠时省略完整指南、案件 data 和常规规则，只保留能使启用条件成立的最小入场规则，因此能够通过入场规则把 `hearing:false` 改为 true，通过退场规则改回 false。启用条件是玩法/显示节奏，不替代规则自己的前提，也不授予额外权限。多个已启用插件可以共同提供机制指南；同级界面只能显示第一套并提示冲突。互斥玩法请声明互斥的剧情条件。release 只归还显示，不等于禁用机制。

`Eidos.release(nextState?)` 卸载本节点、场景中的舞台，可原子保存作者状态并返回常驻阅读模组或默认阅读。节点/场景变化会重新评估条件。它不修改世界标记、不请求模型，刷新后不保证临时释放仍生效。需要持续到下一轮或随回溯恢复的退场，请用声明的剧情标记；需要作者代码决定完成时机，可保存完成状态，并在后续 `onContext` 中按自己的逻辑继续释放。旧舞台的消息无法操作新场景。

## 作者设置

顶层 `settings` 声明直接出现在设置分类中，当前世界与本机插件库均可提供设置页。支持四种常用控件，不要求建立新的设置脚本或逐个注册按钮：

```json
"settings": [
  { "id": "hints", "label": "显示质询提示", "type": "boolean", "default": true },
  { "id": "speed", "label": "阅读速度", "type": "number", "default": 2, "min": 1, "max": 4 },
  { "id": "layout", "label": "排版", "type": "select", "default": "宽松", "options": ["宽松", "紧凑"] },
  { "id": "title", "label": "自定标题", "type": "string", "default": "旅程" }
]
```

每项可加 `description`。设置草稿统一保存或放弃；SDK 在 `context.settings` 中得到本插件的已保存值，实时刷新。玩家偏好保存在本机 `GameSettings.modPreferences`，与剧情 `context.state` 分离，回溯不会更改阅读偏好；卸载插件也保留其偏好。未保存/无效值使用声明默认值，数字按作者区间收敛。设置声明和值都不进入模型上下文。多窗口保存只合并各自编辑的字段。

离线预览补充：`npm run dev:mods` 后，选择“分页设置 / 作者偏好”、“36 地点图册”或“剧情启用 / 释放”。后者用确定性的真实规则解释器模拟开庭/休庭，全部请求为本地固定响应。


## 叙事请求与读者镜头

`Eidos.submit(action, state?)` 继续代表主角自由行动。需要推进故事、旁观剧情或为其他角色选择时，可用 `Eidos.narrate(request, state?)`，仍复用行动的生成、取消、排队、规则验证和世界线流程。示例：

```js
Eidos.narrate({ kind: 'continue' }, state);
Eidos.narrate({ kind: 'choice', frame: { kind: 'cutaway', actor: '白槿', location: '空车厢', timeLabel: '与此同时' }, choice: '藏起信件' }, state);
Eidos.narrate({ kind: 'return' }, state);
```

`kind` 是阅读继续、明确选择或回到主角；`frame` 可选，`choice` 请求须有具体选项，旁观选择还须指定 actor。镜头的 `location/timeLabel` 是呈现标签，非地图传送和世界时钟修改。模型输出可选 `narrativeFrame`（在 segments 前），宿主把同一信息作为 `reading.segments[].view` 交给舞台并保存在段落中；旧包没有这些字段仍可正常使用。

旁观轮保留世界线正文、标记过的摘要与世界影响，清除自动写入主角的知识、地点、时间、背包、关系和人格观察等字段。声明式 pluginEvents 仍按原规则解释器验证。旧宿主没有 narrate 时，新连续小说包保留普通阅读与主角行动回退，不执行无法正确归属的旁观选择。

本体的 Meta 接口与提示只陈述实际能力、材料、操作结果和资源边界；Meta 引导、剧情解释、谜题与演出由插件自己提供。SDK 已开放下述工作区、辅助舞台和材料通路；不能用 submit 文本宣称已经访问未递交的真实系统资源。

### 原生文字演出 0.5.0

声明 `ui.presentation: "native-text"` 的插件可在原生 `segments[].textEffects` 中使用持久演出，不需要独立舞台。`afterSegments` 省略或 0 表示本段首次播放结束，-1 表示首次显示即完成，正整数表示后面第 n 个新段开始，可跨行动等待；`delayMs` 在条件满足后计时。`progress: "typing"` 支持随揭字遮挡、划除与乱码。新增 `strike/drift/dim`，其余种类继续沿用原协议。0.3 及更早版本保留原有短语触发时机。

主播放游标统一结算一次性结果，重播、存读档和阅读回看不重复暴露原文或触发短动画。遮挡保持可选可复制，复制结果为实际乱码。正文、姓名、推荐行动、行动记录、世界线、阅读搜索和语音共用呈现版本；原始内容继续保存在现有 CAS 中。

`historyRequest` 的 `view: "source"/"display"/"both"` 可查询原文与当前显示，返回 `presentationRevision`、段序号与执行回执；原文查询不代表角色知情。长内容按页读取，段落 `partial:true` 表示节选。历史已读改写在当前 `textEffects` 中指定 `nodeId`、`segment` 及 `expectedText/expectedRevision`，效果只归属当前经历链；无效、未读或过期目标整批拒绝。详细格式见 [Meta 插件说明](../mods/palimpsest-stage/README.md)。

0.4.1 补齐长遮罩断行和历史定位引导：模型可先按步数、关键词或 `target:"当前节点"` 查阅，再直接使用 `segments[].editTarget`；`expectedRevision` 与 `expectedText` 可择一。原生演出在没有世界线摘要时也提供工具说明。`dim` 增加 `brightness`（0–1，1 为正常）和 `transitionMs`（0–8000 毫秒，默认 600）：指定亮度后跨段、跨行动维持，直到新命令覆盖，随分支和存档恢复；不带亮度的旧式 `dim` 仍为短脉冲。

0.5.0 为 `view:"both"` 的可编辑段增加 `editRef`；直接复制到正常 `textEffects`，配合 `kind/quote/value` 即可，旧定位格式继续兼容。`{kind:"restore",effectId}` 撤销一个真实演出，保留其他组合与分支隔离，也可取消待执行事件。历史 `presentation` 回执增加 `cancelled` 状态、目标与有界 `beforeText/afterText`；每页 8 项，使用 `presentationOffset` 和 `presentationNextOffset` 翻页。源文和事件仍由已有 CAS/节点保存，对照按需重建。


## 文件、材料与辅助舞台

以下接口可直接在 `ui.html` 使用，不需要注册一种新的游戏类型。所有异步方法返回 Promise，成功返回真实操作回执，失败抛出 Error。文件、窗口和分析结果的剧情含义由作者决定，宿主不会给玩家安排 Meta 引导或新建一栏全局按钮。

```js
const caps = Eidos.capabilities();
await Eidos.files.write('远岸.txt', '第一封信', { expectedVersion: null });
const original = await Eidos.files.read('远岸.txt');
await Eidos.files.write('远岸.txt', '修订的信', { expectedVersion: original.id });
await Eidos.stages.open({
  id: 'letter', title: '远岸的信', mode: 'embedded',
  html: '<p>这里可写自己的 HTML、CSS 和调用 Eidos SDK 的脚本。</p>',
  x: 24, y: 40, width: 360, height: 320
});
const unsubscribe = Eidos.onEvent(event => {
  if (event.type === 'file_written') console.info(event.path, event.version);
});
```

同一模组的主舞台与辅助舞台使用同一工作区；`context.surface` 为 `{kind:'main'}` 或 `{kind:'auxiliary',stageId}`。舞台 HTML 运行在隔离 iframe 中，使用同一套 SDK，拿不到宿主密钥。`stages.update({id,...})` 更新内容或布局，`stages.close(id)` 关闭，`stages.list()` 返回实际保存的布局（不返回 HTML）。网页纸窗可拖标题栏；窄屏显示方式由作者内容与宿主布局适配。尺寸、坐标是呈现状态，不自动改变地图和人物位置。

| 接口 | 返回 / 说明 |
| --- | --- |
| `files.list()` | 当前作者文件的相对路径、资源 ID、名称、MIME、字节数 |
| `files.read(path)` | 上述信息和原文 `text` 或原件 `base64` |
| `files.write(path,text,{expectedVersion?,mimeType?})` | 新内容引用；`expectedVersion:null` 表示仅创建，资源 ID 表示只允许覆盖该版本 |
| `files.remove(path,expectedVersion?)` | 删除当前文件引用，已有历史原件仍可被回溯读取 |
| `files.export(path)` | 打开“导出到…”选择文件位置；取消返回 `cancelled` 且不记录导出事件。成功沿用兼容回执 `download_requested`；不支持选择位置的浏览器需玩家确认使用下载设置 |
| `files.publish(path,key)` / `files.receive(key,path,expectedVersion?)` | 明确寄出、收取同一作者 / 世界 / 周目中的跨分支材料；返回版本与来源 |
| `resources.import(path,file,expectedVersion?)` | 由作者的文件选择或拖动事件递交真实 File；保存原件 |
| `resources.inspect(path,task,{offset?,length?})` | 独立 UZQ 材料分析，返回 `{content,resourceId,task,cached}` |
| `resources.cancel()` | 取消本模组当前材料任务，不写入成功缓存 |
| `files.checkout(path)` / `files.reload(path)` | 桌面文本工作目录写出 / 手动重新载入，返回原文引用与实际目录 |

文件路径限作者工作区内的相对路径，支持子目录与中文名称。普通 JSON 作者状态与宿主工作区索引不设合计字数/容量上限；文件材料原件独立保存，材料工具当前单件最多 4 MiB（区别于插件包导入）。不要在 setState 中塞入整份媒体或 HTML 副本；工作区使用保留字段 `_eidosWorkspace`，作者 setState 不会覆盖它。插件包不受材料工具单件大小限制；存储失败仍会明确提示，不静默截断或丢弃内容。

原件按不可变内容版本保存，引用与舞台随存档和世界线恢复；完整世界备份与普通游玩记录包含引用到的原件。跨分支邮袋通过作者显式 publish 保留，不随节点回溯撤销；完整世界备份还保存邮袋，恢复时隔离到新周目。只发送普通文本或只分享插件 JSON，不能代替玩家材料备份。分支切换后在途操作不能修改旧分支；异步文件写入也会保留同时发生的窗口位置更新。

`onEvent` 按事件 ID 去重，提供最近 32 个已提交事件：文件写入、删除、导出请求、寄出、收到、桌面写出/重新载入，舞台打开/更新/关闭，以及材料分析成功。事件带 `{id,type,createdAt,path?,stageId?,version?}`。订阅新舞台时可能收到保存过的事件；需要一次性的剧情后果，请把已结算事件 ID 或游戏状态保存在作者 state 中。拖动不调用 AI，只有作者明确 `submit/narrate` 时才交给正文。作者应提交已经结算的事实，而非让模型重新判定同一个局部谜题。

### 桌面能力

`caps.nativeWindows/nativeDirectory` 为 true 时，`stages.open({...mode:'native'})` 打开真正的 Tauri 辅助窗口。网页使用 embedded 模式；直接请求不存在的桌面能力会报错。存档恢复后的 native 舞台先显示为宿主内纸窗，需要作者或玩家明确重新打开独立窗口。关闭和切换场景会清理当前辅助窗口。

真实文件仅落在应用自己的 `mod-workspaces/<工作区标识>/`，桥接由主窗口发起，禁止任意路径与符号链接逃逸。`checkout` 对照上次确认过的内容，遇到外部编辑冲突返回错误；`reload` 明确接受外部当前文本。回溯只恢复虚拟引用，不自动覆盖磁盘新文件。当前没有后台文件监听、真实桌面窗口位置/焦点事件或任意系统目录权限；不要向玩家宣称有这些能力。

### 材料处理与模型成本

`inspect` 只处理当前作者主动递交的材料。文本默认取从 offset 开始的 24000 字符，可指定 length（最多 48000）；原件不截短，片段任务会标明范围与总长。图片通过 OpenAI 兼容、Anthropic 或 Gemini 的真实内容块发送；PDF 使用 Anthropic/Gemini 文档内容块。默认 DeepSeek 通路没有图片输入。模型本身是否接受媒体仍取决于玩家所配模型，协议支持不保证任意模型都支持。音频目前仅保存原件，没有转写。

分析采用独立 UZQ 配置，120 秒上限、最多 4 个并发任务、不自动重复付费请求。成功结果按材料版本、问题、片段范围与模型配置缓存（不保存密钥），保留最近 4 项。失败、取消和超时不写成功缓存；已返回的用量计入费用，旧分支迟到结果不写进新分支。相同原件/问题可直接复用，改内容或配置则重新处理。图片/PDF 的真实模型结果留给配置模型的玩家验收。

文件原文、舞台 HTML、阅读设置和整个 `gameplayModState` 均排除在主叙事请求的模型快照之外；本地存档仍完整保存它们。声明式规则和作者 prompts 正常进入模型上下文。只有作者明确递交的分析摘要/玩法事实进入 ALICE，这可以避免工作区内容破坏每轮稳定前缀或吞占上下文。

内容块协议依据：[OpenAI Chat Completions](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create)、[Anthropic 图片](https://platform.claude.com/docs/en/build-with-claude/vision)、[Anthropic PDF](https://platform.claude.com/docs/en/build-with-claude/pdf-support)、[Gemini 图片](https://ai.google.dev/gemini-api/docs/image-understanding)、[Gemini PDF](https://ai.google.dev/gemini-api/docs/document-processing)。

### 独立材料 HTTP 接口

通常使用 SDK，无需作者直接调用 `POST /api/game/mod-resource`。接口沿用本地同源请求与 JSON 校验，不向 iframe 暴露模型密钥。请求为 `{resource:{name,mimeType,text?|base64?},task,_settings?}`，仅允许 UZQ 配置与思考预留设置；总 JSON 不超过 5.8 MB。成功返回 `{content,usage}`；失败返回 `{error,usage?}`。400 表示字段、大小或材料类型无效，403 表示跨源请求，413 表示请求体超限，429 表示并发已满，499 表示请求取消，502 表示模型能力不支持、上游失败或超时。这里是运行中的本地应用接口，并不提供公网账户鉴权服务。

## 作者调试与完整上下文预算

进入「设置 → 作者工具」可查看当前世界、周目、世界线和沙箱的最新行动：原卡实际选入/省略的来源与原因、选入原文与条件求值结果、变量和规则提案、接受或拒绝原因、预算组成及供应商返回的缓存用量。旧版 V1 原卡根节点也保留真实来源指针。页面保留会话内最近 8 条记录，展示最新一轮，上一轮用于比较固定前缀；刷新清空。展开可能看到隐藏设定，导出的 JSON 包含本轮完整诊断。查看或导出不会调用模型，记录不进入游戏存档和后续提示词。

预算检查发生在统一 AI 请求入口，涵盖引擎协议、世界、原卡、声明式模组规则、状态、历史、当前输入与生成预留。它按 UTF-8 文本估算，不是模型 tokenizer 的精确计数；图片/PDF 用量尚未估算。缓存命中的输入仍占上下文，固定前缀一致也不保证供应商实际命中。无法识别自定义模型上限时显示「上限未知」。可在「设置 → AI 接入 → 上下文窗口覆盖（高级）」为 ALICE、KEI、UZQ 填实际部署窗口，0 保持自动识别；对应配置为 `aliceContextWindowTokens`、`keiContextWindowTokens`、`uzqContextWindowTokens`。

行动请求在已知窗口下超限时，先整条省略最早的临时最近行动记录，不修改存档历史、权威状态和原卡。额外思考预留可缩减到仍容纳正文设置额度；必需输入与正文额度仍放不下时，付费调用前返回明确错误与预算诊断。卡变量使条件内容扩张时，接受前还检查完整请求中的原卡增量（扣除可省略历史）；明显无法容纳的提案和模组规则一起拒绝。该估算不替代下一轮真实状态下的完整检查，也不要求作者采用新的玩法格式。


## 篇章节奏与读者记忆（2026-10-16）

连续小说可让 ALICE 返回可选 `narrativeBeat`，同一章沿用稳定 ID。它不要求世界预先列出章节，也不要求其他类型模组使用：

```json
{
  "narrativeBeat": {
    "chapter": { "id": "carriage", "title": "第二章 · 没有寄件人的信" },
    "recap": "白槿在空车厢决定暂留信件，旅客尚未知情。",
    "threads": ["她会怎样向旅客告别？"],
    "boundary": "chapter"
  }
}
```

`chapter` 可省略；填写时 id/title 都是 1–160 字符。`recap` 最多 2000 字符，承接此前重要承诺和已选后果；`threads` 最多 16 项、每项 240 字符，空数组可清空已解决的问题。只有自然章末填 `boundary:chapter`，本篇收束填 `ending`，普通正文省略 boundary。它们只控制阅读停顿，不结束周目、锁住自由行动或让模型提前决定玩家的选择。无效可选元数据会被忽略，正文仍可阅读。

JSON、SSE 和预生成采用后共同保存 narrativeProgress；取消或拒绝不会提前改变它。下一次请求的动态上下文包含已接受的篇章衔接，固定前缀不会因当前章节改变。摘要属于读者记忆，幕间不能据此给主角增加知识、位置或物品；角色选择仍用 narrativeFrame.actor 和 narrativeChoices。

作者界面从当前已揭示段落的 `beat` 读取元数据。连续小说在章末停止自动生成，原继续按钮变为“进入下一章”；结尾显示“续写尾声”，需要读者明确继续。章节名随前文记录保留。暂停/退居后台/空白阅读流不会安排自动续写。回溯按节点恢复章节和包版本，早期尚无阅读记录的节点不会吸收未来正文。模组仍保留最近 24 页、合计约 2 万字符的本地回读窗口，长久正文由世界线节点保存；篇章摘要帮助续写衔接，不能保证模型任意长度都绝不遗忘。

[《雾灯之后》三章样本](../mods/dist/night-voyage-short.eidos-plugin.json) 共用连续小说的实际界面，作者素材位于 `mods/continuous-novel/stories/fog-letter.json`。它提供相处、异地角色决定和黎明收束的素材，玩家仍可偏离作者路线。短篇离线演练使用固定响应，只验证运行流程；真实情绪节奏、角色动机与选择分量仍需实际模型游玩。

## 更新正在游玩的模组

在“世界状态 → 插件与模组说明”展开对应模组，拖入或选择同 ID 新版 JSON。宿主先预演并显示版本及迁移步数；点击“应用此更新”后，只更新当前游玩分支，不发模型请求、不重跑玩法事件。取消、缺少迁移或不兼容时保留原状态。库导入继续只更新创作库，不会自动更新运行中的世界。

作者可选增加：

```json
{
  "release": "2.0",
  "stateVersion": 2,
  "migrations": [{
    "from": 1,
    "to": 2,
    "patches": [
      { "op": "add", "path": "/state/investigation", "value": {} },
      { "op": "move", "from": "/state/found", "path": "/state/investigation/found" },
      { "op": "move", "from": "/facts/evidence", "path": "/facts/confirmed" }
    ]
  }]
}
```

`release` 是最多 80 字符的作者版本标签；`stateVersion` 是正整数，旧包默认 1，与清单 `version:1/2` 的协议版本不同。仅改界面或文案时可以不改状态版本，当前进度原样沿用。改变结构时，由新版包提供从旧版出发的迁移链；同一 from 只能有一个向更大版本的步骤，缺步或降级明确拒绝。不自动合并新版 initialState 到已有进度，新增必需字段应由迁移补入。

迁移补丁采用相同的 JSON Pointer / JSON Patch，作用于该插件的公开 `{state,facts,flags,resources}`：state 是作者状态，facts 是已确认的当前事实，flags/resources 的键为本插件局部 ID。支持 test 先检查旧形状、move 重命名、copy 复制后独立修改。新资源和删除资源需与新版声明相容，不截断玩家数值。一次性记录在 flags 的 `done:<规则ID>`，改规则 ID 时可显式迁移该记录，避免重复结算。

迁移看不到 `_eidos` 宿主字段，不能创建它们；宿主保留文件、纸窗、回执 ID 与玩法结算版本，仅将明确迁移的 facts 放回账本。没有正式结果时不能凭空创造 facts。补丁或最终验证失败时整批拒绝，不执行任意作者 JavaScript。升级是程序维护：在当前节点原地保存包引用与迁移后的进度，不新增行动、不增加步数，也不复制或改写正文。CAS、树与索引全部写入成功后才接受更新；本地写入失败时恢复原检查点并保留预览，可重新应用，不占用剧情行动的保存重试。

旧包按内容键存储，节点引用相应包集合；世界定义和独立保存的世界线目录携带版本历史。较早的手动存档重新加载时合并目录，仍选择该存档原来的节点和包；版本变化本身不会获得独立的剧情节点。回溯同步恢复界面、规则与进度。存档和世界线导出需要保留这份版本历史，清理旧版本会破坏旧节点；多次更新会使导出文件增大。历史包、发行标签与迁移代码不进入模型提示词。玩家升级前可先使用现有保存或导出功能保留完整备份；作者仍需为真实的旧状态样本测试迁移，不依赖初始空状态猜测兼容性。

## 作者正文与离线实验

`Eidos.gameplay.commit({...operation, segments:[{type:'narration',text:'作者原文'},{type:'dialogue',speaker:'白槿',text:'作者对白'}]})` 可同时接受预写正文和该次决定。可选 segments 为 1–128 段，不设人为文本长度上限，支持 narration/dialogue，对话需要说话人。原文空白保留；仅提取内容字段，不接收模型更新命令。省略时沿用原来的 summary 正文。提交前验证，重复提交和保存重试不重复推进。

作者正文、facts、state 与世界线节点一起保存，回溯和导出保留原文。决定摘要仍是 summary，正文可以更完整。原文不自动成为人物知识或引擎物品，明确后果继续走已有事实、规则与资源。随后可调用 `gameplay.narrate(receipt.id)` 请模型描写反应，也可继续自由行动；不必每个作者片段都补写一次。

可在现有作者工具导出现场，用[作者实验室](author-lab.md)离线重放、保存命名检查点、编辑实验状态与重载源码。示例[最后一班邮车](../mods/last-post/README.md)分开维护作者故事、判断和显示，没有引入强制章节／剧本语言。

2026-10-21：取消玩法/全局插件包、创建与升级入口、作者实验室、本机插件库和打包导出的字数与文件容量限制；同步放开携带插件的创建、玩法检查与行动请求体，避免导入成功后被传输上限拦住。JSON 格式、版本、ID、引用、防原型污染等校验保留。


## 主世界操控与文字地图

宿主在已完整展示当前正文时提供 `context.scene`，仅含当前地点的名称与公开描述、人物名字、已知出口与阻挡状态、已发现的本场景线索、现有行动与目标。未读完时为 null，未公开场景与秘密不发送给作者界面。

`Eidos.world.interact(intent, state?)` 复用正常主叙事管线。intent 的 kind 为 talk（targetId 是当前 NPC，可带 text）、inspect（targetId 是已发现线索）、use（itemId 是真实背包物品，可带当前人物/线索 targetId）、travel（targetId 是当前已公开且可通行出口）、action（targetId 是当前行动原文）或 custom（text 是玩家原话）。state 可保存本次行动前的地图位置等作者状态；不直接修改宿主人物、背包、任务或场景。引用过期、物品不存在、通路封闭、重复提交或正文未读完时拒绝，原叙事错误仍由主游戏显示。

示例「文字地图与角色扮演」使用此接口提供可走动的当前地点地图。地图与局部位置保存为作者状态，世界后果仍由主游戏裁决。`scene-map` 模组可通过 `context.sceneMapFiles` 与 `Eidos.world.files.read(path, version)` 读取当前分支已播放的 `scene_map` / `scene_map_*` 文本产物。主叙事的文件目录会提供只读 `maps/<插件ID>/current.json`，地图 JSON 仍通过正常文档产物交付、按段落合并；不能直接覆写布局投影或提前读取候选。[玩法说明](../mods/chinese-room/README.md)。


地图模组可声明 `ui.presentation: "scene-map"`，并使用 `reading: "inherit"`。宿主仅替换中央文字画面，保留原记录、对白、自动阅读与输入等组件。主界面无需在 iframe 内重复添加背包、任务或对话 UI。`Eidos.world.notice(message)` 使用宿主现有通知，失败不会另建一套弹窗。地图内部通过确认键在对话期间调用 `Eidos.advance()`。

## 原生玩法与按需工具（0.3.0）

`ui.presentation` 可为 `native`、`native-text`、`tool` 或 `scene-map`。前三者不自动挂载玩家 iframe；作者 HTML 仅在设置的作者工作台明确打开时运行。`scene-map` 用于以地图操控为核心的玩法，仍只替换中央文字画面。未声明 presentation 的第三方旧包沿用既有行为，不因此次内置插件调整被静默禁用。

`native` 可声明 `ui.actions:[{ruleId,label,segments?}]`，将已有确定性规则接到宿主推荐行动。每个 ruleId 必须存在，标签与规则引用不可重复；segments 是可选作者原文，按原生 StorySegment 校验。前提、资源、一次性条件和状态补丁由同一个规则执行器验证；模型自由输入仍可提出同一 pluginEvents。正文与模型规则共享正式事实、保存失败重试和世界线。不要将正确证物筛成唯一可用选项，也不要将未发现的证据结论放进标签。

`ui.nativeReading:true` 使用已有 segments 的 view/choices/beat 元数据，在原生行动里继续故事或为指定角色选择，按 NarrativeRequest 保持旁观镜头的角色知识边界。原生暂停、章末和选择边界阻止自动续写；只有 auto_continue 明确开启才可能续写调用模型。

内置案件通过 `pack.json` 的 `native` 编译器将作者内容打包成上述标准规则，分享包接收者不需要编译器或 Node。原始作者界面仍随包保存以便调试。

## 介绍类型、图片与本机版本发现

可选 `introduction: { impacts: [], images: [] }` 同时适用于玩法插件与全局插件。`impacts` 可用 `layout`（布局）、`gameplay`（玩法）、`narrative`（文字/叙事）、`appearance`（样式）、`audio`（音频）、`tools`（作者工具）；这是作者声明，界面另显示根据清单可确认的范围。旧插件无需补字段即可导入。

每张图片格式 `{src: "data:image/png;base64,...", alt: "说明"}`，也支持 JPEG/WebP；最多 4 张、每张最多 2 MB。介绍、影响范围和图片由开发者在外部编辑插件文件后随包提供，游戏详情页只读展示，不提供修改作者声明或上传介绍图片的入口。影响范围只是功能说明，不用于选择安装插件中的部分内容；作者声明的偏好设置仍可在游戏内调整。修改后的包通过现有导入或同 ID 更新流程安装，保存和 JSON 导出保留完整介绍。图片和介绍字段不进入模型提示。

版本更新入口同时发现本机库与当前内置指南中的相同 ID 包。发行版可识别时比较数字，未知格式只提示内容不同。发现候选不代表已应用，也不承诺网络上的最新版。兼容性预览、显式应用、迁移、节点包历史及保存失败重试沿用原协议，不能借此替换为其他 ID。

## 篇章叙事

`mods/dist/chapter-narrative.eidos-plugin.json` 是纯叙事指南包。它配合宿主章节引擎，通过 KEI 编排和分支内证据账本承载主线、人物篇、事件、日常与幕间。没有额外面板或固定剧情规则，可与连续阅读插件共用原生正文。首次安装走创建世界的玩法导入；同 ID 升级沿用现有版本更新。详见 `mods/chapter-narrative/README.md`。

纯指南作者包可声明 `pack.json: {"guideOnly":true}`；打包器不再要求 `index.html`。该模式不可同时声明 UI 或呈现文件，其余包的打包行为不变。
