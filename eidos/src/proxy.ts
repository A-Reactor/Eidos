import type { NextRequest } from 'next/server';

const loopbackHost = /^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?$/iu;

function isLocalAppRequest(request: NextRequest): boolean {
  // Check the actual Host header to reject DNS rebinding, even when Next uses a local internal URL.
  const host = request.headers.get('host');
  if (!host || !loopbackHost.test(host)) return false;
  const site = request.headers.get('sec-fetch-site');
  if (site === 'cross-site' || site === 'same-site') return false;
  const origin = request.headers.get('origin');
  if (origin === null) return true;
  try {
    return origin === new URL(`${request.nextUrl.protocol}//${host}`).origin;
  } catch {
    return false;
  }
}

export function proxy(request: NextRequest): Response | undefined {
  // This developer endpoint has its own bearer token and request validation.
  if (request.nextUrl.pathname === '/api/engine/v1/narrate' || isLocalAppRequest(request)) return;
  return Response.json({ error: '应用 API 仅接受来自本机的同源请求。' }, { status: 403 });
}

export const config = { matcher: ['/api/:path*', '/generated/:path*'] };
