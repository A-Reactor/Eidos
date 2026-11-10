import { parsePluginIntroduction } from './introduction';
import type { GameplayPlugin, GameplayRule } from './types';

import { allowedFields, parsePluginFlags, pluginIdentifier, PluginInputError, record, text } from './validation';
import { parseResources, parseResourceChanges, parseResourceRequires } from './resource-manifest';
import type { GameplayResource } from './types';
import { parseReadouts } from './readout-manifest';
import { parsePluginSettings } from './settings-manifest';
import { parseRuleEffects } from './rule-effects';
import { parseUpgradeDeclaration } from './upgrade-manifest';
import { parseNativeActions } from './native-action-manifest';
export { PluginInputError, pluginIdentifier } from './validation';

function rules(value: unknown, resources?: Record<string, GameplayResource>): GameplayRule[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new PluginInputError('插件规则须为列表');
  const ids = new Set<string>();
  return value.map(raw => {
    const r = record(raw);
    allowedFields(r, ['id', 'description', 'requires', 'sets', 'once', 'effects', ...(resources ? ['resourceRequires', 'resourceChanges'] : [])]);
    if (!pluginIdentifier(r.id) || ids.has(r.id)) throw new PluginInputError('插件规则 ID 无效或重复');
    ids.add(r.id);
    if (r.once !== undefined && typeof r.once !== 'boolean') throw new PluginInputError('once 须为布尔值');
    const sets = parsePluginFlags(r.sets);
    const effects = parseRuleEffects(r.effects);
    const numeric = resources ? { resourceRequires: parseResourceRequires(r.resourceRequires, resources), resourceChanges: parseResourceChanges(r.resourceChanges, resources) } : {};
    if (!Object.keys(sets).length && !Object.keys(numeric.resourceChanges ?? {}).length && !effects?.state?.some(p => p.op !== 'test') && !effects?.facts?.some(p => p.op !== 'test')) throw new PluginInputError('插件规则须声明状态变化');
    return { id: r.id, description: text(r.description, Infinity), requires: parsePluginFlags(r.requires), sets, once: r.once !== false, ...numeric, ...(effects ? { effects } : {}) };
  });
}
export function parseGameplayPlugins(value: unknown): GameplayPlugin[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new PluginInputError('玩法插件须为列表');
  const ids = new Set<string>();
  return value.map(raw => {
    const p = record(raw);
    allowedFields(p, ['format', 'version', 'id', 'name', 'description', 'tags', 'prompts', 'rules', 'data', 'readouts', 'ui', 'activation', 'settings', 'release', 'stateVersion', 'migrations', 'introduction', ...(p.version === 2 ? ['resources'] : [])]);
    if (p.format !== 'eidos-gameplay-plugin' || (p.version !== 1 && p.version !== 2) || !pluginIdentifier(p.id) || ids.has(p.id)) throw new PluginInputError('插件格式、版本或 ID 无效（ID 不能重复）');
    ids.add(p.id);
    if (!Array.isArray(p.tags) || p.tags.length > 8) throw new PluginInputError('插件标签须为最多 8 项的列表');
    const prompts = record(p.prompts);
    allowedFields(prompts, ['creation', 'action', 'review']);
    const resources = p.version === 2 ? parseResources(p.resources) : undefined;
    const activation = p.activation === undefined ? undefined : record(p.activation);
    if (activation) {
      allowedFields(activation, ['requires', 'scenes']);
      if (activation.scenes !== undefined && (!Array.isArray(activation.scenes) || activation.scenes.length > 64)) throw new PluginInputError('模组启用场景须为列表');
    }
    const settings = parsePluginSettings(p.settings);
    const introduction = parsePluginIntroduction(p.introduction);
    const parsedRules = rules(p.rules, resources);
    const ui = p.ui === undefined ? undefined : record(p.ui);
    if (ui) {
      allowedFields(ui, ['html', 'reading', 'initialState', 'priority', 'presentation', 'actions', 'nativeReading']);
      if (ui.presentation !== undefined && !['scene-map', 'native-text', 'native', 'tool'].includes(String(ui.presentation))) throw new PluginInputError('未知模组呈现方式');
      if (ui.nativeReading !== undefined && typeof ui.nativeReading !== 'boolean') throw new PluginInputError('原生阅读标记须为布尔值');
      if ((ui.actions !== undefined || ui.nativeReading !== undefined) && ui.presentation !== 'native') throw new PluginInputError('原生行动与阅读须使用 native 呈现');
      if (ui.reading !== 'replace' && ui.reading !== 'inherit') throw new PluginInputError('模组阅读模式须为 replace 或 inherit');
      if (ui.priority !== undefined && (!Number.isSafeInteger(ui.priority) || Math.abs(Number(ui.priority)) > 1000)) throw new PluginInputError('舞台优先级须为 -1000 到 1000 的整数');
    }
    return { format: 'eidos-gameplay-plugin', version: p.version, id: p.id, ...(introduction ? { introduction } : {}), ...parseUpgradeDeclaration(p), name: text(p.name, Infinity), description: text(p.description, Infinity), tags: p.tags.map(tag => text(tag, Infinity)),
      prompts: { creation: text(prompts.creation, Infinity, false), action: text(prompts.action, Infinity, false), review: text(prompts.review, Infinity, false) }, rules: parsedRules, ...(resources ? { resources } : {}),
      ...(activation ? { activation: { requires: parsePluginFlags(activation.requires), ...(activation.scenes === undefined ? {} : { scenes: (activation.scenes as unknown[]).map(scene => text(scene, Infinity)) }) } } : {}),
      ...(settings === undefined ? {} : { settings }),
      ...(p.data === undefined ? {} : { data: validateGameModeConfig(record(p.data)) }),
      ...(ui ? { ui: { html: text(ui.html, Infinity), reading: ui.reading as 'replace' | 'inherit', ...(ui.priority === undefined ? {} : { priority: Number(ui.priority) }), ...(ui.presentation === undefined ? {} : { presentation: ui.presentation as NonNullable<GameplayPlugin['ui']>['presentation'] }), ...(ui.actions === undefined ? {} : { actions: parseNativeActions(ui.actions, parsedRules) }), ...(ui.nativeReading === undefined ? {} : { nativeReading: ui.nativeReading as boolean }), ...(ui.initialState === undefined ? {} : { initialState: validateGameModeConfig(record(ui.initialState)) }) } } : {}),
      ...(p.readouts === undefined ? {} : { readouts: parseReadouts(p.readouts, resources) }) };
  });
}
export function parsePluginFile(value: unknown): GameplayPlugin[] {
  return parseGameplayPlugins(Array.isArray(value) ? value : [value]);
}
export function validateGameModeConfig(value: unknown, maxChars = Infinity): Record<string, unknown> | undefined {
  if (value === undefined || value === null) return undefined;
  const result = record(value);
  if (JSON.stringify(result).length > maxChars) throw new PluginInputError(`玩法配置超过 ${Math.floor(maxChars / 1000)} KB`);
  const inspect = (node: unknown, depth: number): void => {
    if (depth > 32) throw new PluginInputError('玩法配置嵌套过深');
    if (Array.isArray(node)) { node.forEach(child => inspect(child, depth + 1)); return; }
    if (node && typeof node === 'object') {
      Object.values(record(node)).forEach(child => inspect(child, depth + 1));
    } else if (node !== null && !['string', 'number', 'boolean'].includes(typeof node) || typeof node === 'number' && !Number.isFinite(node)) {
      throw new PluginInputError('玩法配置须为 JSON 数据');
    }
  };
  inspect(result, 0);
  return result;
}
