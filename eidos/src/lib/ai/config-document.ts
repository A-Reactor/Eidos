import { AI_PROVIDER_PRESETS } from './provider-presets';
import type { GameSettings } from '@/lib/game/types';

const ROLES = ['alice', 'kei', 'uzq'] as const;
const MAX_SIZE = 128 * 1024;
const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('配置须为 JSON 对象');
  return value as Record<string, unknown>;
};
function text(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 2000) throw new Error(`${name}须为 1–2000 字符`);
  return value.trim();
}
function boolean(value: unknown, name: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${name}须为 true 或 false`);
  return value;
}
function number(value: unknown, name: string, min: number, max: number, integer = false): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isSafeInteger(value))) throw new Error(`${name}超出有效范围`);
  return value;
}
function endpoint(value: unknown): string {
  const input = text(value, 'API 地址');
  let url: URL;
  try { url = new URL(input); } catch { throw new Error('API 地址须包含 http:// 或 https://'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('API 地址须为不含凭据、查询参数或片段的 HTTP(S) 地址');
  return url.href.replace(/\/+$/, '');
}

/** Explicit fields keep credentials, prompts, save data and future private fields out of shared files. */
export function exportAiConfig(settings: GameSettings): string {
  const roles = Object.fromEntries(ROLES.map(role => [role, {
    providerId: settings[`${role}ProviderId`], endpoint: endpoint(settings[`${role}Endpoint`]), model: settings[`${role}Model`],
    enableReasoning: settings[`${role}EnableReasoning`], reasoningEffort: settings[`${role}ReasoningEffort`],
    contextWindowTokens: settings[`${role}ContextWindowTokens`],
  }]));
  return JSON.stringify({ format: 'eidos-ai-config', version: 1, roles, generation: {
    temperature: settings.temperature, maxTokens: settings.maxTokens, reserveReasoningBudget: settings.reserveReasoningBudget,
    compatibleJsonMode: settings.aiCompatibleJsonMode, compatibleStreamUsage: settings.aiCompatibleStreamUsage,
  } }, null, 2);
}

/** Parse everything before returning a patch; importing never saves settings or makes a model request. */
export function importAiConfig(raw: string, current: GameSettings): Partial<GameSettings> {
  if (raw.length > MAX_SIZE) throw new Error('配置文件不能超过 128 KB');
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new Error('无法读取配置 JSON，请检查文件格式'); }
  const doc = record(parsed);
  if (doc.format !== 'eidos-ai-config' || doc.version !== 1) throw new Error('不支持的 AI 配置格式或版本');
  const roles = record(doc.roles), patch: Partial<GameSettings> = { aiProviderMode: 'advanced' };
  for (const role of ROLES) {
    const config = record(roles[role]), providerId = text(config.providerId, '供应商');
    if (!Object.hasOwn(AI_PROVIDER_PRESETS, providerId)) throw new Error(`未知供应商：${providerId}，请改用自定义兼容接入`);
    const base = endpoint(config.endpoint), preset = AI_PROVIDER_PRESETS[providerId];
    const effort = config.reasoningEffort;
    if (!['low', 'medium', 'high', 'max'].includes(String(effort))) throw new Error(`${role.toUpperCase()} 思考强度无效`);
    let sameEndpoint = false;
    try { sameEndpoint = endpoint(current[`${role}Endpoint`]) === base; } catch { /* An invalid old address cannot retain credentials. */ }
    Object.assign(patch, {
      [`${role}ProviderId`]: providerId, [`${role}Endpoint`]: base, [`${role}Model`]: text(config.model, '模型 ID'),
      [`${role}EnableReasoning`]: boolean(config.enableReasoning, '思考模式'), [`${role}ReasoningEffort`]: effort,
      [`${role}ContextWindowTokens`]: number(config.contextWindowTokens, '上下文窗口', 0, Number.MAX_SAFE_INTEGER, true),
      [`${role}CompatibilityMode`]: preset.protocol === 'openai-compatible' ? 'openai' : preset.protocol === 'anthropic-compatible' ? 'anthropic' : 'native',
      // An old provider's credential must never travel to an imported endpoint.
      [`${role}ApiKey`]: sameEndpoint && current[`${role}ProviderId`] === providerId ? current[`${role}ApiKey`] : '',
    });
  }
  const generation = record(doc.generation);
  return { ...patch, aiGlobalProviderId: patch.aliceProviderId,
    temperature: number(generation.temperature, '温度', 0, 2), maxTokens: number(generation.maxTokens, '生成上限', 1, 1_000_000, true),
    reserveReasoningBudget: boolean(generation.reserveReasoningBudget, '思考预留'),
    aiCompatibleJsonMode: boolean(generation.compatibleJsonMode, '兼容 JSON 模式'),
    aiCompatibleStreamUsage: boolean(generation.compatibleStreamUsage, '兼容流式用量'),
  };
}
