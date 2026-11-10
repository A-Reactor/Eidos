import { writeFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
import { parseCardBytes } from '@/lib/game/cards/parser';
import { mountCardWorld } from '@/lib/game/cards/binding';
import { selectCardContext } from '@/lib/game/cards/selection';
import { normalizeGameplayModState } from '@/lib/game/plugins/mod-ui';
import { prepareCardVariableTransition } from '@/lib/game/cards/variable-updates';
import { processPlayerAction } from '@/lib/ai/action-handler';
import { callAi } from '@/lib/ai/client';
import { buildRiftCityStartState } from '@/lib/test/fixtures';
import { makeResponse, usage } from './kei-fixtures';
import sample from '../../../../examples/cards/gatekeeper.v2.json';
vi.mock('@/lib/ai/client', async original => ({ ...await original<typeof import('@/lib/ai/client')>(), callAi: vi.fn() }));
it('measures the complete reusable prefix while card conditions change without sending diagnostics to the model', async () => {
  const bytes = new TextEncoder().encode(JSON.stringify(sample)), asset = { ...parseCardBytes(bytes, 'sample.json'), id: 'c'.repeat(64), filename: 'sample.json', originalBytes: bytes, createdAt: 1 };
  const base = buildRiftCityStartState(), world = mountCardWorld({ asset, role: 'world', world: base.world });
  const original = normalizeGameplayModState(world), changed = prepareCardVariableTransition({ world, state: original, mode: 'action', updates: [{ assetId: asset.id, expectedRevision: 0, changes: [{ path: 'Gate.Trust[0]', oldValue: 20, newValue: 65 }] }] });
  vi.mocked(callAi).mockResolvedValue({ content: JSON.stringify(makeResponse()), usage, elapsedMs: 1 });
  const results = [];
  for (const state of [original, changed]) {
    const cards = selectCardContext({ assets: [asset], bindings: world.cardBindings!, query: '城门', sceneNpcs: [], playerName: '旅人', modState: state, initial: false });
    results.push(await processPlayerAction({ world, snapshot: { ...base.snapshot, gameplayModState: state, playerName: '旅人' }, playerInput: '询问城门', cardContext: cards }));
  }
  const [first, next] = vi.mocked(callAi).mock.calls.map(c => c[0]);
  expect(first.promptSections!.stablePrefix).toBe(next.promptSections!.stablePrefix);
  expect(first.promptSections!.dynamicSuffix).not.toBe(next.promptSections!.dynamicSuffix);
  expect(first.systemPrompt).not.toContain('_contextDiagnostics');
  expect(first.systemPrompt).not.toContain('inputTokensEstimated');
  expect(asset.originalBytes).toEqual(bytes);
  const report = { method: 'offline_character_and_utf8_estimate', realModelCalls: 0, stablePrefixChars: Array.from(first.promptSections!.stablePrefix).length,
    stablePrefixIdentical: true, originalBytesPreserved: true,
    beforeInputTokensEstimated: results[0]._contextDiagnostics!.budget!.inputTokensEstimated,
    afterInputTokensEstimated: results[1]._contextDiagnostics!.budget!.inputTokensEstimated };
  if (process.env.EIDOS_CONTEXT_AUDIT_OUTPUT) writeFileSync(process.env.EIDOS_CONTEXT_AUDIT_OUTPUT, JSON.stringify(report, null, 2));
});
