import { beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST as action } from '@/app/api/game/action/route';
import { POST as stream } from '@/app/api/game/action/stream/route';
import { buildRiftCityStartState } from '@/lib/test/fixtures';
import { callAi, callAiStream } from '@/lib/ai/client';
vi.mock('@/lib/ai/client', async original => ({ ...await original<typeof import('@/lib/ai/client')>(), callAi: vi.fn(), callAiStream: vi.fn() }));
beforeEach(() => { vi.mocked(callAi).mockReset(); vi.mocked(callAiStream).mockReset(); });
const id = 'c'.repeat(64), { world, snapshot } = buildRiftCityStartState();
const body = { world: { ...world, cardBindings: [{ assetId: id, role: 'world', name: '测试原卡', enabled: true }] }, snapshot, playerInput: '检查灯',
  cardContext: { stablePrefix: '固定原卡依据', dynamicSuffix: '', selected: [{ assetId: id, pointer: '/description', chars: 6, reason: '核心' }], omitted: [] },
  _settings: { aliceContextWindowTokens: 1000, aliceApiKey: 'offline-only' } };
const request = (path: string) => new NextRequest(`http://localhost/api/game/action${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
it('returns a usable 422 budget diagnostic, preserving original selection without a paid request', async () => {
  const response = await action(request(''));
  expect(response.status).toBe(422);
  const result = await response.json();
  expect(result.code).toBe('context_budget_exceeded');
  expect(result._contextDiagnostics.cards.stablePrefix).toBe(body.cardContext.stablePrefix);
  expect(result._contextDiagnostics.budget.status).toBe('over_budget');
  expect(result._contextDiagnostics.budget.sections.some((s: { id: string }) => s.id === 'engine')).toBe(true);
  expect(callAi).not.toHaveBeenCalled();
});
it('returns the same budget diagnosis as an SSE error before calling the stream provider', async () => {
  const response = await stream(request('/stream'));
  const events = (await response.text()).split('\n').filter(line => line.startsWith('data: ')).map(line => JSON.parse(line.slice(6)));
  const failure = events.find(e => e.type === 'error');
  expect(failure.code).toBe('context_budget_exceeded');
  expect(failure._contextDiagnostics.cards.stablePrefix).toBe(body.cardContext.stablePrefix);
  expect(callAiStream).not.toHaveBeenCalled();
});
