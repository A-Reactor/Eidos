import { afterEach, describe, expect, it, vi } from 'vitest';
import { logGameRuntimeEvent, startGameRuntimeSpan } from '@/lib/game/runtime-log';
import { POST } from '@/app/api/game/runtime-log/route';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('game diagnostics in the running terminal', () => {
  it('relays browser review events to server stdout with identifiers and elapsed time', async () => {
    const sendBeacon = vi.fn(() => true);
    vi.stubGlobal('window', {});
    vi.stubGlobal('navigator', { sendBeacon });
    const output = vi.spyOn(console, 'info').mockImplementation(() => {});
    logGameRuntimeEvent({ engine: 'KEI', mode: 'background', phase: 'succeeded', timestamp: 1000,
      durationMs: 1234, level: 'quality', trigger: 'narrative_stall', actionId: 'action-1',
      worldId: 'world-1', requestId: 'review-1', apiKey: 'PRIVATE_KEY', prompt: 'PRIVATE_TEXT' } as never);
    expect(output).not.toHaveBeenCalled();
    const [url, payload] = sendBeacon.mock.calls[0] as unknown as [string, Blob];
    expect(url).toBe('/api/game/runtime-log');
    const response = await POST(new Request(`http://localhost${url}`, { method: 'POST', body: await payload.text() }));
    expect(response.status).toBe(204);
    expect(output).toHaveBeenCalledOnce();
    expect(output.mock.calls[0][0]).toContain('[KEI] 后台审核 succeeded');
    expect(output.mock.calls[0][0]).toContain('durationMs=1234');
    expect(output.mock.calls[0][0]).toContain('actionId=action-1');
    expect(output.mock.calls[0][0]).not.toContain('PRIVATE_');
  });

  it('logs an ALICE request and its first text with continuous timing and one terminal result', () => {
    vi.useFakeTimers(); vi.setSystemTime(1000);
    const output = vi.spyOn(console, 'info').mockImplementation(() => {});
    const log = startGameRuntimeSpan({ engine: 'ALICE', mode: 'action', scope: 'world:run:node' });
    vi.setSystemTime(1250); log('first_text');
    vi.setSystemTime(1800); log('succeeded'); log('failed', 'late_callback');
    expect(output).toHaveBeenCalledTimes(3);
    expect(output.mock.calls[1][0]).toContain('first_text');
    expect(output.mock.calls[1][0]).toContain('durationMs=250');
    expect(output.mock.calls[2][0]).toContain('succeeded');
    expect(output.mock.calls[2][0]).toContain('durationMs=800');
    const ids = output.mock.calls.map(([line]) => String(line).match(/requestId=([^ ]+)/)?.[1]);
    expect(new Set(ids).size).toBe(1);
  });

  it('ignores malformed diagnostic requests and strips extra server-side fields', async () => {
    const output = vi.spyOn(console, 'info').mockImplementation(() => {});
    const send = (body: unknown) => POST(new Request('http://localhost/api/game/runtime-log', { method: 'POST', body: JSON.stringify(body) }));
    expect((await send({ engine: 'KEI', mode: 'blocking', phase: 'started', timestamp: 1e100 })).status).toBe(400);
    expect((await send({ engine: 'KEI', mode: 'unknown', phase: 'started', timestamp: 0 })).status).toBe(400);
    expect(output).not.toHaveBeenCalled();
    expect((await send({ engine: 'KEI', mode: 'blocking', phase: 'started', timestamp: 0,
      reason: 'test\nline', settings: { apiKey: 'PRIVATE_KEY' } })).status).toBe(204);
    expect(output.mock.calls[0][0]).toContain('关键复核 started reason=test line');
    expect(output.mock.calls[0][0]).not.toContain('PRIVATE_KEY');
  });

  it('keeps logging failures outside the action pipeline', () => {
    vi.stubGlobal('window', {});
    vi.stubGlobal('navigator', { sendBeacon: () => { throw new Error('transport unavailable'); } });
    expect(() => startGameRuntimeSpan({ engine: 'ALICE', mode: 'prediction_wait' })('fallback', 'timeout')).not.toThrow();
    vi.stubGlobal('navigator', {});
    expect(() => logGameRuntimeEvent({ engine: 'KEI', mode: 'review', phase: 'skipped', timestamp: 0 })).not.toThrow();
  });
});
