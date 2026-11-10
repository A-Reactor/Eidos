import type { IdentityOption, WorldDefinition } from './types';
import { isRecord } from './source-reconstruction/validation';

/** Invalid references go back to the same author; substituting a scene would change the opening. */
export function parseWorldIdentityOptions(value: unknown, sceneId: (reference: unknown) => string): IdentityOption[] {
  if (!Array.isArray(value)) throw new Error('身份 identityOptions 必须是列表；没有预设时提交 []');
  const ids = new Set<string>();
  return value.map((option, index) => {
    if (!isRecord(option) || typeof option.name !== 'string' || !option.name.trim() || typeof option.description !== 'string' || typeof option.openingNarrative !== 'string') throw new Error(`身份 ${index + 1} 的 name、description、openingNarrative 必须是文本`);
    const id = typeof option.id === 'string' && option.id.trim() ? option.id.trim() : `identity_${index + 1}`;
    if (ids.has(id)) throw new Error(`身份 ID ${id} 重复`);
    ids.add(id);
    return { id, name: option.name.trim(), description: option.description, openingNarrative: option.openingNarrative, startingScene: sceneId(option.startingScene) };
  });
}

/** Old worlds remain playable offline; explicit authored choices are never expanded or rewritten. */
export function worldIdentityOptions(world: WorldDefinition): IdentityOption[] {
  if (world.sourceMode === 'external_cards') return [{ id: 'card_visitor', name: '访客', description: '从原卡开场进入故事，也可以自定义身份。', openingNarrative: '', startingScene: 'card_start' }];
  if (Array.isArray(world.identityOptions)) return world.identityOptions;
  // An old NPC dossier is enough for an entry, but does not establish a personal arrival scene.
  return ensureWorldCharacterIdentities([], world).map(option => ({ ...option, openingNarrative: '' }));
}

export function ensureWorldCharacterIdentities(
  options: IdentityOption[],
  world: WorldDefinition
): IdentityOption[] {
  const sceneEntries = getWorldSceneEntries(world);
  if (sceneEntries.length === 0) return options;

  const validSceneIds = new Set(sceneEntries.map((scene) => scene.id));
  const fallbackSceneId = sceneEntries[0].id;
  const repaired = options
    .filter((option) => option?.name?.trim())
    .map((option, index) => ({
      ...option,
      id: option.id || `identity_${index + 1}`,
      description: option.description || `${option.name}在${world.name}中的身份。`,
      openingNarrative: option.openingNarrative || `${option.name}站在${world.name}的起点，世界开始回应这个选择。`,
      startingScene: validSceneIds.has(option.startingScene) ? option.startingScene : fallbackSceneId,
    }));

  const existingNames = new Set(repaired.map((option) => normalizeIdentityName(option.name)));
  for (const [index, character] of getWorldCharacterEntries(world).entries()) {
    const normalized = normalizeIdentityName(character.name);
    if (!normalized || existingNames.has(normalized)) continue;
    const sceneId = findSceneForCharacter(sceneEntries, character.name) ?? fallbackSceneId;
    repaired.push({
      id: `identity_world_${index + 1}_${slugIdentityId(character.name)}`,
      name: character.name,
      description: compactText(character.description, `${character.name}是${world.name}中的关键人物。`, 72),
      openingNarrative: buildCharacterOpening(world, character.name, sceneEntries.find((scene) => scene.id === sceneId)),
      startingScene: sceneId,
    });
    existingNames.add(normalized);
  }

  return dedupeIdentityOptions(repaired);
}

export function formatWorldCharacters(world: WorldDefinition): string {
  const entries = getWorldCharacterEntries(world);
  if (entries.length === 0) return "- （结构化角色索引为空；请只从世界设定中提取明确人物）";
  return entries
    .map((entry, index) => `- ${index + 1}. ${entry.name}: ${compactText(entry.description, "暂无描述", 180)}`)
    .join("\n");
}

export function formatWorldScenes(world: WorldDefinition): string {
  const entries = getWorldSceneEntries(world);
  if (entries.length === 0) return "- （结构化场景索引为空；若必须生成，请使用世界中真实出现的场景ID）";
  return entries
    .map((scene) => {
      const npcs = scene.npcs.length > 0 ? `；在场人物：${scene.npcs.join("、")}` : "";
      return `- ${scene.id}（${scene.name}，${scene.regionName}${npcs}）`;
    })
    .join("\n");
}

function getWorldCharacterEntries(world: WorldDefinition): Array<{ name: string; description: string }> {
  return Object.entries((world.npcs ?? {}) as Record<string, unknown>)
    .map(([key, raw]) => {
      if (typeof raw === "string") return { name: key, description: raw };
      if (raw && typeof raw === "object") {
        const value = raw as Record<string, unknown>;
        const name = typeof value.name === "string" && value.name.trim() ? value.name : key;
        const description =
          typeof value.description === "string" ? value.description :
          typeof value.background === "string" ? value.background :
          typeof value.role === "string" ? value.role :
          "";
        return { name, description };
      }
      return { name: key, description: "" };
    })
    .filter((entry) => entry.name.trim().length > 0);
}

function getWorldSceneEntries(world: WorldDefinition): Array<{
  id: string;
  name: string;
  regionName: string;
  npcs: string[];
  initialDescription: string;
}> {
  return Object.values(world.regions ?? {}).flatMap((region) =>
    Object.values(region.scenes ?? {}).map((scene) => ({
      id: scene.id,
      name: scene.name,
      regionName: region.description || region.id,
      npcs: Array.isArray(scene.npcs) ? scene.npcs : [],
      initialDescription: scene.initialDescription ?? "",
    }))
  ).filter((scene) => scene.id.trim().length > 0);
}

function findSceneForCharacter(
  scenes: ReturnType<typeof getWorldSceneEntries>,
  characterName: string
): string | null {
  const normalized = normalizeIdentityName(characterName);
  const scene = scenes.find((candidate) =>
    candidate.npcs.some((npc) => {
      const npcName = normalizeIdentityName(npc);
      return npcName === normalized || npcName.includes(normalized) || normalized.includes(npcName);
    })
  );
  return scene?.id ?? null;
}

function buildCharacterOpening(
  world: WorldDefinition,
  characterName: string,
  scene?: ReturnType<typeof getWorldSceneEntries>[number]
): string {
  const sceneName = scene?.name ?? "起点";
  const detail = scene?.initialDescription
    ? ` ${compactText(scene.initialDescription, "", 80)}`
    : "";
  return `你以「${characterName}」的身份在${sceneName}醒来。${detail} ${world.name}没有替你做决定，只把第一道缝隙推到你面前。`;
}

function normalizeIdentityName(name: string): string {
  return name.replace(/\s+/g, "").toLowerCase();
}

function slugIdentityId(name: string): string {
  const ascii = name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  if (ascii) return ascii.slice(0, 32);
  return Array.from(name).map((char) => char.charCodeAt(0).toString(36)).join("_").slice(0, 32);
}

function compactText(text: string, fallback: string, maxLength: number): string {
  const normalized = (text || fallback).replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 1))}…`;
}

function dedupeIdentityOptions(options: IdentityOption[]): IdentityOption[] {
  const seenIds = new Set<string>();
  const seenNames = new Set<string>();
  return options.filter((option, index) => {
    const nameKey = normalizeIdentityName(option.name);
    if (!nameKey || seenNames.has(nameKey)) return false;
    let id = option.id || `identity_${index + 1}`;
    while (seenIds.has(id)) id = `${id}_${index + 1}`;
    option.id = id;
    seenIds.add(id);
    seenNames.add(nameKey);
    return true;
  });
}

