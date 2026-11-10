import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ health: vi.fn(), process: vi.fn() }));
vi.mock("@/lib/game/momoi/client", () => ({ momoiClient: { healthCheck: mocks.health } }));
vi.mock("@/lib/game/momoi/process-guard", () => ({ checkStaleProcess: mocks.process }));
import { GET } from "@/app/api/momoi/status/route";
beforeEach(() => { mocks.health.mockReset(); mocks.process.mockReset(); });
describe("MOMOI health reporting", () => {
  it('reports the actual inference device and explains an accelerator fallback', async () => {
    mocks.health.mockResolvedValue({ status: 'ready', device: 'mps', requestedDevice: 'auto', precision: 'float32' });
    const accelerated = await (await GET()).json();
    expect(accelerated).toMatchObject({ device: 'mps', requestedDevice: 'auto', precision: 'float32' });
    expect(accelerated.hint).toContain('MPS');
    mocks.health.mockResolvedValue({ status: 'ready', device: 'cpu', requestedDevice: 'auto', fallbackReason: 'MPS 算子不兼容，已回退 CPU' });
    const fallback = await (await GET()).json();
    expect(fallback.device).toBe('cpu');
    expect(fallback.hint).toContain('MPS 算子不兼容，已回退 CPU');
  });
  it.each([["ready", "ready"], ["loading_model", "loading"], ["error", "error"]])("reports %s without requiring a managed process", async (raw, expected) => {
    mocks.health.mockResolvedValue({ status: raw });
    expect((await (await GET()).json()).status).toBe(expected);
  });
  it("does not mistake a dead PID file for a busy model", async () => {
    mocks.health.mockRejectedValue(new Error("unreachable"));
    mocks.process.mockReturnValue({ isAlive: false });
    expect((await (await GET()).json()).status).toBe("offline");
  });
  it("reports a living but unresponsive process without claiming readiness", async () => {
    mocks.health.mockRejectedValue(new Error("timeout"));
    mocks.process.mockReturnValue({ isAlive: true });
    expect((await (await GET()).json()).status).toBe("busy");
  });
  it("keeps a newly launched process in loading while Python preloads before opening HTTP", async () => {
    mocks.health.mockRejectedValue(new Error("unreachable"));
    mocks.process.mockReturnValue({ isAlive: true, ageSeconds: 20 });
    expect((await (await GET()).json()).status).toBe("loading");
  });
  it("preserves the model loading error for the player", async () => {
    mocks.health.mockResolvedValue({ status: "error", error: "Model file missing" });
    expect((await (await GET()).json()).error).toBe("Model file missing");
  });
});
