import { expect, it } from 'vitest';
import { readJsonObject } from '@/lib/api/request-input';
it('enforces the actual streamed byte count when Content-Length is missing', async () => {
  const body = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('{"text":"超长数据"}')); c.close(); } });
  const request = new Request('http://localhost/api', { method: 'POST', body, duplex: 'half' } as RequestInit);
  await expect(readJsonObject(request, 10)).rejects.toMatchObject({ status: 413 });
});
it('permits valid same-origin JSON and rejects malformed UTF-8', async () => {
  expect(await readJsonObject(new Request('http://localhost/api', { method: 'POST', body: '{"text":"你好"}', headers: { origin: 'http://localhost' } }))).toEqual({ text: '你好' });
  await expect(readJsonObject(new Request('http://localhost/api', { method: 'POST', body: new Uint8Array([123, 255, 125]) }))).rejects.toMatchObject({ status: 400 });
});
