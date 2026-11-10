import { create } from "zustand";
import { loadFromDB, saveToDB } from "@/lib/game/storage";
import { DEFAULT_VOICE_CONFIG, normalizeVoiceConfig, type VoiceConfig, type VoiceProvider } from "./model";

export interface VoicePreset { id: string; name: string; config: VoiceConfig }
export interface VoicePresetData {
  presets: VoicePreset[];
  drafts: Record<string, Partial<Record<VoiceProvider, VoiceConfig>>>;
}
const STORAGE_KEY = "momoi_voice_presets_v1";
export function normalizeVoicePresets(raw: unknown): VoicePresetData {
  const data = raw as Partial<VoicePresetData> | null;
  const presets: VoicePreset[] = [];
  for (const entry of Array.isArray(data?.presets) ? data.presets : []) {
    if (!entry || typeof entry.id !== "string" || !entry.id || typeof entry.name !== "string" || !entry.name.trim() || presets.some(p => p.id === entry.id)) continue;
    presets.push({ id: entry.id, name: entry.name.trim().slice(0, 80), config: normalizeVoiceConfig(entry.config) });
  }
  const drafts: VoicePresetData["drafts"] = {};
  if (data?.drafts && typeof data.drafts === "object") {
    for (const [scope, values] of Object.entries(data.drafts)) {
      const entries = (["legacy", "gpt-sovits", "compatible"] as const).flatMap(provider => values?.[provider] ? [[provider, normalizeVoiceConfig({ ...values[provider], provider })]] : []);
      drafts[scope] = Object.fromEntries(entries);
    }
  }
  return { presets, drafts };
}
export const readVoicePresets = async () => normalizeVoicePresets(await loadFromDB(STORAGE_KEY));
export const writeVoicePresets = (data: VoicePresetData) => saveToDB(STORAGE_KEY, normalizeVoicePresets(data));

interface PresetStore { data: VoicePresetData; ready: boolean; error: string }
export const useVoicePresets = create<PresetStore>(() => ({ data: { presets: [], drafts: {} }, ready: false, error: "" }));
let loading: Promise<void> | null = null;
let writing: Promise<unknown> = Promise.resolve();
export function loadVoicePresets(): Promise<void> {
  if (useVoicePresets.getState().ready) return Promise.resolve();
  loading ??= readVoicePresets().then(data => { useVoicePresets.setState({ data, ready: true, error: "" }); })
    .catch(error => { useVoicePresets.setState({ error: error instanceof Error ? error.message : "配置方案读取失败" }); throw error; })
    .finally(() => { loading = null; });
  return loading;
}
async function update(transform: (data: VoicePresetData) => VoicePresetData) {
  const operation = writing.catch(() => {}).then(async () => {
    await loadVoicePresets();
    const next = normalizeVoicePresets(transform(useVoicePresets.getState().data));
    await writeVoicePresets(next);
    useVoicePresets.setState({ data: next, error: "" });
  });
  writing = operation;
  return operation;
}
export async function saveVoicePreset(name: string, config: VoiceConfig, id = crypto.randomUUID()) {
  if (!name.trim()) throw new Error("请为方案命名");
  await update(data => ({ ...data, presets: [...data.presets.filter(p => p.id !== id), { id, name, config }] }));
  return id;
}
export const deleteVoicePreset = (id: string) => update(data => ({ ...data, presets: data.presets.filter(p => p.id !== id) }));
export const rememberVoiceDraft = (scope: string, config: VoiceConfig) => update(data => ({
  ...data, drafts: { ...data.drafts, [scope]: { ...data.drafts[scope], [config.provider]: config } },
}));
export async function voiceProviderDraft(scope: string, current: VoiceConfig, provider: VoiceProvider) {
  await rememberVoiceDraft(scope, current);
  return normalizeVoiceConfig(useVoicePresets.getState().data.drafts[scope]?.[provider] ?? {
    ...DEFAULT_VOICE_CONFIG, provider, endpoint: provider === "gpt-sovits" ? "http://127.0.0.1:9880" : "",
  });
}
