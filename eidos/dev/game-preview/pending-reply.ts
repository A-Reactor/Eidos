import type { AIGameResponse } from '@/lib/ai/types';

const pending = new Set<(failed: boolean) => void>();
const encode = (event: object) => new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`);

/** Hold a real readable stream locally so record navigation is reproducible without a paid request. */
export function previewPendingReply(url: string, response: Partial<AIGameResponse>): Response | undefined {
  if (!url.includes('/api/game/action/stream') || new URLSearchParams(location.search).get('reply') !== 'hold') return;
  let finish: (failed: boolean) => void;
  return new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encode({ type: 'segments', segments: response.segments?.slice(0, 1) ?? [], lastIsDraft: true }));
      finish = failed => {
        pending.delete(finish);
        if (failed) controller.enqueue(encode({ type: 'error', message: '固定测试：生成中断' }));
        else {
          // Match the production stream: finish prose first, then metadata without a second copy.
          if (response.segments?.length) controller.enqueue(encode({ type: 'segments', segments: response.segments, lastIsDraft: false }));
          controller.enqueue(encode({ type: 'done', ...response,
            segments: response.segments?.length ? undefined : response.segments,
            narrative: response.segments?.length ? undefined : response.narrative,
            dialogue: response.segments?.length ? undefined : response.dialogue }));
        }
        controller.close();
      };
      pending.add(finish);
    },
    cancel() { pending.delete(finish); },
  }), { headers: { 'Content-Type': 'text/event-stream' } });
}

export function finishPendingPreview(failed = false) {
  for (const finish of pending) finish(failed);
}
