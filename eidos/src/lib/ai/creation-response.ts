/** Heartbeats keep idle proxies alive while the model reasons; no generation time limit. */
export function creationResponse(request: Request, run: (send: (event: Record<string, unknown>) => void, signal: AbortSignal) => Promise<void>) {
  const abort = new AbortController();
  const signal = AbortSignal.any([request.signal, abort.signal]);
  const encoder = new TextEncoder();
  let closed = false;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: Record<string, unknown>) => {
        if (!closed) controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };
      heartbeat = setInterval(() => send({ type: "heartbeat" }), 15000);
      try { await run(send, signal); }
      catch (error) { send({ type: "error", message: error instanceof Error ? error.message : "生成中断，已收到的材料可继续使用" }); }
      finally { clearInterval(heartbeat); if (!closed) { closed = true; controller.close(); } }
    },
    cancel() { closed = true; clearInterval(heartbeat); abort.abort(); },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no", Connection: "keep-alive" } });
}
