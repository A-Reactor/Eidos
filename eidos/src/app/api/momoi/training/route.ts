// Local-only persistent training API. GET status/environment/voice, POST upload+prepare,
// PATCH review+train/cancel/retry/recover/delete-weights (confirmed:true). Local outputs only.
// Errors: 400 input, 403 origin, 404 missing job, 409 active job, 413 size, 422 setup, 500 worker.
import { readJsonObject, RequestInputError } from '@/lib/api/request-input';
import { checkTrainingPhase, selectedTrainingVoice, trainingStore } from '@/lib/game/momoi/training-server';
import { inspectTrainingEnvironment } from '@/lib/game/momoi/training-runtime';
import fs from 'node:fs';
export const runtime = 'nodejs';
function sameOrigin(request: Request) {
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin || request.headers.get('sec-fetch-site') === 'cross-site') throw new RequestInputError('不允许跨站训练请求', 403);
}
function failure(error: unknown) {
  return Response.json({ error: error instanceof Error ? error.message : '训练操作失败' }, { status: error instanceof RequestInputError ? error.status : 500 });
}
export async function GET(request: Request) {
  try {
    sameOrigin(request);
    const query = new URL(request.url).searchParams, store = trainingStore();
    if (query.get('view') === 'environment') return Response.json(await inspectTrainingEnvironment());
    if (query.get('view') === 'voice') {
      const job = store.get(query.get('id') ?? '');
      if (job.status !== 'complete' || !job.result) throw new RequestInputError('音色尚未训练完成');
      const selected = selectedTrainingVoice(job, query);
      for (const [label, file] of [['GPT', selected.result!.gptWeights], ['SoVITS', selected.result!.sovitsWeights]]) {
        if (!fs.existsSync(file) || !fs.statSync(file).isFile() || !fs.statSync(file).size) throw new RequestInputError(`${label} 模型文件不存在或已被移动，请检查训练目录后重试`, 422);
      }
      return Response.json({ job: selected, referenceAudio: store.audio(job.id, job.result.referenceId).toString('base64') }, { headers: { 'Cache-Control': 'no-store' } });
    }
    return Response.json({ jobs: store.list() }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const input = await readJsonObject(request, 42 * 1024 * 1024);
    return Response.json({ job: await trainingStore().create(input) }, { status: 202 });
  } catch (error) { return failure(error); }
}
export async function PATCH(request: Request) {
  try {
    sameOrigin(request);
    const input = await readJsonObject(request, 512 * 1024);
    await checkTrainingPhase(input);
    return Response.json({ job: await trainingStore().action(input) });
  } catch (error) { return failure(error); }
}
