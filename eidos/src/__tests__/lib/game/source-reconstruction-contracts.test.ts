import { describe, expect, it } from 'vitest';
import { createSourceCorpus } from '@/lib/ai/source-archive';
import { indexSources, sourceRevision, stableHash } from '@/lib/game/source-reconstruction/source-index';
import { validateDigest } from '@/lib/game/source-reconstruction/validation';
import { invalidateSourceTasks, taskCoverage } from '@/lib/game/source-reconstruction/task-graph';
import type { SourceTaskGraph } from '@/lib/game/source-reconstruction/types';

describe('source reconstruction contracts', () => {
  it('indexes exact original UTF-16 spans without splitting emoji or losing CRLF/repeated paragraphs', () => {
    const corpus = createSourceCorpus([{ content: '第一行😀\r\n\r\n重复。\r\n\r\n重复。\n' + '🌧'.repeat(30) }], 1);
    const blocks = indexSources(corpus, { targetTokens: 15 });
    expect(blocks.map(b => b.text).join('')).toBe(corpus.documents[0].content);
    for (const block of blocks) {
      expect(corpus.documents[0].content.slice(block.start, block.end)).toBe(block.text);
      expect(block.text).not.toMatch(/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/u);
    }
    expect(new Set(blocks.map(b => b.id)).size).toBe(blocks.length);
    expect(indexSources(corpus, { targetTokens: 15 })).toEqual(blocks);
  });

  it('resolves model block references locally and rejects stale, fabricated, or ungrounded claims', () => {
    const corpus = createSourceCorpus([{ content: '守卫说自己没有开闸。这是一句谎话。' }], 1);
    const blocks = indexSources(corpus);
    const raw = { summary: '守卫说谎', entities: [], claims: [{ id: 'f1', text: '守卫否认开闸', category: 'event', origin: 'source', assertion: 'character_claim', blockIds: [blocks[0].id], entities: [], knownBy: [], temporal: 'current' }], unresolved: [], styleCandidates: [] };
    const context = { blocks, sourceRevision: sourceRevision(corpus) };
    const valid = validateDigest(raw, context);
    expect(valid.ok).toBe(true);
    if (valid.ok) expect(valid.value.claims[0].sourceRefs[0]).toMatchObject({ documentId: corpus.documents[0].id, start: 0, end: corpus.documents[0].content.length });
    expect(validateDigest(raw, { ...context, sourceRevision: 'stale' }).ok).toBe(false);
    expect(validateDigest({ ...raw, claims: [{ ...raw.claims[0], blockIds: ['invented'] }] }, context).ok).toBe(false);
    expect(validateDigest({ ...raw, claims: [{ ...raw.claims[0], blockIds: [] }] }, context).ok).toBe(false);
  });

  it('checks duplicate IDs and quoted bytes, and never upgrades a character claim to objective truth', () => {
    const corpus = createSourceCorpus([{ content: '她说：“明天无雨。”' }], 1), blocks = indexSources(corpus);
    const claim = { id: 'f1', text: '她称明天无雨', category: 'event', origin: 'source', assertion: 'character_claim', blockIds: [blocks[0].id], entities: [], knownBy: [], temporal: 'future' };
    const raw = { summary: '', entities: [], claims: [claim, claim], unresolved: [], styleCandidates: [] };
    expect(validateDigest(raw, { blocks, sourceRevision: sourceRevision(corpus) }).ok).toBe(false);
    const badQuote = { ...raw, claims: [claim], styleCandidates: [{ blockId: blocks[0].id, quote: '伪造的原句', traits: '简短', safe: true }] };
    expect(validateDigest(badQuote, { blocks, sourceRevision: sourceRevision(corpus) }).ok).toBe(false);
  });

  it('derives coverage from verified tasks and propagates invalidation only to dependents', () => {
    const graph: SourceTaskGraph = { tasks: {
      a: { id: 'a', status: 'complete', dependsOn: ['doc-a'], blockIds: ['b1'], inputHash: '1' },
      b: { id: 'b', status: 'failed', dependsOn: ['doc-b'], blockIds: ['b2'], inputHash: '2' },
      merge: { id: 'merge', status: 'complete', dependsOn: ['a', 'b'], blockIds: [], inputHash: '3' },
    } };
    expect(taskCoverage(graph, ['b1', 'b2', 'b3'])).toEqual({ expected: ['b1', 'b2', 'b3'], completed: ['b1'], failed: ['b2'] });
    const next = invalidateSourceTasks(graph, ['doc-a']);
    expect(next.tasks.a.status).toBe('pending');
    expect(next.tasks.merge.status).toBe('pending');
    expect(next.tasks.b.status).toBe('failed');
    expect(graph.tasks.a.status).toBe('complete');
    expect(stableHash('a')).not.toBe(stableHash('b'));
  });
});

it('rejects dangling fact dependencies and opening knowledge references', () => {
  const corpus = createSourceCorpus([{ content: '林在渡口等待。' }], 1), blocks = indexSources(corpus);
  const raw = { summary: '', entities: [], claims: [{ id: 'f', text: '林在渡口', category: 'character', origin: 'source', assertion: 'objective', temporal: 'current', entities: [], knownBy: [], blockIds: [blocks[0].id], requiresFactIds: ['missing'] }], unresolved: [], styleCandidates: [] };
  expect(validateDigest(raw, { blocks, sourceRevision: sourceRevision(corpus) }).ok).toBe(false);
});
it('invalidates model-window changes without putting credentials or interface preferences into task fingerprints', async () => {
  const { sourceModelConfigHash } = await import('@/lib/game/source-reconstruction/client');
  const base = { aliceModel: 'm', aliceContextWindowTokens: 8192, aliceApiKey: 'first', interfaceTheme: 'dark' };
  expect(sourceModelConfigHash(base)).toBe(sourceModelConfigHash({ ...base, aliceApiKey: 'second', interfaceTheme: 'light' }));
  expect(sourceModelConfigHash(base)).not.toBe(sourceModelConfigHash({ ...base, aliceContextWindowTokens: 16384 }));
});
