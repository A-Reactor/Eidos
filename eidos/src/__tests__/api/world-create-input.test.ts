import { beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
const generate = vi.hoisted(() => vi.fn(async (_input: unknown) => ({ id: 'world' })));
vi.mock('@/lib/ai/world-generator', () => ({ generateWorldConversation: generate, generateWorldConversationStream: generate }));
import { POST as create } from '@/app/api/world/create/route';
import { POST as stream } from '@/app/api/world/create/stream/route';
import { briefFromConcept, WORLD_BRIEF_FIELDS } from '@/lib/game/world-creation-brief';
import type { WorldForm } from '@/lib/game/creation-materials';
const request = (body: unknown, origin?: string) => new NextRequest('http://localhost:3000/api/world/create', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(origin ? { origin } : {}) }, body: JSON.stringify(body) });
beforeEach(() => generate.mockClear());
it.each([null, [], { concept: 12 }, { concept: '一个完整的世界', skillIds: ['../outside'] }, { concept: '一个完整的世界', skillIds: 'loop-manager' }])('rejects malformed creation requests before model work', async body => {
  expect((await create(request(body))).status).toBe(400);
  expect((await stream(request(body))).status).toBe(400);
  expect(generate).not.toHaveBeenCalled();
});
it('rejects cross-site creation attempts before consuming tokens', async () => {
  expect((await create(request({ concept: '一个完整的世界' }, 'https://foreign.example'))).status).toBe(403);
  expect((await stream(request({ concept: '一个完整的世界' }, 'https://foreign.example'))).status).toBe(403);
  expect(generate).not.toHaveBeenCalled();
});

it('passes quick generation through both ordinary and streaming creation routes', async () => {
  const body = { concept: '一个完整的世界', generationProfile: 'quick' };
  const response = await create(request(body));
  expect(response.status).toBe(200);
  expect(generate.mock.calls.at(-1)?.[0]).toMatchObject({ generationProfile: 'quick' });
  const streamed = await stream(request(body));
  await streamed.text();
  expect(generate.mock.calls.at(-1)?.[0]).toMatchObject({ generationProfile: 'quick' });
});

it('accepts a shared brief in both routes and rejects source briefs without a dossier', async () => {
  const form = { ...Object.fromEntries(WORLD_BRIEF_FIELDS.map(k => [k, ''])), name: '雨港', narrativeStyle: 'balanced' } as WorldForm;
  const brief = briefFromConcept({ form });
  expect((await create(request({ brief }))).status).toBe(200);
  const response = await stream(request({ brief })); await response.text();
  expect(response.status).toBe(200);
  expect(generate.mock.calls.at(-1)?.[0]).toMatchObject({ brief });
  expect((await create(request({ brief: { ...brief, origin: 'source' } }))).status).toBe(400);
});
