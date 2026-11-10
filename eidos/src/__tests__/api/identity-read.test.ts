import { afterEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '@/app/api/game/identity/route';
import { buildRiftCityStartState } from '@/lib/test/fixtures';

afterEach(() => vi.unstubAllGlobals());

it('returns stored identities through the legacy endpoint without calling a model', async () => {
  const fetch = vi.fn().mockRejectedValue(new Error('identity generation is no longer a stage'));
  vi.stubGlobal('fetch', fetch);
  const { world } = buildRiftCityStartState();
  const identityOptions = [{ id: 'gatekeeper', name: '守门人', description: '守着广场入口', openingNarrative: '你推开广场边的门。', startingScene: 'central_plaza' }];
  const response = await POST(new NextRequest('http://localhost/api/game/identity', { method: 'POST', body: JSON.stringify({ world: { ...world, identityOptions } }) }));
  expect(await response.json()).toEqual({ options: identityOptions });
  expect(fetch).not.toHaveBeenCalled();
});

it('ships the built-in world with authored identities and honors a custom-only world', async () => {
  const fetch = vi.fn().mockRejectedValue(new Error('must stay offline'));
  vi.stubGlobal('fetch', fetch);
  const { world } = buildRiftCityStartState();
  const scenes = new Set(Object.values(world.regions).flatMap(region => Object.keys(region.scenes)));
  expect(world.identityOptions).toHaveLength(3);
  expect(world.identityOptions?.every(option => scenes.has(option.startingScene))).toBe(true);
  const response = await POST(new NextRequest('http://localhost/api/game/identity', { method: 'POST', body: JSON.stringify({ world: { ...world, identityOptions: [] } }) }));
  expect(await response.json()).toEqual({ options: [] });
  expect(fetch).not.toHaveBeenCalled();
});
