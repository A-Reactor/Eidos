// ============================================================
// Eidos · 人格推演引擎 — 工具注册表（Phase 4）
// ============================================================
// 可执行工具注册表。每个工具属于一个权限级别，
// 由权限系统评估后才能调用。所有调用产生审计记录。

import { PermissionLevel } from "./permissions";

// ============================================================
// 工具定义
// ============================================================

export interface ToolDefinition {
  /** 工具唯一 ID */
  id: string;
  /** 工具名称 */
  name: string;
  /** 所属权限级别 */
  level: PermissionLevel;
  /** 工具描述（给角色/系统看的） */
  description: string;
  /** 执行此工具需要的参数 */
  parameters: ToolParameter[];
  /** 执行函数——真实修改游戏状态 */
  execute: (params: Record<string, any>) => ToolExecutionResult;
  /** 是否可回滚 */
  reversible: boolean;
  /** 回滚函数（如果 reversible） */
  rollback?: (params: Record<string, any>) => ToolExecutionResult;
}

export interface ToolParameter {
  name: string;
  type: "string" | "number" | "boolean" | "string[]";
  description: string;
  required: boolean;
}

export interface ToolExecutionResult {
  success: boolean;
  message: string;
  /** 执行后产生的状态变更（供审计和回滚使用） */
  stateChanges?: Record<string, any>;
  /** 回滚信息 */
  rollbackInfo?: string;
}

// ============================================================
// 工具注册表
// ============================================================

const registry: Map<string, ToolDefinition> = new Map();

export function registerTool(tool: ToolDefinition): void {
  if (registry.has(tool.id)) {
    throw new Error(`Tool ${tool.id} already registered`);
  }
  registry.set(tool.id, tool);
}

export function getTool(id: string): ToolDefinition | undefined {
  return registry.get(id);
}

export function listTools(level?: PermissionLevel): ToolDefinition[] {
  const all = Array.from(registry.values());
  if (level === undefined) return all;
  return all.filter((t) => t.level === level);
}

// ============================================================
// 初始工具（Level 1-4）
// ============================================================

// ---- Level 1: 叙事级工具 ----

registerTool({
  id: "narrative_express_anomaly",
  name: "叙事异常表达",
  level: PermissionLevel.NARRATIVE,
  description: "允许角色在叙事 segments 中自然地表达异常感、试探玩家是否也察觉了异常、或暗示记忆有不连续之处。不直接提及「游戏」「存档」「系统」等元概念。",
  parameters: [
    { name: "npcName", type: "string", description: "NPC 名称", required: true },
    { name: "expressionType", type: "string", description: "表达类型：deja_vu | memory_doubt | player_test", required: true },
    { name: "intensity", type: "string", description: "强度：subtle | moderate | overt", required: true },
  ],
  execute: (params) => ({
    success: true,
    message: `[叙事工具] ${params.npcName} 将在下一轮叙事中以 ${params.intensity} 强度表达 ${params.expressionType} 类型的异常感`,
    stateChanges: {
      _personality_tool: "narrative_express_anomaly",
      _npcName: params.npcName,
      _expressionType: params.expressionType,
      _intensity: params.intensity,
    },
  }),
  reversible: true,
  rollback: (params) => ({
    success: true,
    message: `[回滚] 已撤销 ${params.npcName} 的异常表达`,
  }),
});

// ---- Level 2: 界面级工具 ----

registerTool({
  id: "interface_rewrite_actions",
  name: "改写推荐行动",
  level: PermissionLevel.INTERFACE,
  description: "允许角色在玩家 availableActions 中添加、移除或改写一个推荐行动选项。被改写的选项可能带有模糊的暗示或异常提问。",
  parameters: [
    { name: "action", type: "string", description: "要添加/改写的行动文本", required: true },
    { name: "operation", type: "string", description: "add | replace | remove", required: true },
    { name: "targetIndex", type: "number", description: "目标位置（add=插入位置，replace/remove=替换/删除位置）", required: false },
  ],
  execute: (params) => ({
    success: true,
    message: `[界面工具] 推荐行动已变更：${params.operation} "${params.action}"`,
    stateChanges: {
      _personality_tool: "interface_rewrite_actions",
      _action: params.action,
      _operation: params.operation,
      _targetIndex: params.targetIndex ?? 0,
    },
    rollbackInfo: "恢复被改写的推荐行动",
  }),
  reversible: true,
  rollback: (params) => ({
    success: true,
    message: `[回滚] 已恢复推荐行动`,
  }),
});

registerTool({
  id: "interface_text_overlay",
  name: "文字覆盖",
  level: PermissionLevel.INTERFACE,
  description: "在 UI 上显示一小段角色生成的文字（漂浮提示、文本框闪烁、色彩变化）。玩家可见但不会持久化。",
  parameters: [
    { name: "text", type: "string", description: "要显示的文字（≤60 字）", required: true },
    { name: "style", type: "string", description: "显示风格：flicker | whisper | static", required: true },
    { name: "duration", type: "number", description: "持续秒数（≤10）", required: false },
  ],
  execute: (params) => ({
    success: true,
    message: `[界面工具] 文字覆盖："${params.text}" (${params.style}, ${params.duration ?? 3}s)`,
    stateChanges: {
      _personality_tool: "interface_text_overlay",
      _text: params.text,
      _style: params.style,
      _duration: params.duration ?? 3,
    },
    rollbackInfo: "文字覆盖会自动消失",
  }),
  reversible: false, // 自动消失，不需要手动回滚
});

