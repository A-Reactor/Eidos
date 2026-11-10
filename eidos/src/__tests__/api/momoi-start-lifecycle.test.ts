import { afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ cleanup: vi.fn(), stale: vi.fn(), spawn: vi.fn() }));
vi.mock("@/lib/game/momoi/config", () => ({ getActualPort: () => 7872, MOMOI_PYTHON_PORT: 7872, findFreePort: vi.fn(), killPort: vi.fn(), setActualPort: vi.fn() }));
vi.mock("@/lib/game/momoi/process-guard", () => ({ checkStaleProcess: mocks.stale, cleanupStaleProcess: mocks.cleanup, guardProcess: vi.fn(), getGuardStatus: vi.fn() }));
vi.mock("child_process", () => ({ spawn: mocks.spawn }));
vi.mock('@/lib/game/momoi/training-runtime', () => ({ resolveVoicePython: async () => 'python3' }));
import { POST } from "@/app/api/momoi/start/route";
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });
describe("local voice startup lifecycle", () => {
  it("keeps a healthy existing model alive instead of cleaning its PID first", async () => {
    mocks.stale.mockReturnValue({ isAlive: true });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ status: "ready" }) }));
    expect((await (await POST()).json()).status).toBe("already_running");
    expect(mocks.cleanup).not.toHaveBeenCalled();
    expect(mocks.spawn).not.toHaveBeenCalled();
  });
  it("locks before asynchronous health checks so simultaneous clicks cannot start duplicate models", async () => {
    let finish!: (value: unknown) => void;
    const fetch = vi.fn(() => new Promise(resolve => { finish = resolve; }));
    vi.stubGlobal("fetch", fetch);
    const first = POST();
    const second = await POST();
    expect((await second.json()).status).toBe("loading_model");
    expect(fetch).toHaveBeenCalledOnce();
    finish({ ok: true, json: async () => ({ status: "ready" }) });
    expect((await (await first).json()).status).toBe("already_running");
    expect(mocks.spawn).not.toHaveBeenCalled();
  });
});
