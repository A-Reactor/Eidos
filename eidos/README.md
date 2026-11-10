# Eidos — AI 驱动的世界引擎

Eidos 将玩家行动、世界事实和程序执行结果连接到连贯叙事。可使用内置文字游戏界面，也可通过开发者接入层连接自己的场景、游戏组件、地图、状态和玩法程序。

## 游戏开发者

[开发者接入指南](docs/developer-engine.md) 包含公共接口、程序回执、存档、模型连接和 HTTP 协议。

下面的命令在本 `eidos` 目录运行。Node.js 版本要求见[仓库首页](../README.md#开发者入口)。

```bash
npm ci
npm run demo:engine     # 通用命令与回执
npm run demo:rpg         # 使用独立 SDK 的 RPG 规则、地图、背包和存档示例
npm run demo:engine-game # 无浏览器、无模型的完整 RPG 接入验证
npm run dev:engine-game  # http://127.0.0.1:3031，开发用双场景小游戏
```

示例在 Node 中完成开门、资源结算、地图通路更新、场景移动、物理结果回传及存档恢复，使用离线叙事端口，不需要模型密钥。

- `src/lib/engine`：零运行时依赖的核心、JSON 契约及 HTTP 客户端。
- `sdk`：独立 JavaScript 与 TypeScript 类型构建入口；通用核心及 `@eidos/engine/rpg`。`npm run pack:sdk` 生成可安装到其他项目的本地包。
- `examples/engine`：可修改的世界定义和完整宿主程序。
- `/api/engine/v1/narrate`：使用服务器模型配置的无状态候选生成接口。
- [玩法模组](docs/gameplay-plugins.md)、[全局插件](docs/global-plugins.md)、[作者实验室](docs/author-lab.md)：在现有 Eidos 应用内创作和验证。

## 运行 Eidos 应用

```bash
npm ci
npm run dev
```

打开 [localhost:3000](http://localhost:3000)。开始创建世界或调用 AI 前，在「设置 → AI 接入」选择文字模型。支持云端与本地服务，服务器环境变量参考 [`.env.example`](.env.example)。[AI 接入说明](docs/ai-configuration.md)

图片可从图像资源库上传和绑定到场景或角色。语音使用独立配置，可按需启用。

`npm run dev` 和 `npm start` 默认仅监听 `127.0.0.1`，可继续用 `http://localhost:3000` 打开。浏览器存档和密钥按访问地址隔离，已有用户请沿用原地址。Windows 也可以从仓库根目录运行 `win-setup.bat`。 [本地使用边界](../SECURITY.md#本地使用)

技术栈：Next.js 16、React 19、TypeScript、Zustand、Tailwind CSS、Tauri；测试使用 Vitest。

## 桌面端开发中

安装 Rust、Tauri CLI 和对应平台的开发依赖后，在 `eidos` 目录运行 `cargo tauri dev`。它会使用本机的 Next.js 开发服务。正式桌面安装包仍需本地服务集成及权限验证，便携玩家包使用系统浏览器。 [Tauri 开发前置条件](https://v2.tauri.app/start/prerequisites/)

## 验证

```bash
npm run test:engine
npm test
npm run lint
npm run build
```
