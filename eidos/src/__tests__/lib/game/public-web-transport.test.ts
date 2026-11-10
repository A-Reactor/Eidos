import { afterEach, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { lookup } from 'node:dns/promises';
import { request as httpsRequest } from 'node:https';
import type { ClientRequest, IncomingMessage, RequestOptions } from 'node:http';
import { requestPublicText } from '@/lib/server/public-web';
vi.mock('node:dns/promises', () => ({ lookup: vi.fn() }));
vi.mock('node:https', () => ({ request: vi.fn() }));
afterEach(() => { vi.resetAllMocks(); vi.unstubAllEnvs(); });

function transport(pages: Array<{ status?: number; location?: string; text?: string }>) {
  const pinned: unknown[] = [];
  vi.mocked(lookup).mockResolvedValue([{ address: '8.8.8.8', family: 4 }] as never);
  vi.mocked(httpsRequest).mockImplementation(((url: URL, options: RequestOptions, receive: (res: IncomingMessage) => void) => {
    const req = Object.assign(new EventEmitter(), { end() {
      options.lookup!(url.hostname, { all: true }, (error, address) => {
        if (error) { req.emit('error', error); return; }
        pinned.push(address);
        const page = pages.shift()!;
        const res = Object.assign(new PassThrough(), { statusCode: page.status ?? 200,
          headers: { 'content-type': 'text/plain; charset=utf-8', ...(page.location ? { location: page.location } : {}) } });
        receive(res as unknown as IncomingMessage);
        res.end(page.text ?? 'public body');
      });
    } });
    return req as ClientRequest;
  }) as typeof httpsRequest);
  return pinned;
}
it('connects using only the DNS addresses that were checked', async () => {
  const pinned = transport([{}]);
  expect((await requestPublicText('https://example.com/')).text).toBe('public body');
  expect(pinned).toEqual([[{ address: '8.8.8.8', family: 4 }]]);
});
it('refuses a public hostname whose DNS points into the local network', async () => {
  transport([{}]);
  vi.mocked(lookup).mockResolvedValue([{ address: '192.168.1.2', family: 4 }] as never);
  await expect(requestPublicText('https://example.com/')).rejects.toThrow('非公网');
});
it('checks every redirect rather than allowing a public page to reach localhost', async () => {
  transport([{ status: 302, location: 'http://127.0.0.1/private' }]);
  await expect(requestPublicText('https://example.com/')).rejects.toThrow('公网');
  expect(httpsRequest).toHaveBeenCalledTimes(1);
});
it('checks the destination DNS again when a redirect changes hosts', async () => {
  transport([{ status: 302, location: 'https://other.example/private' }, {}]);
  vi.mocked(lookup).mockResolvedValueOnce([{ address: '8.8.8.8', family: 4 }] as never)
    .mockResolvedValueOnce([{ address: '10.1.2.3', family: 4 }] as never);
  await expect(requestPublicText('https://example.com/')).rejects.toThrow('非公网');
});
it('limits downloaded bytes before parsing a large webpage', async () => {
  transport([{ text: 'x'.repeat(2 * 1024 * 1024 + 1) }]);
  await expect(requestPublicText('https://example.com/')).rejects.toThrow('2 MiB');
});
