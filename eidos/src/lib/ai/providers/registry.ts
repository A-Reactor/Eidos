// ============================================================
// Provider Adapter Registry — returns the adapter for a protocol
// ============================================================

import { createAnthropicCompatibleAdapter } from "./anthropic-compatible";
import { createDeepSeekNativeAdapter } from "./deepseek-native";
import { createGeminiNativeAdapter } from "./gemini-native";
import { createOpenAiCompatibleAdapter } from "./openai-compatible";
import type { AiProviderAdapter, AiProviderProtocol } from "./types";

export function getProviderAdapter(protocol: AiProviderProtocol): AiProviderAdapter {
  switch (protocol) {
    case "deepseek-native":
      return createDeepSeekNativeAdapter();
    case "openai-native":
    case "openai-compatible":
      return createOpenAiCompatibleAdapter(protocol);
    case "anthropic-compatible":
      return createAnthropicCompatibleAdapter();
    case "gemini-native":
      return createGeminiNativeAdapter();
  }
}
