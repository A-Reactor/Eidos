import type { CreationStreamOptions } from './creation-stream';
import type { AiChatMessage, AiRoleConfig } from './providers/types';
import type { TokenUsage } from './types';
import { getProviderAdapter } from './providers/registry';
import { preparePromptBudget } from './prompt-budget';

/** World authoring shares the normal transports while retaining every repair and continuation turn. */
export async function streamProviderCreationTurn(config: AiRoleConfig, body: Record<string, unknown>, onThinking: () => void, options: CreationStreamOptions) {
  const messages = body.messages as Array<{ role: string; content: string }>;
  const systemPrompt = messages.filter(message => message.role === 'system').map(message => message.content).join('\n\n');
  const conversation: AiChatMessage[] = messages.filter((message): message is AiChatMessage => message.role === 'user' || message.role === 'assistant');
  const userMessage = conversation.map(message => message.content).join('\n\n');
  // Legacy authoring asks for DeepSeek's 384K output limit; other APIs need a supported per-turn limit.
  const ceiling = config.protocol === 'anthropic-compatible' && /^claude-3[.-]5-/.test(config.model) ? 8192 : 16000;
  const maxTokens = Math.min(typeof body.max_tokens === 'number' ? body.max_tokens : 16000, ceiling);
  const budget = preparePromptBudget({ config: { ...config, reserveReasoningBudget: false }, systemPrompt, userMessage, maxTokens });
  const startedAt = Date.now();
  let text = '', usage: TokenUsage | undefined, failure: Error | undefined, success = false;
  try {
    await getProviderAdapter(config.protocol).stream({
      role: 'kei', config, systemPrompt, userMessage, conversation, maxTokens,
      generationMaxTokens: budget.generationMaxTokens, temperature: typeof body.temperature === 'number' ? body.temperature : 0.9,
      // Continuations may start in the middle of a JSON object, so use the author's format instructions.
      jsonMode: false, timeoutMs: 0, signal: options.signal,
      onActivity: activity => { if (activity.phase === 'thinking') onThinking(); },
      onChunk: delta => { text += delta; options.onText?.(text, delta); },
      onUsage: reported => { usage = reported; },
      onDone: (_text, reported) => { usage = reported; },
      onError: error => { failure = error; },
    });
    if (failure) throw failure;
    success = true;
    const finishReason = ['max_tokens', 'MAX_TOKENS'].includes(usage?.finishReason ?? '') ? 'length' : usage?.finishReason;
    return { text, finishReason };
  } finally {
    options.onUsage?.(undefined, { providerUsage: usage, success, elapsedMs: Date.now() - startedAt,
      firstTokenMs: usage?.firstTokenMs, promptChars: systemPrompt.length + userMessage.length, completionChars: text.length });
  }
}
