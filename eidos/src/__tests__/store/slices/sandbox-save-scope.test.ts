import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SaveSlice } from "@/store/slices/save-slice";
import type { PlaythroughMeta, WorldDefinition } from "@/lib/game/types";
import { buildTestSaveState } from '@/lib/test/fixtures';

const storage = vi.hoisted(() => ({
  saveMeta: vi.fn(),
  loadMeta: vi.fn(),
  removeMeta: vi.fn(),
  saveToDB: vi.fn(),
  loadFromDB: vi.fn(),
  removeFromDB: vi.fn(),
  saveAutoSaveToDB: vi.fn(),
  loadAutoSaveFromDB: vi.fn(),
  saveAutoSavePrevToDB: vi.fn(),
  removeAutoSaveFromDB: vi.fn(),
  autoSaveDataKey: vi.fn((playthroughId: string) => `autosave_data_${playthroughId}`),
}));

vi.mock("@/lib/game/storage", () => storage);

import { createSaveSlice } from "@/store/slices/save-slice";

type TestState = SaveSlice & {
  sandboxMode: boolean;
  sandboxDossierId: string | null;
} & Record<string, unknown>;

function createTestStore(overrides: Partial<TestState> = {}) {
  const state: Partial<TestState> = {
    sandboxMode: false,
    sandboxDossierId: null,
  };
  const set = (
    partial:
      | Record<string, unknown>
      | ((current: Record<string, unknown>) => Record<string, unknown>),
  ) => {
    Object.assign(state, typeof partial === "function" ? partial(state as Record<string, unknown>) : partial);
  };
  const get = () => state;
  Object.assign(state, createSaveSlice(set, get));
  Object.assign(state, overrides);
  return state as TestState;
}

const world = {
  id: "sandbox-world",
  name: "沙箱世界",
  subtitle: "",
  overview: "",
  regions: {},
  npcs: {},
  contradictions: [],
  history: [],
  timeline: [],
  clues: [],
  systemPromptBase: "",
  identityPrompt: "",
  isPlayerCreated: true, createdAt: 1,
} satisfies WorldDefinition;

beforeEach(() => {
  vi.clearAllMocks();
  storage.loadMeta.mockResolvedValue(null);
  storage.saveMeta.mockResolvedValue(undefined);
});

describe("SaveSlice sandbox storage scope", () => {
  it("loads playthrough and save indices from the active sandbox dossier", async () => {
    const store = createTestStore({ sandboxMode: true, sandboxDossierId: "002" });

    await store.loadIndices();

    expect(storage.loadMeta).toHaveBeenCalledWith("sandbox_002_save_index");
    expect(storage.loadMeta).toHaveBeenCalledWith("sandbox_002_playthrough_index");
    expect(storage.loadMeta).not.toHaveBeenCalledWith("save_index");
    expect(storage.loadMeta).not.toHaveBeenCalledWith("playthrough_index");
  });

  it("creates playthroughs inside the sandbox dossier index", async () => {
    const store = createTestStore({ sandboxMode: true, sandboxDossierId: "002" });

    const playthroughId = await store.createPlaythrough("sandbox-world");

    expect(playthroughId).toMatch(/^pt_/);
    expect(storage.saveMeta).toHaveBeenCalledWith(
      "sandbox_002_playthrough_index",
      expect.arrayContaining([
        expect.objectContaining({
          id: playthroughId,
          worldId: "sandbox-world",
          name: "世界树 #1",
        }),
      ]),
    );
    expect(storage.saveMeta).not.toHaveBeenCalledWith(
      "playthrough_index",
      expect.anything(),
    );
  });

  it("saves game data and save indices inside the sandbox dossier", async () => {
    const playthrough = {
      id: "pt_sandbox",
      worldId: world.id,
      name: "世界树 #1",
      createdAt: 1,
      updatedAt: 1,
      playerName: "林",
      actionCount: 0,
      gameTime: { day: 0, hour: 8, minute: 0 },
      currentSceneName: "",
      status: "active",
      totalPlayDuration: 0,
      worldLineId: "worldline_sandbox",
    } satisfies PlaythroughMeta;
    const store = createTestStore({
      sandboxMode: true,
      sandboxDossierId: "002",
      currentWorld: world,
      currentPlaythroughId: playthrough.id,
      cachedSaveSlots: [],
      cachedPlaythroughs: [playthrough],
      playerName: "林",
      currentSceneId: "sandbox_entry",
      gameTime: { day: 1, hour: 9, minute: 0 },
      history: [{ id: 'action_1', timestamp: 1, snapshot: null, summary: "进入沙箱", playerInput: "", aiResponse: "", gameTime: { day: 1, hour: 9, minute: 0 }, sceneId: "sandbox_entry", sceneName: "沙箱入口", timeSpent: { day: 0, hour: 0, minute: 5 }, worldImpacts: [] }],
      currentScene: { id: "sandbox_entry", name: "沙箱入口" },
      currentNode: { stepNumber: 1 },
      getPlayDuration: () => 3,
      serializeState: () => buildTestSaveState(world, { gameTime: { day: 1, hour: 9, minute: 0 }, playerName: "林", currentSceneId: "sandbox_entry" }),
    });

    const saveId = await store.saveGame("沙箱手动存档");

    expect(saveId).toMatch(/^save_/);
    expect(storage.saveToDB).toHaveBeenCalledWith(
      expect.stringMatching(/^sandbox_002_save_data_save_/),
      expect.objectContaining({
        world,
        meta: expect.objectContaining({
          id: saveId,
          playthroughId: playthrough.id,
          worldId: world.id,
        }),
      }),
    );
    expect(storage.saveMeta).toHaveBeenCalledWith(
      "sandbox_002_save_index",
      expect.arrayContaining([expect.objectContaining({ id: saveId })]),
    );
    expect(storage.saveMeta).toHaveBeenCalledWith(
      "sandbox_002_playthrough_index",
      expect.arrayContaining([expect.objectContaining({ id: playthrough.id })]),
    );
    expect(storage.saveToDB).not.toHaveBeenCalledWith(
      expect.stringMatching(/^save_data_save_/),
      expect.anything(),
    );
  });
});

