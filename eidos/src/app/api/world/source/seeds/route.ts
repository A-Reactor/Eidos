import { readJsonObject, inputErrorResponse, RequestInputError } from '@/lib/api/request-input';
import { creationResponse } from '@/lib/ai/creation-response';
import { generateReconstructionSeeds } from '@/lib/ai/source-reconstruction/seeds';
import { isRecord } from '@/lib/game/source-reconstruction/validation';
import { readWorldCreationInput } from '@/lib/ai/world-creation-compiler';
import type { SourceReconstructionArchive } from '@/lib/game/source-reconstruction/types';

export async function POST(request: Request) {
  try {
    const body = await readJsonObject(request);
    if (!isRecord(body.npcs) || Object.values(body.npcs).some(v => typeof v !== 'string') || !isRecord(body.source) || body.source.schemaVersion !== 2 || !isRecord(body.source.entityMap)) throw new RequestInputError('人物资料无效');
    readWorldCreationInput({ brief: body.source.brief, sourceDossier: body.source.dossier });
    const settings = isRecord(body._settings) ? body._settings as Record<string, string> : undefined;
    return creationResponse(request, async (send, signal) => {
      const seeds = await generateReconstructionSeeds(body.npcs as Record<string, string>, body.source as unknown as SourceReconstructionArchive, { signal, settings, onUsage: usage => send({ type: 'usage', usage }) });
      send({ type: 'done', seeds });
    });
  } catch (error) { return inputErrorResponse(error); }
}
