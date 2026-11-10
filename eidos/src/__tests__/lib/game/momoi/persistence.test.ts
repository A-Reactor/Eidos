// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { useGameStore } from "@/store/game-store";
import { DEFAULT_VOICE_CONFIG, type VoiceAsset } from "@/lib/game/momoi/model";
import { readVoiceResources, writeVoiceResources, clearVoiceResources } from "@/lib/game/momoi/resource-storage";
import { getVoiceLibrary, voiceScope } from "@/lib/game/momoi/runtime";
import type { WorldDefinition } from "@/lib/game/types";
const asset: VoiceAsset = { id: "a".repeat(64), text: "你好", speaker: "甲", emotion: "neutral", audioBase64: "UklGRg==", mimeType: "audio/wav", provider: "compatible", model: "test", createdAt: 1 };
const world = { id: "voice-world", name: "语音测试", npcs: {}, regions: {}, clues: [], } as unknown as WorldDefinition;
beforeEach(() => { localStorage.clear(); useGameStore.setState({ currentWorld: world, currentPlaythroughId: crypto.randomUUID(), voiceSession: Date.now(), voiceAssetScope: null, voiceAssets: {}, voiceConfig: DEFAULT_VOICE_CONFIG, sandboxMode: false }); });
describe("voice archive persistence", () => {
  it("stores and deletes audio without leaking between playthroughs or sandboxes", async () => {
    await writeVoiceResources("ordinary", { [asset.id]: asset });
    expect(await readVoiceResources("sandbox")).toEqual({});
    expect((await readVoiceResources("ordinary"))[asset.id].audioBase64).toBe("UklGRg==");
    await writeVoiceResources("ordinary", {});
    expect(await readVoiceResources("ordinary")).toEqual({});
  });
  it("includes audio and casting in saves but excludes service credentials", async () => {
    useGameStore.setState({ voiceAssets: { [asset.id]: asset }, voiceConfig: { ...DEFAULT_VOICE_CONFIG, provider: "compatible", model: "test", voice: "alice" } });
    sessionStorage.setItem("eidos_momoi_key_", "secret");
    const saved = useGameStore.getState().serializeState();
    expect(saved.voiceAssets?.[asset.id].audioBase64).toBe("UklGRg==");
    expect(JSON.stringify(saved)).not.toContain("secret");
    useGameStore.getState().deserializeState(JSON.parse(JSON.stringify(saved)), world);
    expect(useGameStore.getState().voiceAssets[asset.id]).toEqual(asset);
    expect(useGameStore.getState().voiceConfig.voice).toBe("alice");
    const library = await getVoiceLibrary();
    expect(library.assets[asset.id]).toEqual(asset);
  });
  it("keeps an in-flight old scope from changing a newly loaded archive", async () => {
    await writeVoiceResources(voiceScope(), { [asset.id]: asset });
    const old = getVoiceLibrary();
    useGameStore.setState({ currentPlaythroughId: "new-playthrough", voiceSession: Date.now() + 1 });
    await expect(old).rejects.toThrow("存档已切换");
    expect((await getVoiceLibrary()).assets).toEqual({});
  });
  it("loading a legacy save clears settings and audio from the prior game", () => {
    const saved = useGameStore.getState().serializeState(); delete saved.voiceAssets; delete saved.momoiVoiceSettings;
    useGameStore.setState({ voiceAssets: { [asset.id]: asset }, momoiSettings: { enabled: true, autoPlay: false, speed: 2, volume: 0 } });
    useGameStore.getState().deserializeState(saved, world);
    expect(useGameStore.getState().voiceAssets).toEqual({});
    expect(useGameStore.getState().momoiSettings.enabled).toBe(false);
  });
});

it("exports and restores late-generated audio in a new archive scope", async () => {
  const { collectArchiveRecovery, restoreArchiveRecovery } = await import("@/lib/game/archive-transfer");
  const { saveToDB } = await import("@/lib/game/storage");
  const { scopeStorageKey } = await import("@/lib/game/archive-scope");
  const ptId = useGameStore.getState().currentPlaythroughId!;
  const pt = { id: ptId, worldId: world.id, name: "测试周目", worldLineId: "" } as import("@/lib/game/types").PlaythroughMeta;
  const meta = { id: "save_voice", playthroughId: ptId, worldId: world.id } as import("@/lib/game/types").SaveSlot;
  await saveToDB("save_data_save_voice", { meta, world, state: useGameStore.getState().serializeState() });
  await writeVoiceResources(voiceScope(), { [asset.id]: asset });
  const recovery = await collectArchiveRecovery(world.id, [{ ...pt, saves: [meta] }], {});
  const destination = { sandboxMode: true, sandboxDossierId: "voice-roundtrip" };
  const imported = await restoreArchiveRecovery(recovery, { ...world, id: "imported-world" }, destination);
  const scope = scopeStorageKey(destination, JSON.stringify(["imported-world", imported.playthroughs[0].id]));
  expect((await readVoiceResources(scope))[asset.id].audioBase64).toBe("UklGRg==");
  expect(imported.playthroughs[0].id).not.toBe(ptId);
});

it("deleting a playthrough's audio preserves the other archive namespace", async () => {
  await writeVoiceResources("cleanup-source", { [asset.id]: asset });
  await writeVoiceResources("cleanup-other", { [asset.id]: asset });
  await clearVoiceResources("cleanup-source");
  expect(await readVoiceResources("cleanup-source")).toEqual({});
  expect((await readVoiceResources("cleanup-other"))[asset.id]).toEqual(asset);
});