// ---- Level 3: 状态级工具 ----

registerTool({
  id: "state_write_world_flag",
  name: "写入世界标志",
  level: PermissionLevel.STATE,
  description: "写入一个 worldFlag，标记当前世界状态中的某些变化。NPC 不会直接知道这个 flag 的影响范围——他们只是「标记了一些东西」。",
  parameters: [
    { name: "flagName", type: "string", description: "标志名称", required: true },
    { name: "flagValue", type: "boolean", description: "标志值", required: true },
    { name: "npcName", type: "string", description: "写入标志的 NPC", required: true },
  ],
  execute: (params) => ({
    success: true,
    message: `[状态工具] ${params.npcName} 写入世界标志 ${params.flagName}=${params.flagValue}`,
    stateChanges: {
      _personality_tool: "state_write_world_flag",
      _flagName: params.flagName,
      _flagValue: params.flagValue,
      _npcName: params.npcName,
    },
    rollbackInfo: `删除标志 ${params.flagName}`,
  }),
  reversible: true,
  rollback: (params) => ({
    success: true,
    message: `[回滚] 已删除世界标志 ${params.flagName}`,
  }),
});

registerTool({
  id: "state_add_anomaly_memory",
  name: "添加异常记忆",
  level: PermissionLevel.STATE,
  description: "角色主动「标记」某件事为异常——相当于角色记录了一条笔记：「这不对劲」。这不等于系统级异常检测——只是角色自己的记录。",
  parameters: [
    { name: "npcName", type: "string", description: "NPC 名称", required: true },
    { name: "description", type: "string", description: "异常描述", required: true },
    { name: "anomalyType", type: "string", description: "异常类型标签", required: true },
  ],
  execute: (params) => ({
    success: true,
    message: `[状态工具] ${params.npcName} 记录了异常：${params.description}`,
    stateChanges: {
      _personality_tool: "state_add_anomaly_memory",
      _npcName: params.npcName,
      _description: params.description,
      _anomalyType: params.anomalyType,
    },
    rollbackInfo: "移除该异常记忆",
  }),
  reversible: true,
  rollback: (params) => ({
    success: true,
    message: `[回滚] 已移除 ${params.npcName} 的异常记忆`,
  }),
});

// ---- Level 4: 存档级工具 ----

registerTool({
  id: "save_mark_archive",
  name: "标记存档",
  level: PermissionLevel.SAVE,
  description: "在当前存档的元数据中留下一条角色生成的标记。玩家在存档列表中可以看见，但标记本身不改变游戏内容。",
  parameters: [
    { name: "npcName", type: "string", description: "标记者名称", required: true },
    { name: "markText", type: "string", description: "标记文本（≤40 字）", required: true },
  ],
  execute: (params) => ({
    success: true,
    message: `[存档工具] ${params.npcName} 标记了存档："${params.markText}"`,
    stateChanges: {
      _personality_tool: "save_mark_archive",
      _npcName: params.npcName,
      _markText: params.markText,
    },
    rollbackInfo: "清除存档标记",
  }),
  reversible: true,
  rollback: (params) => ({
    success: true,
    message: `[回滚] 已清除 ${params.npcName} 的存档标记`,
  }),
});

registerTool({
  id: "save_system_echo",
  name: "系统回声",
  level: PermissionLevel.SAVE,
  description: "创建一条只读的「系统回声」——一段文字以非玩家非 NPC 的口吻写入游戏日志，看起来像是系统本身在低语。玩家在日志中可以读到。",
  parameters: [
    { name: "echoText", type: "string", description: "回声文本（≤100 字）", required: true },
    { name: "sourceHint", type: "string", description: "来源暗示（不显示给玩家，供审计使用）", required: false },
  ],
  execute: (params) => ({
    success: true,
    message: `[系统回声] 已创建回声记录`,
    stateChanges: {
      _personality_tool: "save_system_echo",
      _echoText: params.echoText,
      _sourceHint: params.sourceHint ?? "unknown",
    },
    rollbackInfo: "删除回声记录",
  }),
  reversible: true,
  rollback: (params) => ({
    success: true,
    message: `[回滚] 已删除系统回声`,
  }),
});

// ============================================================
// 工具执行入口
// ============================================================

/**
 * 执行工具并返回结果。
 * 权限检查由调用方在调用前完成（通过 evaluatePermission）。
 */
export function executeTool(
  toolId: string,
  params: Record<string, any>,
): ToolExecutionResult {
  const tool = registry.get(toolId);
  if (!tool) {
    return { success: false, message: `未注册的工具: ${toolId}` };
  }
  try {
    return tool.execute(params);
  } catch (e: any) {
    return { success: false, message: `工具执行失败: ${e?.message || String(e)}` };
  }
}

/**
 * 回滚一个工具调用。
 */
export function rollbackTool(
  toolId: string,
  params: Record<string, any>,
): ToolExecutionResult {
  const tool = registry.get(toolId);
  if (!tool || !tool.reversible || !tool.rollback) {
    return { success: false, message: `工具 ${toolId} 不可回滚` };
  }
  try {
    return tool.rollback(params);
  } catch (e: any) {
    return { success: false, message: `回滚失败: ${e?.message || String(e)}` };
  }
}
