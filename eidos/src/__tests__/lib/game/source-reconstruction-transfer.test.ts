import { expect, it } from 'vitest';
import { parseWorldImportFiles } from '@/lib/game/import-records';
import { buildWorldOnlyExportPackage } from '@/lib/game/world-export';
import { buildRiftCityStartState } from '@/lib/test/fixtures';
import { createSourceCorpus } from '@/lib/ai/source-archive';
import { createReconstructionArchive } from '@/lib/game/source-reconstruction/archive';
import { briefFromConcept } from '@/lib/game/world-creation-brief';
import { indexSources, sourceRevision } from '@/lib/game/source-reconstruction/source-index';
import type { WorldForm } from '@/lib/game/creation-materials';
const brief = briefFromConcept({ form: { name: '雨港', overview: '', culture: '', regions: '', npcs: '', contradictions: '', history: '', clues: '', opening: '', narrativeStyle: 'balanced' } as WorldForm }); brief.origin = 'source';
function sourceWorld() {
  const corpus = createSourceCorpus([{ content: '雨港的渡口仍在等人。' }], 1), blocks = indexSources(corpus), revision = sourceRevision(corpus);
  return { ...buildRiftCityStartState().world, sourceMode: 'source_archive' as const, sourceArchive: createReconstructionArchive(corpus, { schemaVersion: 2, sourceRevision: revision, brief, digests: [], entityMap: {}, scope: '全部', dossier: { id: 'd', sourceRevision: revision, summary: '雨港', blockIds: blocks.map(b => b.id), claims: [], entities: [], unresolved: [], styleCandidates: [], starts: [], issues: [], childRefs: [], coverage: { expected: blocks.map(b => b.id), completed: blocks.map(b => b.id), failed: [] } } }) };
}
it('roundtrips original materials and reconstruction metadata in world exports', () => {
  const world = sourceWorld();
  const pkg = buildWorldOnlyExportPackage(world);
  expect(pkg.files.some(f => f.path === 'source-archive/reconstruction.json')).toBe(true);
  const imported = parseWorldImportFiles(pkg.files);
  expect(imported.world.sourceArchive).toEqual(world.sourceArchive);
});
it('rejects unknown reconstruction versions instead of silently treating them as legacy', () => {
  const world = sourceWorld();
  (world.sourceArchive!.reconstruction as unknown as { schemaVersion: number }).schemaVersion = 99;
  expect(() => parseWorldImportFiles([{ path: 'world.json', content: JSON.stringify(world) }])).toThrow(/版本/);
});