describe("manual save retention", () => {
  it("keeps the oldest manual save when creating the twenty-first", async () => {
    const slots = Array.from({ length: 20 }, (_, i) => ({ id: `save-${i}`, worldId: world.id, playthroughId: "pt_a", updatedAt: i }));
    const store = createTestStore({
      currentWorld: world, currentPlaythroughId: "pt_a", cachedSaveSlots: slots as never,
      cachedPlaythroughs: [], playerName: "林", currentSceneId: "entry", currentScene: { name: "入口" },
      gameTime: { day: 1, hour: 8, minute: 0 }, history: [],
      serializeState: () => ({ playerName: "林", currentSceneId: "entry" } as import("@/lib/game/types").SerializedGameState),
    });
    await store.saveGame("第二十一个存档");
    expect(store.cachedSaveSlots).toHaveLength(21);
    expect(store.cachedSaveSlots.some((slot) => slot.id === "save-0")).toBe(true);
    expect(storage.removeFromDB).not.toHaveBeenCalled();
  });
});


describe('explicit manual slot overwrite', () => {
  const slot = { id: 'save_existing', name: '钟楼前', type: 'manual' as const, worldId: world.id, playthroughId: 'pt_a', createdAt: 10, updatedAt: 20 };
  const setup = (slots = [slot]) => createTestStore({
    sandboxMode: true, sandboxDossierId: '002', currentWorld: world, currentPlaythroughId: 'pt_a', cachedSaveSlots: slots as never,
    cachedPlaythroughs: [], playerName: '林', currentSceneId: 'entry', currentScene: { name: '入口' },
    gameTime: { day: 2, hour: 9, minute: 0 }, history: [], currentNode: { stepNumber: 15 },
    serializeState: () => ({ playerName: '林', currentSceneId: 'entry' } as import('@/lib/game/types').SerializedGameState),
  });
  it('updates the chosen slot in the same sandbox and preserves its identity and creation time', async () => {
    const store = setup();
    expect(await store.saveGame(undefined, slot.id)).toBe(slot.id);
    expect(store.cachedSaveSlots).toHaveLength(1);
    expect(store.cachedSaveSlots[0]).toMatchObject({ id: slot.id, name: slot.name, createdAt: 10, actionCount: 15 });
    expect(storage.saveToDB).toHaveBeenCalledWith('sandbox_002_save_data_save_existing', expect.objectContaining({ meta: expect.objectContaining({ id: slot.id }) }));
    expect(storage.removeFromDB).not.toHaveBeenCalled();
  });
  it.each(['other-world', 'other-playthrough', 'autosave', 'missing'])('rejects overwrite outside the current manual slots: %s', async kind => {
    const target = { ...slot, ...(kind === 'other-world' ? { worldId: 'other' } : kind === 'other-playthrough' ? { playthroughId: 'other' } : kind === 'autosave' ? { type: 'autosave' } : {}) };
    const store = setup([target as typeof slot]);
    expect(await store.saveGame(undefined, kind === 'missing' ? 'missing' : slot.id)).toBe('');
    expect(storage.saveToDB).not.toHaveBeenCalled();
  });
  it('leaves the existing slot untouched if the snapshot write fails', async () => {
    const store = setup(); storage.saveToDB.mockRejectedValueOnce(new Error('quota'));
    await expect(store.saveGame(undefined, slot.id)).rejects.toThrow('quota');
    expect(store.cachedSaveSlots).toEqual([slot]);
    expect(storage.saveMeta).not.toHaveBeenCalled();
  });
});
