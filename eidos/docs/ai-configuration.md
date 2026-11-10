# Eidos AI 接入说明

[English](ai-configuration.en.md)

## 文字模型

打开「设置 → AI 接入」，选择供应商，填写该服务需要的密钥或本地地址，再保存设置。ALICE 负责叙事，KEI 负责世界创建与审核，UZQ 负责人格推演。三个角色可以共享服务。若要分别指定模型或服务，在「高级接入设置」调整对应角色。

这页配置用于 Eidos 应用内的请求。独立游戏调用 `/api/engine/v1/narrate` 时，服务端连接使用环境变量配置。 [开发者 HTTP 接入](developer-engine.md#http-协议-v1)

| 选择 | 地址示例 | 密钥与模型 |
| --- | --- | --- |
| DeepSeek / OpenAI / Anthropic / Gemini / OpenRouter | 选择后自动填入 | 使用服务商的 Key；保留推荐模型或填写自己有权限的型号 |
| Ollama（本地） | `http://127.0.0.1:11434/v1` | 通常无需 Key；模型 ID 填写 `ollama list` 中的完整名称，包含标签 |
| LM Studio（本地） | `http://127.0.0.1:1234/v1` | 加载模型并启动 Developer 服务；模型 ID 使用服务显示的名称，开启认证时填写 Key |
| 自定义 OpenAI 兼容 | 服务的 `/v1` 根地址 | 可接 llama.cpp、vLLM 或兼容中转；按服务文档填写模型与密钥 |
| 自定义 Anthropic 兼容 | Messages API 的根地址 | 按服务文档填写模型与密钥 |

填写 API 根地址，不要追加 `/chat/completions` 或 `/messages`。本地模型需自行安装并启动；在「本地或自定义模型 ID」填写一次即可用于三个角色。混用本地与云端服务时，打开高级设置逐个配置。

Gemini 请选「Gemini」供应商，推荐地址为 `https://generativelanguage.googleapis.com/v1beta`；仅填官方域名时会自动补 `/v1beta`。模型 ID 使用 AI Studio 中实际可用的型号，也接受 `models/` 前缀。免费 Key 的模型权限和额度请在 AI Studio 的 Rate limits 页面查看；测试连接会检查三个角色，连续测试可能消耗项目请求额度。HTTP 错误会显示 Google 的具体原因；网络错误会显示可取得的底层代码（例如 `ECONNRESET`），包括收到响应后读取正文中断的情况。Eidos 由后端请求 Gemini，浏览器可以打开 Google 不保证后端网络、代理和证书配置也可用。

兼容服务不支持 `response_format` 或 `stream_options` 时，可在「兼容接口选项」关闭对应选项；服务未提供的用量会标为估算。小众服务的专有参数、鉴权和协议转换请按其文档自行配置，中转需提供标准接口。模型仍须能按提示输出完整游戏 JSON，协议兼容不保证生成质量。

地址由运行 Eidos 后端的电脑访问。后端若在远程电脑或容器，`127.0.0.1` 指向后端所在环境，应填写实际可达的地址。

## 思考与缓存

高级设置的思考开关和强度适用于已识别的 DeepSeek、OpenAI 推理模型、Claude 和 Gemini 型号；旧型号不发送不支持的思考字段，通用兼容接口不按模型名猜测私有参数。部分型号不能完全关闭思考，例如 Gemini 2.5 Pro 和 OpenAI 的部分推理型号，关闭时使用允许的最低思考配置。「最高」映射到接口支持的档位。

「生成限额预留思考额度」为支持的思考模型增加共享生成上限，并参与上下文预检。关闭后使用原有总限额；思考仍真实计入用量，更多预留可能增加耗时和费用。自定义部署可在「上下文窗口覆盖」填写实际 token 上限。

Claude 官方接入对明确划分的稳定系统前缀设置缓存断点，变化的状态留在后面；兼容中转不自动收到该扩展。其他供应商沿用原有缓存机制，是否命中以真实用量为准。世界创建、修正和续写也使用所选供应商协议，保留完整创建对话。

## 本地文字模型搭配语音 API

文字与语音模型独立配置，可以用本地大语言模型生成叙事，用云端语音 API 朗读台词，也可以全部本地运行。

在音频设置「服务与连接」选择「兼容语音接口 · 自选模型」：

| 示例 | 服务地址 | 模型 ID | 音色 ID |
| --- | --- | --- | --- |
| OpenAI 语音 | `https://api.openai.com/v1` | `tts-1` | `alloy` |
| 本地 Kokoro 兼容服务 | `http://127.0.0.1:8880/v1` | `kokoro` | `zf_xiaobei` |
| 其他兼容语音服务 | 服务文档给出的 API 根地址 | 服务提供的 model | 服务提供的 voice |

前两个示例有快捷填入按钮。云端语音在「连接凭据」填写 Key，本地通常不需要。语音 Key 仅保留在本次浏览器会话，独立于文字模型 Key，不随存档导出。请求使用 `POST /audio/speech`，参数为 `model`、`voice`、`input`、`response_format: "wav"`、`speed: 1`，服务须返回可播放的二进制音频。专有语音协议请自行通过兼容网关接入。

填入配置不会调用模型；「生成并试听」会实际调用服务，可能产生费用。已有 GPT-SoVITS 接入继续使用原有设置。

## 配置文件导入导出

「设置 → AI 接入 → AI 配置文件」可导出 `eidos-ai-config.json`。

文件包含三个文字模型角色的供应商、地址、模型、思考、上下文窗口和生成选项，不包含 Key、自定义提示词、语音参考音频或游戏存档。语音方案继续使用音频页的「配置方案」管理。

导入仅更新草稿，展开高级设置便于检查，保存后才生效，也可放弃更改。相同供应商和地址保留本机已保存的 Key；供应商或地址变化时清空该角色的已保存 Key，请自行补填。环境变量仍按接入规则生效；本地预设不继承 `ALICE_API_KEY` 等角色级云端环境凭据。

格式为 `format: "eidos-ai-config"`、`version: 1`，`roles` 包含 `alice`、`kei`、`uzq`，各有 `providerId`、`endpoint`、`model`、`enableReasoning`、`reasoningEffort`、`contextWindowTokens`；`generation` 包含 `temperature`、`maxTokens`、`reserveReasoningBudget`、`compatibleJsonMode`、`compatibleStreamUsage`。可先导出再编辑。导入校验版本、供应商、类型和地址；未知字段不作为设置执行，文件最大 128 KB。

## 数据与密钥

- 文字模型的界面设置和密钥保存在当前浏览器地址的 `localStorage`。服务端环境密钥可放在 `eidos/.env.local`。兼容语音接口的密钥存于当前浏览器标签页的 `sessionStorage`。
- 调用模型时，Eidos 将该次任务使用的世界、角色、剧情和输入交给所选服务。显式选择的文件片段、图片或语音参考也可能随相应请求发送。搜索和语音使用各自配置的服务。
- Eidos 的模型调用和用量统计保存在本地，可随诊断记录导出。Next.js 开发和构建工具有独立的匿名遥测，可在 `eidos` 目录运行 `npx next telemetry disable` 关闭。 [Next.js 遥测说明](https://nextjs.org/telemetry)
- AI 配置导出省略密钥。世界备份和作者复现场景可含未公开设定和行动记录，分享前请检查。 [作者复现场景说明](author-lab.md#保存与重放)
- 清除该访问地址的浏览器站点数据会删除本地设置和存档，请先导出要保留的世界。浏览器清理与服务端媒体、语音训练目录及模型服务的数据管理相互独立。

## 官方参考

- [OpenAI Chat Completions](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create) · [推理模型](https://developers.openai.com/api/docs/guides/reasoning)
- [Claude 思考](https://platform.claude.com/docs/en/build-with-claude/extended-thinking) · [提示词缓存](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)
- [Gemini 思考](https://ai.google.dev/gemini-api/docs/generate-content/thinking)
- [Ollama 兼容接口](https://docs.ollama.com/api/openai-compatibility) · [LM Studio 兼容接口](https://lmstudio.ai/docs/developer/openai-compat)
