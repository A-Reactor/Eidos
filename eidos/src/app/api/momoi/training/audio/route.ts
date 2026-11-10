import { trainingStore } from '@/lib/game/momoi/training-server';
import { RequestInputError } from '@/lib/api/request-input';
export const runtime = 'nodejs';
export async function GET(request: Request) {
  try {
    const origin = request.headers.get('origin');
    if (origin && origin !== new URL(request.url).origin || request.headers.get('sec-fetch-site') === 'cross-site') throw new RequestInputError('不允许跨站读取素材', 403);
    const query = new URL(request.url).searchParams;
    const bytes = trainingStore().audio(query.get('id') ?? '', query.get('clip') ?? '');
    const headers = new Headers({ 'Content-Type': 'audio/wav', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Accept-Ranges': 'bytes' });
    // WebKit probes the first two bytes before loading media; a full 200 response
    // to that probe leaves the Tauri player unable to load duration or start playback.
    const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get('range') ?? '');
    if (range && (range[1] || range[2])) {
      const start = range[1] ? Number(range[1]) : Math.max(0, bytes.length - Number(range[2]));
      const end = range[1] && range[2] ? Math.min(Number(range[2]), bytes.length - 1) : bytes.length - 1;
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= bytes.length || end < start) {
        headers.set('Content-Range', `bytes */${bytes.length}`);
        headers.set('Content-Length', '0');
        return new Response(null, { status: 416, headers });
      }
      headers.set('Content-Range', `bytes ${start}-${end}/${bytes.length}`);
      headers.set('Content-Length', String(end - start + 1));
      return new Response(new Uint8Array(bytes.subarray(start, end + 1)), { status: 206, headers });
    }
    headers.set('Content-Length', String(bytes.length));
    return new Response(new Uint8Array(bytes), { headers });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : '片段读取失败' }, { status: error instanceof RequestInputError ? error.status : 500 });
  }
}
