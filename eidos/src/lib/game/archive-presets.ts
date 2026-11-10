import riftCity from '@/data/world/rift-city-preset.json';
import administrator from '@/data/world/administrator-sandbox.json';
import { DEFAULT_SANDBOX_DOSSIER_ID, getSandboxDossierId, scopeStorageKey, type ArchiveScopeSource } from './archive-scope';
import { restoreArchiveRecovery, type ArchiveRecovery } from './archive-transfer';
import { assembleLibraryWorlds } from './library-worlds';
import { loadMeta, saveMeta, withMetaLock } from './storage';
import type { GameSave, WorldDefinition } from './types';

export const demoWorld = riftCity as WorldDefinition;
type PresetRecovery = Omit<ArchiveRecovery, 'saves'> & { saves: Omit<GameSave, 'world'>[] };

export async function installArchivePreset(scope: ArchiveScopeSource, ensureSandboxWorld: (world: WorldDefinition) => Promise<void>) {
  if (scope.sandboxMode && getSandboxDossierId(scope.sandboxDossierId) !== DEFAULT_SANDBOX_DOSSIER_ID) return;
  const world = scope.sandboxMode ? administrator as WorldDefinition : demoWorld;
  const marker = scopeStorageKey(scope, `preset_installed_${world.id}`);
  await withMetaLock(`install_${marker}`, async () => {
    if (await loadMeta<boolean>(marker)) return;
    if (scope.sandboxMode) await ensureSandboxWorld(world);
    else if (!assembleLibraryWorlds([world], []).length) return;

    const { default: data } = scope.sandboxMode ? await import('@/data/world/administrator-sandbox-recovery.json')
      : await import('@/data/world/rift-city-preset-recovery.json');
    // These exports share the bundled definition instead of carrying a copy in every save.
    const recovery = data as unknown as PresetRecovery;
    await restoreArchiveRecovery({ ...recovery, saves: recovery.saves.map(save => ({ ...save, world })) }, world, scope, true);
    await saveMeta(marker, true);
  });
}
