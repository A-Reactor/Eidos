import { readJsonObject, inputErrorResponse, RequestInputError } from '@/lib/api/request-input';
import { creationResponse } from '@/lib/ai/creation-response';
import { runSourceTask, SourceLookupNeeded } from '@/lib/ai/source-reconstruction/runner';
import { assertSourceTask, SourceTaskError } from '@/lib/game/source-reconstruction/task-protocol';
import { isRecord } from '@/lib/game/source-reconstruction/validation';

export async function POST(request: Request): Promise<Response> {
  try {
    const body = await readJsonObject(request);
    assertSourceTask(body.task);
    const task = body.task;
    const settings = isRecord(body._settings) ? body._settings as Record<string, string> : undefined;
    return creationResponse(request, async (send, signal) => {
      send({ type: 'started', taskId: task.taskId });
      try {
        const result = await runSourceTask(task, { signal, settings, onUsage: usage => send({ type: 'usage', usage }) });
        send({ type: 'checkpoint', checkpoint: result });
        send({ type: 'done', result });
      } catch (error) {
        if (error instanceof SourceLookupNeeded) { send({ type: 'lookup', lookup: error.lookup }); return; }
        throw error;
      }
    });
  } catch (error) { return inputErrorResponse(error instanceof SourceTaskError ? new RequestInputError(error.message, error.status) : error); }
}
