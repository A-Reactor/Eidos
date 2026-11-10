import type { SourceCorpus, WorldSourceArchive } from '@/lib/ai/source-archive';
import type { SourceReconstructionArchive } from './types';

/** Legacy readers receive a projection; the immutable dossier remains authoritative. */
export function createReconstructionArchive(corpus: SourceCorpus, reconstruction: SourceReconstructionArchive, npcs?: Record<string, string>): WorldSourceArchive {
  const d = reconstruction.dossier;
  if (npcs) reconstruction = { ...reconstruction, entityMap: { ...reconstruction.entityMap, ...Object.fromEntries(d.entities.flatMap(entity => {
    const name = Object.keys(npcs).find(name => name === entity.name || entity.aliases.includes(name));
    return name ? [[entity.id, name]] : [];
  })) } };
  const evidence = d.claims.map(c => {
    const r = c.sourceRefs[0], doc = corpus.documents.find(doc => doc.id === r?.documentId);
    return { id: c.id, sourceId: r?.documentId ?? '', category: c.category, claim: c.text, entities: c.entities, confidence: c.assertion === 'objective' && c.origin === 'source' ? 100 : 50,
      ...(r && doc ? { sourceSpan: { start: r.start, end: r.end, excerpt: doc.content.slice(r.start, r.end) } } : {}) };
  });
  return { corpus, evidence, reconstruction, ledger: {
    id: d.id, title: reconstruction.brief.fields.name.text || '文本世界', summary: d.summary,
    entities: d.entities.map(e => ({ id: e.id, name: e.name, type: e.kind, description: d.claims.filter(c => c.entities.includes(e.id)).map(c => c.text).join('\n'), status: 'source_confirmed', evidenceRefs: d.claims.filter(c => c.entities.includes(e.id)).map(c => c.id) })),
    relationships: [], events: [], worldRules: [],
    unresolvedQuestions: d.unresolved.map((question, i) => ({ id: `unknown_${i}`, question, relatedEntities: [], evidenceRefs: [] })),
    contradictions: [], sourceCoverage: { documentCount: corpus.documents.length, evidenceCount: evidence.length, highConfidenceCount: evidence.filter(e => e.confidence >= 70).length },
  }, adaptationPlan: { mode: 'adaptive', playablePremise: reconstruction.brief.fields.opening.text, lockedFacts: [], allowedInventions: reconstruction.brief.overrides.map(o => o.instruction), forbiddenInventions: ['不得将原作未来强制还原为玩家结局'], bridgeContent: [] } };
}
