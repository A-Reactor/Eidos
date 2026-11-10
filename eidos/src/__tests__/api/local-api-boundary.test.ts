import { NextRequest } from 'next/server';
import { expect, it } from 'vitest';
import * as boundary from '@/proxy';

function request(path: string, headers: HeadersInit) {
  return new NextRequest(`http://localhost:3000${path}`, { method: 'POST', headers });
}

it('blocks foreign Host and browser origins before local process and file routes execute', () => {
  expect(typeof boundary.proxy).toBe('function');
  const path = '/api/momoi/start';
  for (const headers of [
    { host: 'rebound.example:3000' },
    { host: 'localhost:3000', origin: 'http://localhost:4197' },
    { host: '127.0.0.1:3000', 'sec-fetch-site': 'cross-site' },
    { host: '127.0.0.1:3000', 'sec-fetch-site': 'same-site' },
    { 'x-forwarded-host': 'localhost:3000' },
  ] as HeadersInit[]) {
    expect(boundary.proxy(request(path, headers))?.status).toBe(403);
  }
});

it('allows same-origin app and local command-line clients and preserves the bearer-token endpoint', () => {
  expect(boundary.proxy(request('/api/momoi/stop', { host: 'localhost:3000' }))).toBeUndefined();
  expect(boundary.proxy(request('/api/midori/upload-image', {
    host: '127.0.0.1:3000', origin: 'http://127.0.0.1:3000', 'sec-fetch-site': 'same-origin',
  }))).toBeUndefined();
  expect(boundary.proxy(request('/api/engine/v1/narrate', { host: 'games.example' }))).toBeUndefined();
});
