import { requestedGenerationTokens } from '../prompt-budget';
// ============================================================
// DeepSeek Native Adapter — extends OpenAI-compatible with reasoning/cache
// ============================================================

import { createOpenAiCompatibleAdapter } from "./openai-compatible";
import type { AiChatRequest } from "./types";


export function createDeepSeekNativeAdapter() {
  return createOpenAiCompatibleAdapter(
    "deepseek-native",
    {
      supportsImageInput: true,
      supportsJsonMode: true,
      supportsStreaming: true,
      supportsStreamingUsage: true,
      supportsReasoning: true,
    },
    (request: AiChatRequest) => {
      // Transport now supports vision, but Pro still must not silently discard image blocks.
      if (request.media?.length && !['deepseek-flash', 'deepseek-v4-flash', 'deepseek-v4.1-flash', 'deepseek-v4-flash-vision-exp'].includes(request.config.model)) {
        throw new Error(`当前 DeepSeek 模型不支持此识图输入，请在 AI 接入中将 ${request.role.toUpperCase()} 切换为 deepseek-flash 或其他支持识图的模型`);
      }
      // DeepSeek defaults to enabled: omission would silently ignore the UI's off switch.
      if (!request.config.enableReasoning) return { thinking: { type: "disabled" } };
      return {
        thinking: { type: "enabled" },
        reasoning_effort: request.config.reasoningEffort,
        // The provider shares this budget between reasoning and visible output.
        max_tokens: request.generationMaxTokens ?? requestedGenerationTokens(request),
        // Thinking-mode prompts already request JSON; preserve the existing transport format.
        response_format: undefined,
      };
    },
  );
}
