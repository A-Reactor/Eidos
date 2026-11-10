# 全局开发者插件 v1

[English quickstart](modding.en.md#extend-the-application)

入口：世界集合 → 设置 → 全局插件。标题页设置也使用同一入口。安装、启停、偏好和重新加载立即生效。游戏内“模组”仍管理当前档案的世界模组；全局插件继续运行，但在世界集合管理。

「设置与详情」会显示影响范围、作者声明和介绍图片，可以上传/移除并随 JSON 导出。`introduction` 与玩法插件共用协议（见 `gameplay-plugins.md`）；只修改介绍不会重启脚本或移除其钩子。全局脚本的具体逻辑无法仅凭介绍可靠推断，界面会保留应用脚本能力提示，不把作者声明当作权限限制。

## 安装与测试

1. 点击“安装测试插件”，安装的“阅读排版与快捷指令”默认停用。
2. 1.1.0 启用后沿用原版主题和排版，不添加悬浮开关，只有快捷指令生效。
3. 展开“设置与详情”，主动选择强调色或开启紧凑阅读排版；默认跟随主题、不压缩排版。偏好保存在本机，跨世界生效。
4. 在游戏内输入 `/环顾`，提交时实际行动会展开为“仔细观察当前环境，留意可见的人物、物品与出入口。”，其余输入不变。
5. 返回世界集合的设置，停用插件。自选强调色和排版撤下，快捷行动转换同时停止。
6. 导出后可在另一台设备重新导入；包只安装为停用状态，需主动启用。导入同 ID 新版也先停用，保留仍有效的偏好。移除安装不会删除其私有数据。

独立测试包：`mods/global/paper-lab.eidos-global-plugin.json`。预览使用 `npm run dev:game`，访问 `http://127.0.0.1:3020/?case=global-plugins&theme=light`，或手机预览 `/mobile.html?case=global-plugins&theme=light`；所有模型请求为固定响应，存储与正式游戏隔离。

## 插件包

这是应用级 JavaScript 扩展，拥有与应用相同的浏览器权限，Tauri 中还受已配置的原生能力约束。它与世界模组的 iframe 协议用途不同。仅启用已检查代码的来源；应用不会自动执行导入包。CSS 也可改变所有页面，不会加入模型提示词。

```json
{
  "format": "eidos-global-plugin",
  "version": 1,
  "id": "my-reader",
  "name": "我的阅读界面",
  "release": "1.0.0",
  "description": "全局阅读界面与输入转换",
  "author": "作者",
  "css": ".eidos-record-scroll [data-reading-text] { line-height: 1.8; }",
  "script": "api.actions.beforeSubmit(input => input === '/看' ? '观察四周' : input);"
}
```

ID 以小写字母开头，允许小写字母、数字、连字符和下划线，最长 64 字符。导入、保存和导出不设置插件字数、源码大小、文件大小或插件库总容量/数量上限；仍受设备内存和浏览器真实存储配额影响。支持单包、包数组或 `{format:'eidos-global-plugin-library',version:1,plugins:[...]}`。导出保留完整 CSS 和 JavaScript；未进行源码截断。

可选 `settings` 使用现有设置声明：`boolean`、`number`、`string`、`select`，每项声明 `id`、`label`、`type` 和 `default`，可选 `description`、数值 `min/max`、选择 `options`。偏好仅用于本机插件，不随剧情回溯。

## JavaScript 入口与 SDK

`script` 是函数体，启动时同步执行，参数为 `api`。可以返回清理函数；不要返回 Promise。异步任务自行在内部启动，并监听 `api.signal`，它在停用、更新、偏好热重载、失败或外壳卸载时中止。浏览器 API 可以直接使用；通过 SDK 注册的资源由宿主管理。

| API | 用途 |
| --- | --- |
| `api.version` | SDK 版本，当前为 1 |
| `api.plugin` / `api.preferences` | 当前包定义和已校验的偏好快照 |
| `api.game.getState()` | 真实游戏 store，包括公开方法；无世界时 `currentWorld` 为 null |
| `api.game.setState(partialOrUpdater)` | 应用状态读写，可扩展核心逻辑；停用后不可再用旧接口写入 |
| `api.game.subscribe((next, previous) => ...)` | 跨页面观察状态；自动注销 |
| `api.actions.beforeSubmit((input, context) => ...)` | 行动提交前同步转换；返回字符串替换，undefined 保留，`{cancel:true}` 接管并取消默认提交 |
| `api.ui.addStyle(css)` | 注入全局 CSS；按安装顺序覆盖；返回可提前撤回的函数 |
| `api.ui.mount(element, target?)` | 挂载新建的 HTMLElement，target 默认 body，也可为 Element／选择器；自动移除 |
| `api.storage.get(key, fallback)` | 读取插件 ID 命名空间内的 JSON 数据 |
| `api.storage.set(key, value)` / `.remove(key)` | 写入／移除私有键，最多 256 KB；键使用与 ID 相同的字符规则 |
| `api.listen(target, type, callback)` | 托管事件监听，自动注销 |
| `api.setTimeout(fn, ms)` / `.setInterval(fn, ms)` | 托管计时器，返回取消函数 |
| `api.onDispose(fn)` | 注册自定义清理，返回提前执行清理的函数 |

行动上下文为 `worldId`、`playthroughId`、`nodeId` 和 `fromMap`。钩子按安装顺序执行，后一个接收前一个变换后的输入。进入普通行动前等待节点保存和阻塞审核，避免排队重入时重复变换；之后沿用原来的子节点匹配、预生成复用、模型请求及结算。钩子抛错时本次不发送模型请求，清理故障插件，原因显示在插件设置。UI／订阅的托管回调出错也会清理该插件，其他插件继续运行。

直接修改游戏状态时请自行遵守节点、存档和世界隔离约束。停用会撤回 SDK 的样式、UI、订阅、计时器与行动钩子；不会撤销已经完成的游戏变化。直接操作宿主 DOM、全局变量或浏览器 API 时，请用 `api.onDispose` 恢复自己改变的部分。

```js
const panel = document.createElement('output');
api.ui.mount(panel);
const render = () => {
  const state = api.game.getState();
  panel.textContent = state.phase + ' · ' + (state.currentWorld?.name ?? '世界集合');
};
render();
api.game.subscribe(render);
api.onDispose(() => { /* 恢复通过 SDK 之外修改的资源 */ });
```

本机插件库损坏时保留原文并阻止覆盖，可“导出原始数据”备份排查。插件自己的 JSON 数据使用独立键，不进入世界导出包和模型上下文；整个应用数据清理会按原有清理范围处理。
