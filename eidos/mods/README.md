# 玩法插件

插件名称直接说明玩家能做什么，故事标题保留在游戏内部。稳定 ID 不随改名变化；已有世界保留当时安装的包，更新请在模组说明中导入同 ID 新版。

| 分享包 | 玩家可以做什么 | 源码与说明 |
| --- | --- | --- |
| [连续阅读与剧情选择](dist/continuous-novel.eidos-plugin.json) | 连读、关键选择和自由行动 | [说明](continuous-novel/README.md) |
| [分章阅读与配角视角](dist/night-voyage-short.eidos-plugin.json) | 分章停顿、配角决定和返回主角 | [说明](continuous-novel/README.md) |
| [预写剧情与 AI 即兴](dist/last-post.eidos-plugin.json) | 作者对白、本地分支和模型即兴 | [说明](last-post/README.md) |
| [证据对照与群体辩论](dist/debate-room.eidos-plugin.json) | 对照发言，使用证据反驳或支持 | [说明](debate-room/README.md) |
| [逐句追问与证据质询](dist/cross-examination.eidos-plugin.json) | 追问、修改证词和出示证据 | [说明](cross-examination/README.md) |
| [证词质询：站台时钟](dist/station-cross-examination.eidos-plugin.json) | 用另一份案件体验证词质询 | [说明](cross-examination/README.md) |
| [剧情触发与证词质询：雾港](dist/harbor-hearing.eidos-plugin.json) | 按剧情进入质询，可暂离调查继续自由行动 | [说明](cross-examination/README.md) |
| [人物调查与秘密审判](dist/secrets-trial.eidos-plugin.json) | 人物调查、证据定罪和隐私选择 | [说明](secrets-trial/README.md) |
| [文件交互与跨分支解谜](dist/folded-desk.eidos-plugin.json) | 主动打开文件工具后操作纸窗、分支信件和规则解谜 | [说明](folded-desk/README.md) |
| [文字地图与角色扮演](dist/chinese-room.eidos-plugin.json) | 直接操控主世界：走路、对话、调查、使用物品与 AI 地图生成 | [说明](chinese-room/README.md) |
| [Meta 演出与文本改写](dist/palimpsest-stage.eidos-plugin.json) | 在原有文字中覆写、残缺、遮挡和乱码；作者工具保留原文核对与来信 | [说明](palimpsest-stage/README.md) |
| [人物心智与承诺互动](dist/social-minds.eidos-plugin.json) | 独立见闻、误解、承诺与自主协助 | [说明](social-minds/README.md) |

全局插件 [阅读排版与快捷指令](global/paper-lab.eidos-global-plugin.json) 作用于整个应用，在设置的全局插件页导入。上表是世界玩法插件，在创建世界的玩法区域导入。多数玩法沿用原有正文、推荐行动与输入；文字地图提供地图操控，文件交互需主动打开工具，剧情触发的案件须满足各自进入条件。

内置指南也按功能命名：剧情分支与回溯、循环与受限回溯、[剧情锚定点](../docs/story-anchors.md)、线索探索与知识解谜、定时事件与剧情干预、证据收集与推理、人物关系与日常互动。剧情锚定点以提示词指导关键结果的条件性收束，直接在创建页选择，无额外界面或硬性门锁。渡句镇、记忆物品、生存探索已从源码、分享包或内置列表移除，不删除玩家既有存档。

作者修改对应目录后运行 `node scripts/pack-mods.mjs`，打包所有带 manifest 的玩法目录。变体使用 `--content` 指定内容文件，例如 `node scripts/pack-mods.mjs cross-examination --content cases/station-clock.json`。分享生成的单份 JSON 即可，接收者不需要源码或 Node。

`npm run dev:mods` 可预览主界面，`npm run dev:author` 可在作者实验室加载源码和实际现场。离线预览拦截模型请求，只能检查操作与展示；真实生成需要配置模型和实际游玩。[宿主接口](../docs/gameplay-plugins.md) · [作者实验室](../docs/author-lab.md)。

## 0.3.0 呈现规范

连续阅读、预写剧情、人物心智、群体辩论、逐句质询和秘密审判均回到原生正文、推荐行动及自由输入，不自动加载专用主界面。Meta 只加工原有文字。文字地图保留专门地图画面；文件交互改为按需工具。原 HTML 作为作者工作台保留，在设置 → 作者工具中主动展开；工具关闭即卸载，不和地图争用舞台。已有世界需升级对应安装包。

全局「阅读排版与快捷指令」1.1.0 同时取消默认悬浮开关和强改主题；默认只保留 /环顾 快捷指令，紧凑排版与强调色在现有设置中主动选择。
