import { readJsonObject, RequestInputError, inputErrorResponse } from '@/lib/api/request-input';
import { parseNpcProfileReviewInput, PROFILE_SETTING_KEYS } from '@/lib/game/npc-profile-tools';
import { reviewNpcProfile } from '@/lib/ai/npc-profile-review';

let active = 0;
export async function POST(request: Request): Promise<Response> {
  let counted = false;
  try {
    const body = await readJsonObject(request, 96000);
    let input;
    try { input = parseNpcProfileReviewInput(body); }
    catch (error) { throw new RequestInputError(error instanceof Error ? error.message : '人设审核材料无效'); }
    const settings = body._settings;
    if (settings !== undefined && (!settings || typeof settings !== 'object' || Array.isArray(settings) || Object.entries(settings).some(([key, value]) =>
      !(PROFILE_SETTING_KEYS as readonly string[]).includes(key) || !['string', 'boolean', 'number'].includes(typeof value) || String(value).length > 8192))) throw new RequestInputError('KEI审核配置无效');
    if (active >= 4) throw new RequestInputError('KEI人设审核繁忙，请稍后重试', 429);
    active++; counted = true;
    return Response.json(await reviewNpcProfile(input, settings as Record<string, string> | undefined, request.signal));
  } catch (error) {
    if (error instanceof RequestInputError) return inputErrorResponse(error);
    const usage = error && typeof error === 'object' && 'usage' in error ? error.usage : undefined;
    return Response.json({ approved: false, reason: error instanceof Error ? `KEI审核未完成：${error.message}` : 'KEI审核未完成，人设没有修改', usage }, { status: request.signal.aborted ? 499 : 502 });
  } finally { if (counted) active--; }
}
