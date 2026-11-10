import { describe, expect, it } from "vitest";

import { loadSkillGuidesKEI } from "@/lib/ai/world-generator";
import { compileWorldCreation } from '@/lib/ai/world-creation-compiler';
import { buildQualityPrompt } from '@/lib/ai/kei-review';
import { resolveGameplayPlugins } from '@/lib/game/plugins/builtins';
import { buildGameplayPrompt } from '@/lib/game/plugins/runtime';
import { parseWorldImportFiles, finalizeImportedWorld } from '@/lib/game/import-records';
import { buildRiftCityStartState } from '@/lib/test/fixtures';

describe("AI skill guides", () => {
  it("loads the curiosity archaeology world-generation guide", () => {
    const guide = loadSkillGuidesKEI(["curiosity-archaeology"]);

    expect(guide).toContain("知识考古");
    expect(guide).toContain("knowledgeOnlyProgression");
    expect(guide).toContain("evidenceNodes");
    expect(guide).not.toContain("Outer Wilds");
  });
  it.each(['../../../../outside', '../prompt-templates', '__proto__', 'missing-plugin'])('rejects unregistered skill ID %s before file access', id => {
    expect(() => loadSkillGuidesKEI([id])).toThrow();
  });
  it('carries the story anchor guide and world-specific design through creation, export, action and review', () => {
    const plugins = resolveGameplayPlugins(['story-anchors']);
    const anchor = plugins[0];
    const creation = compileWorldCreation({ concept: '两位同行者的旅途', skillGuide: loadSkillGuidesKEI([anchor.id]) });
    expect(creation.systemPrompt).toContain(anchor.prompts.creation);
    const config = { storyAnchors: [{ result: '入冬前分别', scope: '仍隐瞒债务', release: '找到共同承担的安排' }] };
    const world = { ...buildRiftCityStartState().world, gameplayPlugins: plugins, gameModeConfig: config };
    const decoded = parseWorldImportFiles([{ path: 'world.json', content: JSON.stringify(world) }]).world;
    const imported = finalizeImportedWorld(decoded, { existingWorldIds: new Set() });
    expect(imported.gameModeConfig).toEqual(config);
    expect(buildGameplayPrompt(imported, 'action')).toContain(anchor.prompts.action);
    expect(buildQualityPrompt(imported, '两人谈论账单', '')).toContain(anchor.prompts.review);
    for (const phase of ['action', 'review'] as const) {
      expect(buildGameplayPrompt(imported, phase)).toContain('找到共同承担的安排');
    }
    expect(anchor.rules).toEqual([]);
    expect(anchor.ui).toBeUndefined();
    expect(anchor.resources).toBeUndefined();
  });
});
