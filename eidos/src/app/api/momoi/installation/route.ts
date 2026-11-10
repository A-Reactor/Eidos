// Same-origin, read-only inspection. POST {provider,endpoint?,models}; max 2 concurrent checks.
// No installation/download/translation. 400 malformed, 403 cross-site, 429 busy.
import { readJsonObject, RequestInputError, inputErrorResponse } from '@/lib/api/request-input';
import { inspectVoiceInstallation } from '@/lib/game/momoi/installation-server';
import { allowedFields, PluginInputError } from '@/lib/game/plugins/validation';
let active = 0;
export async function POST(request: Request) {
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin || request.headers.get('sec-fetch-site') === 'cross-site') return Response.json({ error: '不允许跨站检查' }, { status: 403 });
  let counted = false;
  try {
    const body = await readJsonObject(request, 128 * 1024);
    allowedFields(body, ['provider', 'endpoint', 'models']);
    if (!['legacy', 'gpt-sovits', 'compatible'].includes(String(body.provider)) || !Array.isArray(body.models) || !body.models.length || body.models.length > 24) throw new RequestInputError('检查服务或模型数量无效');
    const models = body.models.map((model: { gptWeights?: string; sovitsWeights?: string }) => {
      if (!model || typeof model !== 'object' || Array.isArray(model)) throw new RequestInputError('权重参数无效');
      allowedFields(model, ['gptWeights', 'sovitsWeights']);
      for (const value of Object.values(model)) if (typeof value !== 'string' || value.length > 2000 || value.includes('\0')) throw new RequestInputError('权重路径无效');
      if (Boolean(model.gptWeights) !== Boolean(model.sovitsWeights)) throw new RequestInputError('GPT 与 SoVITS 权重须成对检查');
      return model;
    });
    let reason = body.provider === 'compatible' ? '当前只检查 GPT-SoVITS 的语言能力' : '';
    if (body.provider === 'gpt-sovits') {
      let url: URL;
      try { url = new URL(String(body.endpoint)); } catch { throw new RequestInputError('服务地址无效'); }
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new RequestInputError('服务地址无效');
      if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) reason = '无法在本机核实远程 API v2 的权重与语言资源';
      else if (models.some(model => !model.gptWeights)) reason = 'API v2 需要明确指定 GPT 与 SoVITS 权重后才能核实语言';
    }
    if (reason) return Response.json({ checks: [{ label: '模型语言检查', ready: false, detail: reason }], languageResources: [], models: models.map(() => ({ ready: false, languages: [], error: reason })) });
    if (active >= 2) throw new RequestInputError('安装检查正在运行，请稍后重试', 429);
    active++; counted = true;
    try { return Response.json(await inspectVoiceInstallation(models, request.signal)); }
    catch (error) {
      const detail = error instanceof Error ? error.message : '检查失败';
      return Response.json({ checks: [{ label: 'Python / 检查程序', ready: false, detail }], languageResources: [], models: models.map(() => ({ ready: false, languages: [], error: detail })) });
    }
  } catch (error) {
    if (error instanceof RequestInputError || error instanceof PluginInputError) return inputErrorResponse(error);
    return Response.json({ error: '安装检查失败' }, { status: 500 });
  } finally { if (counted) active--; }
}
