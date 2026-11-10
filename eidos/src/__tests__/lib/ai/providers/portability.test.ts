import { assemblePromptBlocks } from '@/lib/ai/prompt-blocks';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createOpenAiCompatibleAdapter } from '@/lib/ai/providers/openai-compatible';
import { createAnthropicCompatibleAdapter } from '@/lib/ai/providers/anthropic-compatible';
import { createGeminiNativeAdapter } from '@/lib/ai/providers/gemini-native';
import { resolveAiRoleConfig } from '@/lib/ai/providers/config';
import { requestedGenerationTokens } from '@/lib/ai/prompt-budget';
import { composeSystemPrompt } from '@/lib/ai/prompt-layout';
import { DEFAULT_SETTINGS } from '@/lib/game/types';
import type { AiChatRequest, AiRoleConfig } from '@/lib/ai/providers/types';

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
function request(config: Partial<AiRoleConfig> = {}): AiChatRequest {
  return { role: 'kei', systemPrompt: 'rules', userMessage: 'Return JSON', temperature: 0.8, maxTokens: 1500,
    jsonMode: true, timeoutMs: 1000, config: { providerId: 'openai', protocol: 'openai-native',
      baseUrl: 'https://api.openai.com/v1', apiKey: 'fixture', model: 'o3-mini', compatibilityMode: 'native',
      enableReasoning: true, reasoningEffort: 'high', ...config } };
}
function capture() {
  const fetcher = vi.fn(async (_url: string, _init: RequestInit) => Response.json({ choices: [{ message: { content: '{}' } }], content: [{ type: 'text', text: '{}' }], candidates: [{ content: { parts: [{ text: '{}' }] } }] }));
  vi.stubGlobal('fetch', fetcher);
  return { fetcher, body: () => JSON.parse(String((fetcher.mock.calls[0] as unknown as [string, RequestInit])[1].body)),
    headers: () => (fetcher.mock.calls[0] as unknown as [string, RequestInit])[1].headers };
}

