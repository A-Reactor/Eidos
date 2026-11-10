import { parseGameRuntimeEvent, writeGameRuntimeEvent } from '@/lib/game/runtime-log';

export async function POST(request: Request): Promise<Response> {
  try {
    const event = parseGameRuntimeEvent(await request.json());
    if (!event) return new Response(null, { status: 400 });
    writeGameRuntimeEvent(event);
    return new Response(null, { status: 204 });
  } catch {
    return new Response(null, { status: 400 });
  }
}
