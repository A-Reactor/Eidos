// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { webcrypto } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { prefetchVoices } from "@/lib/game/momoi/prefetch";
import { useGameStore } from "@/store/game-store";
import { readVoiceResources } from "@/lib/game/momoi/resource-storage";
import { voiceScope } from "@/lib/game/momoi/runtime";
import { DEFAULT_VOICE_CONFIG } from "@/lib/game/momoi/model";
afterEach(() => vi.unstubAllGlobals());
it("persists every complete dialogue, including unknown speakers and more than four segments", async () => {
  vi.stubGlobal("crypto", webcrypto);
  const inputs: string[] = [];
  vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
    if (_url === '/api/momoi/start') return Response.json({ ok: true, status: 'already_running' });
    inputs.push(JSON.parse(String(init.body)).text);
    return { ok: true, json: async () => ({ audioBase64: "UklGRg==", mimeType: "audio/wav" }) };
  });
  useGameStore.setState({ currentPlaythroughId: "prefetch-test", voiceSession: 100, voiceAssets: {}, voiceAssetScope: null, voiceConfig: DEFAULT_VOICE_CONFIG, momoiSettings: { enabled: true, autoPlay: false, volume: .8, speed: 1 } });
  await prefetchVoices([{ type: "narration", text: "旁白" }, ...Array.from({ length: 6 }, (_, i) => ({ type: "dialogue" as const, text: `对话${i}`, speaker: `陌生人${i}` }))]);
  expect(inputs).toEqual(["对话0", "对话1", "对话2", "对话3", "对话4", "对话5"]);
  expect(Object.keys(await readVoiceResources(voiceScope()))).toHaveLength(6);
  expect(Object.keys(useGameStore.getState().serializeState().voiceAssets!)).toHaveLength(6);
});