describe('common provider portability', () => {
  it('allows a keyless local compatible server without an Authorization header', async () => {
    const c = capture();
    await createOpenAiCompatibleAdapter().complete(request({ providerId: 'custom-openai-compatible', protocol: 'openai-compatible', baseUrl: 'http://127.0.0.1:11434/v1/', apiKey: '', model: 'local-model' }));
    expect(c.fetcher.mock.calls[0][0]).toBe('http://127.0.0.1:11434/v1/chat/completions');
    expect(c.headers()).not.toHaveProperty('Authorization');
  });
  it('still rejects a missing key for the OpenAI preset before fetching', async () => {
    const c = capture();
    await expect(createOpenAiCompatibleAdapter('openai-native').complete(request({ apiKey: '' }))).rejects.toMatchObject({ code: 'missing_api_key' });
    expect(c.fetcher).not.toHaveBeenCalled();
  });
  it.each(['o3-mini', 'gpt-5-mini'])('uses the reasoning request contract for %s', async model => {
    const c = capture();
    await createOpenAiCompatibleAdapter('openai-native').complete(request({ model, reasoningEffort: 'max', reserveReasoningBudget: false }));
    expect(c.body()).toMatchObject({ max_completion_tokens: 1500, reasoning_effort: 'high' });
    expect(c.body()).not.toHaveProperty('temperature');
    expect(c.body()).not.toHaveProperty('max_tokens');
  });
  it('does not infer OpenAI reasoning parameters from a local model name', async () => {
    const c = capture();
    await createOpenAiCompatibleAdapter().complete(request({ providerId: 'custom-openai-compatible', protocol: 'openai-compatible' }));
    expect(c.body()).toMatchObject({ max_tokens: 1500, temperature: 0.8 });
    expect(c.body()).not.toHaveProperty('reasoning_effort');
  });
  it('caches only the stable Claude system prefix and preserves the complete prompt', async () => {
    const c = capture(), sections = { stablePrefix: 'shared rules', dynamicSuffix: 'current state' };
    await createAnthropicCompatibleAdapter().complete({ ...request({ providerId: 'anthropic', protocol: 'anthropic-compatible', model: 'claude-3-5-sonnet-latest', enableReasoning: false }), systemPrompt: composeSystemPrompt(sections), promptSections: sections });
    expect(c.body().system).toEqual([{ type: 'text', text: 'shared rules', cache_control: { type: 'ephemeral' } }, { type: 'text', text: '\n\n---\n\ncurrent state' }]);
  });
  it.each(['claude-sonnet-4-5', 'claude-sonnet-4-20250514', 'claude-sonnet-4-5-20250929'])('enables manual thinking for %s without incompatible temperature', async model => {
    const c = capture();
    await createAnthropicCompatibleAdapter().complete(request({ providerId: 'anthropic', protocol: 'anthropic-compatible', model, reserveReasoningBudget: true }));
    expect(c.body()).toMatchObject({ thinking: { type: 'enabled', budget_tokens: 4096 }, max_tokens: 5596 });
    expect(c.body()).not.toHaveProperty('temperature');
  });
  it('uses adaptive thinking for Claude 4.6', async () => {
    const c = capture();
    await createAnthropicCompatibleAdapter().complete(request({ providerId: 'anthropic', protocol: 'anthropic-compatible', model: 'claude-sonnet-4-6' }));
    expect(c.body()).toMatchObject({ thinking: { type: 'adaptive' }, output_config: { effort: 'high' } });
    expect(c.body().thinking).not.toHaveProperty('budget_tokens');
  });
  it.each([['gemini-2.5-flash', 0], ['gemini-2.5-pro', 128]])('uses a valid minimum thinking budget for %s', async (model, thinkingBudget) => {
    const c = capture();
    await createGeminiNativeAdapter().complete(request({ providerId: 'gemini', protocol: 'gemini-native', model: String(model), enableReasoning: false }));
    expect(c.body().generationConfig.thinkingConfig).toEqual({ thinkingBudget });
  });
  it('honors the Gemini thinking effort and reserves both thinking and prose', async () => {
    const c = capture();
    await createGeminiNativeAdapter().complete(request({ providerId: 'gemini', protocol: 'gemini-native', model: 'gemini-2.5-flash', reserveReasoningBudget: true }));
    expect(c.body().generationConfig).toMatchObject({ thinkingConfig: { thinkingBudget: 8192 }, maxOutputTokens: 9692 });
  });
  it('uses the same thinking reservation for context preflight', () => {
    expect(requestedGenerationTokens(request({ providerId: 'anthropic', protocol: 'anthropic-compatible', model: 'claude-sonnet-4-5' }))).toBe(5596);
    expect(requestedGenerationTokens(request({ providerId: 'gemini', protocol: 'gemini-native', model: 'gemini-2.5-flash' }))).toBe(9692);
  });
  it('honors explicit reasoning overrides and trims endpoint input', () => {
    const config = resolveAiRoleConfig('alice', DEFAULT_SETTINGS, { aliceEndpoint: ' http://localhost:1234/v1/// ', aliceEnableReasoning: true, aliceReasoningEffort: 'low' });
    expect(config).toMatchObject({ baseUrl: 'http://localhost:1234/v1', enableReasoning: true, reasoningEffort: 'low' });
  });
  it('rejects an unknown provider instead of silently sending to DeepSeek', () => {
    expect(() => resolveAiRoleConfig('alice', DEFAULT_SETTINGS, { aliceProviderId: 'typo-provider' })).toThrow(/Unknown AI provider/);
  });
  it('can omit unsupported JSON and streaming usage options for compatible servers', async () => {
    const c = capture();
    c.fetcher.mockImplementation(async () => new Response('data: {"choices":[{"delta":{"content":"{}"},"finish_reason":"stop"}]}\n\n'));
    const r = request({ providerId: 'custom-openai-compatible', protocol: 'openai-compatible', useJsonMode: false, includeStreamUsage: false });
    const onError = vi.fn(), onDone = vi.fn();
    await createOpenAiCompatibleAdapter().stream({ ...r, onChunk: vi.fn(), onDone, onError });
    expect(onError).not.toHaveBeenCalled();
    expect(onDone).toHaveBeenCalledWith('{}', expect.objectContaining({ usageEstimated: true }));
    expect(c.body().stream).toBe(true);
    expect(c.body()).not.toHaveProperty('response_format');
    expect(c.body()).not.toHaveProperty('stream_options');
  });
});

it('places the Claude cache breakpoint after sealed records while keeping mutable state outside', async()=>{
 const c=capture(),prompt=assemblePromptBlocks([
 {id:'rules',kind:'rules',stability:'edition',text:'规则'},
 {id:'history',kind:'record',stability:'record',text:'已接受正文'},
 {id:'state',kind:'current',stability:'request',text:'当前状态'}]);
 await createAnthropicCompatibleAdapter().complete({...request({providerId:'anthropic',protocol:'anthropic-compatible',enableReasoning:false}),systemPrompt:prompt.systemPrompt,promptSections:prompt.sections});
 const system=c.body().system;
 expect(system[0]).toEqual({type:'text',text:'规则',cache_control:{type:'ephemeral'}});
 expect(system[1]).toMatchObject({cache_control:{type:'ephemeral'}});
 expect(system[1].text).toContain('已接受正文');
 expect(system[2].text).toBe('当前状态');
 expect(system.map((b:{text:string})=>b.text).join('')).toBe(prompt.systemPrompt);
});
