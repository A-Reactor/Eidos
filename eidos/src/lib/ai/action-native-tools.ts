import { createActionWebTools } from './action-web-tools';
import type { AiFunctionTool } from './providers/types';
import type { WebToolExecutor } from '@/lib/game/web-tools';

const fileMethods = ['files.list', 'files.search', 'files.read', 'files.write', 'files.patch', 'files.rename'];
const gateways: AiFunctionTool[] = ['toolRequest', 'workspaceRequest'].map(name => ({
  type: 'function', function: { name,
    description: name === 'workspaceRequest'
      ? 'Read or stage edits to mounted documents and image configurations. Same workspaceRequest method/params protocol as game JSON. Call alone, then wait for the real file receipt; this call does not commit edits.'
      : 'Request a file, history or game operation using the game toolRequest method/params protocol. Call alone, then wait for the real receipt. The host enforces permissions, review and staged operation selection.',
    parameters: { type: 'object', properties: {
      method: { type: 'string', enum: name === 'workspaceRequest' ? fileMethods : [...fileMethods, 'history.read', 'gameplay.validate', 'worldline.backtrack', 'npc.profile.update'] },
      params: { type: 'object', description: 'Arguments for the selected method, exactly as described in the game protocol. Writes require the real expectedVersion; new drafts use null.', additionalProperties: true },
      actor: { type: 'object', properties: { kind: { type: 'string', enum: ['assistant', 'character'] }, npcId: { type: 'string' }, channelId: { type: 'string' } }, required: ['kind'], additionalProperties: false },
    }, required: ['method', 'params'], additionalProperties: false },
  },
}));

/** Native and JSON requests converge before file execution, never around its permissions or commit checks. */
export function createActionNativeTools(settings?: Record<string, string> | null, execute?: WebToolExecutor) {
  const web = createActionWebTools(settings, execute);
  if (!web) return undefined;
  return { ...web, definitions: [...web.definitions, ...gateways], handoff: (name: string, params: unknown) => {
    // The outer parser must retain invalid commands too, so a failed write cannot turn into an unsupported success.
    if (name === 'toolRequest' || name === 'workspaceRequest') return JSON.stringify({ [name]: params ?? {} });
    return undefined;
  } };
}

export const NATIVE_ACTION_TOOL_GUIDE = `\n## 原生行动工具入口\n本次也注册了 toolRequest、workspaceRequest 原生函数；参数直接使用上文的 method、params 和可选 actor，不再套同名外壳。文件、历史、人物设定及游戏操作可单独调用 toolRequest；workspaceRequest 兼容文件操作。两者与游戏 JSON 中的结构化请求进入同一执行流程，权限和暂存规则相同。每轮只请求一个行动工具，收到真实回执后继续；原生调用时不输出游戏 JSON。仍可直接在游戏 JSON 返回 workspaceRequest/toolRequest，尤其需要先呈现普通 segments 时。原生函数列表没有 files.read 等带点的函数名，文件方法放在 method 字段。工具失败不代表整体缺少文件权限；根据具体回执修正通道、参数或版本，不把内部格式错误制成玩家文档。\n`;
