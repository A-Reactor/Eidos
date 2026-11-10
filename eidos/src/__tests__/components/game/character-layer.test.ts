// @vitest-environment jsdom

import React from "react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CharacterLayer } from "@/components/game/CharacterLayer";
import { useGameStore } from "@/store/game-store";
import type { Scene, WorldDefinition } from "@/lib/game/types";
import type { StorySegment } from "@/lib/ai/types";
import { imageWorkspacePath, type ImageResource } from '@/lib/game/midori/image-resource';

const scene: Scene = {
  id: "central_plaza",
  name: "中央广场",
  region: "上城区",
  initialDescription: "裂隙下的广场。",
  detailLevel: 10,
  connections: [],
  npcs: ["观测员埃琳娜"],
  secrets: [],
  discoveredSecrets: [],
};

const world: WorldDefinition = {
  id: "rift_city",
  name: "裂隙之城",
  subtitle: "",
  overview: "",
  regions: {
    upper: {
      id: "upper",
      description: "",
      scenes: { central_plaza: scene },
    },
  },
  npcs: { "观测员埃琳娜": "裂隙观测员。" },
  contradictions: [],
  history: [],
  timeline: [],
  clues: [],
  systemPromptBase: "",
  identityPrompt: "",
  isPlayerCreated: false,
  createdAt: 1,
};

const neutralDialogue: StorySegment = {
  type: "dialogue",
  speaker: "观测员埃琳娜",
  emotion: "neutral",
  text: "这个日晷从来都不是指向北方。",
};

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      json: async () => ({ cached: false, url: null }),
    })),
  );

  useGameStore.setState({
    currentWorld: world,
    currentScene: scene,
    currentSceneId: scene.id,
    npcStates: {},
    midoriSettings: {
      enabled: false,
      model: "pixel-art-xl",
      pixelate: true,
      autoGenerate: false,
    },
  } as never);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("CharacterLayer", () => {
  it('switches directly on expression keywords and exact file paths without probing the image service', () => {
    const resource = (id: string, tags: string[]): ImageResource => ({ id, tags, worldId: world.id, targetId: '观测员埃琳娜', type: 'character', slot: 'portrait', label: id,
      description: '', source: 'uploaded', imageUrl: `/${id}.png`, createdAt: 1, updatedAt: 1 });
    const images = [resource('happy', ['开心']), resource('dress', ['开心', '礼服']), resource('thinking', ['思考'])];
    useGameStore.setState({ midoriAssetRegistry: { version: 1, bindings: {}, images: Object.fromEntries(images.map(image => [image.id, image])) } });
    const view = render(React.createElement(CharacterLayer, { currentSegment: { ...neutralDialogue, expressionTags: ['开心', '礼服'] } }));
    expect(screen.getByRole('img', { name: '观测员埃琳娜' }).getAttribute('src')).toBe('/dress.png');
    view.rerender(React.createElement(CharacterLayer, { currentSegment: { ...neutralDialogue, expressionTags: ['开心'], imagePath: imageWorkspacePath('thinking') } }));
    expect(screen.getByRole('img', { name: '观测员埃琳娜' }).getAttribute('src')).toBe('/thinking.png');
    expect(fetch).not.toHaveBeenCalled();
  });
  it("hides missing NPC portraits and remembers cache misses instead of probing the same absent file again", async () => {
    const fetchMock = vi.mocked(fetch);
    const { rerender } = render(
      React.createElement(CharacterLayer, { currentSegment: neutralDialogue }),
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(screen.queryByText("观测员埃琳娜")).toBeNull();
    expect(screen.queryByText("neutral")).toBeNull();

    rerender(React.createElement(CharacterLayer, {
      currentSegment: { ...neutralDialogue, emotion: "sad" },
    }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    rerender(React.createElement(CharacterLayer, { currentSegment: neutralDialogue }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('keeps cache failures retryable and ignores a previous world response for an equal speaker name', async () => {
    let oldResponse!: (value: Response) => void;
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementationOnce(() => new Promise(resolve => { oldResponse = resolve; }));
    fetchMock.mockResolvedValue(Response.json({ cached: true, url: '/new-world.png' }));
    render(React.createElement(CharacterLayer, { currentSegment: neutralDialogue }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    act(() => useGameStore.setState({ currentWorld: { ...world, id: 'other-world' } }));
    await screen.findByRole('img', { name: '观测员埃琳娜' });
    await act(async () => { oldResponse(Response.json({ cached: true, url: '/old-world.png' })); });
    expect(screen.getByRole('img', { name: '观测员埃琳娜' }).getAttribute('src')).toBe('/new-world.png');
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body)).cacheKey.worldId).toBe('other-world');
  });
});
