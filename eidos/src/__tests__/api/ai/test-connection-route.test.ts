import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/ai/client", () => ({
  callAi: vi.fn(),
  parseJSON: <T>(raw: string): T => JSON.parse(raw),
}));

import { callAi } from "@/lib/ai/client";
import { POST } from "@/app/api/ai/test-connection/route";

const mockCallAi = callAi as ReturnType<typeof vi.fn>;

function makeRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/ai/test-connection", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

afterEach(() => vi.clearAllMocks());

describe("POST /api/ai/test-connection", () => {
  it("returns ok when the provider answers valid JSON", async () => {
    mockCallAi.mockResolvedValueOnce({
      content: "{\"ok\":true}",
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2, model: "alice" },
      elapsedMs: 25,
    });

    const res = await POST(makeRequest({
      role: "alice",
      settings: { aliceApiKey: "key" },
    }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.elapsedMs).toBe(25);
    expect(mockCallAi).toHaveBeenCalledWith(expect.objectContaining({
      role: "alice",
      jsonMode: true,
      callType: "settings_test_connection",
      noRetry: true,
      timeoutMs: 20000,
      signal: expect.any(AbortSignal),
    }));
  });

  it('reports a response timeout distinctly from a failed connection', async () => {
    mockCallAi.mockRejectedValueOnce(new DOMException('The operation timed out', 'TimeoutError'));
    const res = await POST(makeRequest({ role: 'alice' }));
    expect(res.status).toBe(504);
    expect(await res.json()).toMatchObject({ ok: false, code: 'response_timeout', error: expect.stringContaining('timed out') });
  });

  it('forwards caller cancellation to the model request', async () => {
    const controller = new AbortController();
    const request = new NextRequest('http://localhost/api/ai/test-connection', { method: 'POST', body: JSON.stringify({ role: 'alice' }), signal: controller.signal });
    mockCallAi.mockImplementationOnce(async options => {
      controller.abort();
      expect(options.signal.aborted).toBe(true);
      throw options.signal.reason;
    });
    const res = await POST(request);
    expect(res.status).toBe(499);
    expect(await res.json()).toMatchObject({ code: 'request_cancelled' });
  });

  it("returns 400 for invalid role", async () => {
    const res = await POST(makeRequest({ role: "bad" }));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toContain("role");
    expect(mockCallAi).not.toHaveBeenCalled();
  });
});
