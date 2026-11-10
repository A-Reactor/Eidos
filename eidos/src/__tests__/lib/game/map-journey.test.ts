import { it, expect } from 'vitest';
import { findMapPath, type PlayerMap } from '@/lib/game/player-map';
import { validateTravelSegments } from '@/lib/game/map-journey';
const map: PlayerMap = { places: ['a','b','c','d','e'].map(id => ({ id, name:id, regionId:'r', regionName:'区', current:id==='a', visited:true, reachable:id==='b' })), paths: [{from:'a',to:'b'},{from:'b',to:'c'},{from:'c',to:'d'},{from:'d',to:'e'}] };
it('finds directed multi-hop routes without crossing blocked edges', () => {
  expect(findMapPath(map,'a','e')).toEqual(['a','b','c','d','e']);
  expect(findMapPath(map,'e','a')).toBeNull();
  expect(findMapPath({...map,paths:map.paths.map(edge => ({...edge,blocked:edge.from==='c'}))},'a','e')).toBeNull();
});
it('requires one observation per edge and accepts a final interruption without reaching the destination', () => {
  const first = {from:'a',to:'b',arrived:true,text:'抵达 B。',minutes:3};
  const stopped = {from:'b',to:'c',arrived:false,text:'守卫拦下你，仍在 B。',minutes:1};
  expect(validateTravelSegments([first,stopped],['a','b','c','d'])).toEqual([first,stopped]);
  expect(() => validateTravelSegments([first],['a','b','c'])).toThrow();
  expect(() => validateTravelSegments([{...first,to:'c'}],['a','b'])).toThrow();
  expect(() => validateTravelSegments([{...first,arrived:false},stopped],['a','b','c'])).toThrow();
});
