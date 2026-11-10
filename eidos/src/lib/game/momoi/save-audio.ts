import { normalizeVoiceAssets } from './model';
import { readVoiceResources, writeVoiceResources } from './resource-storage';

type RecordValue = Record<string, unknown>;
const object = (value: unknown): RecordValue | null => value && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : null;
function saveScope(key: string, meta: RecordValue | null) {
  if (typeof meta?.worldId !== 'string' || typeof meta.playthroughId !== 'string') return null;
  const suffix = [`autosave_prev_data_${meta.playthroughId}`, `autosave_data_${meta.playthroughId}`, ...(typeof meta.id === 'string' ? [`save_data_${meta.id}`] : [])].find(value => key.endsWith(value));
  const index = suffix ? key.length - suffix.length : key.lastIndexOf('save_data_');
  return index >= 0 ? key.slice(0, index) + JSON.stringify([meta.worldId, meta.playthroughId]) : null;
}
/** Saves reference the shared audio pool, so ten save slots cannot hide ten copies from quota. */
export async function compactSaveAudio(key: string, value: unknown, strict = false): Promise<unknown> {
  const save = object(value), state = object(save?.state), meta = object(save?.meta);
  const assets = object(state?.voiceAssets);
  if (!save || !state || !meta || !assets || !Object.keys(assets).length || typeof meta.worldId !== 'string' || typeof meta.playthroughId !== 'string') return value;
  const scope = saveScope(key, meta);
  if (!scope) return value;
  // A historical snapshot must not overwrite a more recent uploaded replacement.
  try { await writeVoiceResources(scope, { ...normalizeVoiceAssets(assets), ...await readVoiceResources(scope) }); }
  catch (error) {
    if (strict) throw new Error('旧存档音频整理失败，原存档已保留，请重试', { cause: error });
    console.warn('[VoiceStorage] keeping embedded audio because shared storage failed:', error); return value;
  }
  return { ...save, state: { ...state, voiceAssets: {}, voiceResourceScope: scope } };
}
export async function hydrateSaveAudio(key: string, value: unknown): Promise<unknown> {
  const save = object(value), state = object(save?.state);
  if (!save || !state || typeof state.voiceResourceScope !== 'string') return value;
  const scope = saveScope(key, object(save.meta));
  if (!scope || scope !== state.voiceResourceScope) return { ...save, state: { ...state, voiceAssets: {} } };
  return { ...save, state: { ...state, voiceAssets: await readVoiceResources(scope) } };
}
