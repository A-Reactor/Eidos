import { inputErrorResponse, readJsonObject, RequestInputError } from '@/lib/api/request-input';
import { parseWebToolRequest } from '@/lib/game/web-tools';
import { executeWebTool } from '@/lib/server/web-tools';
import { resolveAiRoleConfig } from '@/lib/ai/providers/config';
import { loadSettings } from '@/lib/game/settings';

export const runtime = 'nodejs';
let active = 0;
export async function POST(request: Request): Promise<Response> {
  let counted = false;
  try {
    const body = await readJsonObject(request, 32000);
    let tool;
    try { tool = parseWebToolRequest(body); }
    catch (error) { throw new RequestInputError(error instanceof Error ? error.message : '联网工具参数无效'); }
    const settings = body._settings;
    if (settings !== undefined && (!settings || typeof settings !== 'object' || Array.isArray(settings) ||
      Object.entries(settings).some(([key, value]) => !['aliceProviderId', 'aliceEndpoint', 'aliceApiKey'].includes(key) || typeof value !== 'string' || value.length > 8192))) throw new RequestInputError('联网工具设置无效');
    const override = settings as Record<string, string> | undefined;
    const config = resolveAiRoleConfig('alice', { ...loadSettings(), ...override }, override);
    if (active >= 8) throw new RequestInputError('联网任务繁忙，请稍后再试', 429);
    active++; counted = true;
    return Response.json(await executeWebTool(tool, request.signal, config));
  } catch (error) {
    if (error instanceof RequestInputError) return inputErrorResponse(error);
    return Response.json({ error: request.signal.aborted ? '联网请求已取消' : '联网服务失败' }, { status: request.signal.aborted ? 499 : 502 });
  } finally { if (counted) active--; }
}
