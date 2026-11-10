import { validateWorkspaceContext } from '@/lib/ai/workspace-tools';
import { validateCardContext } from '@/lib/game/cards/validation';
import { parseNarrativeRequest } from '@/lib/game/narrative';
import { normalizeGameplayResources } from '@/lib/game/plugins/resources';
import { resolveGameplayPlugins } from '@/lib/game/plugins/builtins';
import { parseGameplayPlugins, validateGameModeConfig } from '@/lib/game/plugins/manifest';
import { parseImageCatalog } from '@/lib/game/midori/image-context';
import { parseActionImages } from '@/lib/ai/action-images';

export class RequestInputError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}
export async function readJsonObject(request: Request, maxBytes = 2 * 1024 * 1024, signal?: AbortSignal): Promise<Record<string, unknown>> {
  signal?.throwIfAborted();
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin || request.headers.get('sec-fetch-site') === 'cross-site') throw new RequestInputError('不允许跨站请求', 403);
  if (Number(request.headers.get('content-length')) > maxBytes) throw new RequestInputError('请求内容过大', 413);
  const reader = request.body?.getReader();
  if (!reader) throw new RequestInputError('请求体为空');
  const chunks: Uint8Array[] = [];
  let size = 0;
  // Canceling an in-flight body read must release the route's deadline/capacity too.
  const abort = () => { void reader.cancel(signal?.reason).catch(() => undefined); };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    while (true) {
      const { done, value } = await reader.read();
      signal?.throwIfAborted();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) { await reader.cancel(); throw new RequestInputError('请求内容过大', 413); }
      chunks.push(value);
    }
  } finally { signal?.removeEventListener('abort', abort); reader.releaseLock(); }
  try {
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('object required');
    return value as Record<string, unknown>;
  } catch { throw new RequestInputError('请求体须为有效 JSON 对象'); }
}
export function creationPluginInput(body: Record<string, unknown>) {
  const gameplayPlugins = parseGameplayPlugins(body.gameplayPlugins);
  const ids = body.skillIds === undefined ? [] : body.skillIds;
  resolveGameplayPlugins(ids, gameplayPlugins);
  return { skillIds: ids as string[], gameplayPlugins };
}
const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
export function validateActionInput(body: Record<string, unknown>): void {
  try { body.imageInputs = parseActionImages(body.imageInputs); }
  catch (error) { throw new RequestInputError(error instanceof Error ? error.message : '识图输入无效'); }
  try { body.imageCatalog = parseImageCatalog(body.imageCatalog); }
  catch (error) { throw new RequestInputError(error instanceof Error ? error.message : '图像目录无效'); }
  try { body.workspaceContext = validateWorkspaceContext(body.workspaceContext); }
  catch (error) { throw new RequestInputError(error instanceof Error ? error.message : '工作区上下文无效'); }
  if (body.documentMode !== undefined && typeof body.documentMode !== 'boolean') throw new RequestInputError('documentMode 必须是布尔值');
  try {
    const world = isObject(body.world) ? body.world : {};
    validateCardContext(body.cardContext, world.cardBindings, typeof world.cardContextMaxChars === 'number' ? world.cardContextMaxChars : undefined);
  } catch (error) { throw new RequestInputError(error instanceof Error ? error.message : '卡片上下文无效'); }
  try { parseNarrativeRequest(body.narrativeRequest); } catch (error) { throw new RequestInputError(error instanceof Error ? error.message : '叙事请求无效'); }
  if (typeof body.playerInput !== 'string' || !body.playerInput.trim() || body.playerInput.length > 20_000) throw new RequestInputError('行动须为 1–20000 字符');
  const snapshot = body.snapshot;
  if (!isObject(snapshot) || typeof snapshot.currentSceneId !== 'string' || !isObject(snapshot.currentGameTime) || !isObject(snapshot.sceneDetailLevels) || !isObject(snapshot.discoveredSecrets) || !isObject(snapshot.worldFlags) || snapshot.npcStates !== undefined && !isObject(snapshot.npcStates)) throw new RequestInputError('世界快照无效');
  const time = snapshot.currentGameTime;
  if (['day', 'hour', 'minute'].some(key => typeof time[key] !== 'number' || !Number.isFinite(time[key]))) throw new RequestInputError('世界时间无效');
  for (const key of ['recentHistory', 'inventory', 'clues', 'encyclopedia', 'criticalFacts', 'questLog', '_sandboxToolAudit']) {
    if (body[key] !== undefined && !Array.isArray(body[key])) throw new RequestInputError(`${key} 须为列表`);
  }
  if (body.world !== undefined && body.world !== null) {
    if (!isObject(body.world) || typeof body.world.name !== 'string' || !isObject(body.world.regions) || !isObject(body.world.npcs)) throw new RequestInputError('世界定义无效');
    parseGameplayPlugins(body.world.gameplayPlugins);
    validateGameModeConfig(body.world.gameModeConfig);
  }
  normalizeGameplayResources(isObject(body.world) ? body.world : {}, snapshot.gameplayResources);
}
export function inputErrorResponse(error: unknown): Response {
  return Response.json({ error: error instanceof Error ? error.message : '请求无效' }, { status: error instanceof RequestInputError ? error.status : 400 });
}
