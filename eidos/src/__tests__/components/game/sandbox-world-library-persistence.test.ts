// @vitest-environment jsdom
import React from 'react';
import { IDBFactory,IDBObjectStore } from 'fake-indexeddb';
import { act,cleanup,render,screen,waitFor } from '@testing-library/react';
import { afterEach,beforeEach,expect,it,vi } from 'vitest';
import { WorldSelectScreen } from '@/components/game/WorldSelectScreen';
import { useGameStore } from '@/store/game-store';
import { buildRiftCityStartState } from '@/lib/test/fixtures';
import { _resetDB,saveMeta,saveToDB } from '@/lib/game/storage';
import * as storage from '@/lib/game/storage';
import { sandboxStorageKey } from '@/lib/game/archive-scope';
import { sandboxWorldsStorageKey } from '@/store/slices/sandbox-slice';
import type { GameSave,PlaythroughMeta,SaveSlot,WorldDefinition } from '@/lib/game/types';

const makeWorld=(id:string):WorldDefinition=>({...buildRiftCityStartState().world,id,name:`沙盒世界 ${id}`,isPlayerCreated:true});
beforeEach(()=>{
 vi.stubGlobal('indexedDB',new IDBFactory());_resetDB();localStorage.clear();sessionStorage.clear();
 useGameStore.setState(useGameStore.getInitialState());useGameStore.getState().enterSandboxDossier('002');
});
afterEach(()=>{cleanup();vi.restoreAllMocks();_resetDB();vi.unstubAllGlobals();});

it('seeds the administrator world in 002 only and respects its removal',async()=>{
 const store=useGameStore.getState();
 expect(await store.loadSandboxWorlds('003')).toEqual([]);
 render(React.createElement(WorldSelectScreen));
 expect(await screen.findByRole('button',{name:'展开 管理员测试台'})).toBeDefined();
 await waitFor(()=>expect(useGameStore.getState().cachedSaveSlots).toHaveLength(2));
 expect(useGameStore.getState().cachedPlaythroughs).toHaveLength(1);
 const [world]=await store.loadSandboxWorlds('002');
 expect(world.name).toBe('管理员测试台');
 const slot=useGameStore.getState().cachedSaveSlots[0];
 await act(async()=>{expect(await store.loadGame(slot.id)).toBe(true);});
 expect(useGameStore.getState().currentSceneId).toBe('console_room');
 cleanup();render(React.createElement(WorldSelectScreen));
 await act(async()=>{});
 expect(useGameStore.getState().cachedSaveSlots).toHaveLength(2);
 await act(async()=>{await store.removeSandboxWorld(world.id,'002');});
 expect(await store.loadSandboxWorlds('002')).toEqual([]);
});

it('loads the new demo save through the ordinary library and leaves the old save index intact',async()=>{
 const store=useGameStore.getState();
 store.exitSandboxDossier();
 const old={id:'old-rift',worldId:'rift_city'} as PlaythroughMeta;
 await saveMeta('playthrough_index',[old]);
 render(React.createElement(WorldSelectScreen));
 await waitFor(()=>expect(useGameStore.getState().cachedSaveSlots).toHaveLength(2));
 const seeded=useGameStore.getState().cachedSaveSlots[0];
 expect(seeded.worldId).not.toBe('rift_city');
 expect(useGameStore.getState().cachedPlaythroughs).toContainEqual(old);
 await act(async()=>{expect(await store.loadGame(seeded.id)).toBe(true);});
 expect(useGameStore.getState().currentWorld?.id).toBe(seeded.worldId);
 expect(useGameStore.getState().currentSceneId).toBe('hall_of_records');
});

it('retains a newly created sandbox world after returning to the collection when localStorage is full',async()=>{
 const original=Storage.prototype.setItem;
 vi.spyOn(Storage.prototype,'setItem').mockImplementation(function(this:Storage,key,value){
  if(key===sandboxWorldsStorageKey('002')) throw new DOMException('quota','QuotaExceededError');
  return original.call(this,key,value);
 });
 const world=makeWorld('new');
 await useGameStore.getState().addSandboxWorld(world,'002');
 useGameStore.getState().setCurrentWorld(world);useGameStore.getState().setPhase('playing');
 useGameStore.getState().setPhase('world_select');render(React.createElement(WorldSelectScreen));
 await waitFor(()=>expect(screen.getByRole('button',{name:`展开 ${world.name}`})).toBeDefined());
 expect(useGameStore.getState().sandboxWorlds.map(w=>w.id)).toContain('new');
 // A fresh client must load the committed definition, without an in-memory copy.
 cleanup();useGameStore.setState(useGameStore.getInitialState());useGameStore.getState().enterSandboxDossier('002');
 await useGameStore.getState().loadSandboxWorlds('002');render(React.createElement(WorldSelectScreen));
 await waitFor(()=>expect(screen.getByRole('button',{name:`展开 ${world.name}`})).toBeDefined());
 await waitFor(()=>expect(useGameStore.getState().cachedSaveSlots).toHaveLength(2));
});

it('updates the mounted collection when creation adds a sandbox world under its preview',async()=>{
 const world=makeWorld('underlay');render(React.createElement<{preview?:boolean}>(WorldSelectScreen,{preview:true}));
 await act(async()=>{});
 await act(async()=>{await useGameStore.getState().addSandboxWorld(world,'002');});
 await waitFor(()=>expect(screen.getByRole('button',{name:`展开 ${world.name}`})).toBeDefined());
});

it('recovers a missing sandbox definition from its own indexed autosave',async()=>{
 const world=makeWorld('recovered'),other=makeWorld('ordinary'),pt='pt-recovered';
 const meta={id:`autosave_${pt}`,worldId:world.id,playthroughId:pt,type:'autosave',updatedAt:10} as SaveSlot;
 await saveMeta(sandboxStorageKey('002','save_index'),[meta]);
 await saveToDB(sandboxStorageKey('002',`autosave_data_${pt}`),{meta,world,state:{}} as GameSave);
 await saveMeta(sandboxStorageKey('002','playthrough_index'),[{id:pt,worldId:world.id}] as PlaythroughMeta[]);
 await saveMeta('save_index',[{...meta,worldId:other.id}]);
 await saveToDB(`autosave_data_${pt}`,{meta:{...meta,worldId:other.id},world:other,state:{}} as GameSave);
 await useGameStore.getState().loadSandboxWorlds('002');
 expect(useGameStore.getState().sandboxWorlds.map(w=>w.id)).toEqual(['recovered']);
});

it('does not resurrect an explicitly removed world from stale legacy data or its saves',async()=>{
 const world=makeWorld('removed');localStorage.setItem(sandboxWorldsStorageKey('002'),JSON.stringify([world]));
 const meta={id:'autosave_removed',worldId:world.id,playthroughId:'removed',updatedAt:1} as SaveSlot;
 await saveMeta(sandboxStorageKey('002','save_index'),[meta]);
 await saveToDB(sandboxStorageKey('002','autosave_data_removed'),{meta,world,state:{}} as GameSave);
 await useGameStore.getState().loadSandboxWorlds('002');
 await useGameStore.getState().removeSandboxWorld(world.id,'002');
 await useGameStore.getState().loadSandboxWorlds('002');
 expect(useGameStore.getState().sandboxWorlds).toEqual([]);
});
it('does not publish old dossier indices after switching archives during a read',async()=>{
 await saveMeta(sandboxStorageKey('002','save_index'),[{id:'old-save'}]);
 await saveMeta(sandboxStorageKey('002','playthrough_index'),[{id:'old-pt'}]);
 const pending=useGameStore.getState().loadIndices();
 useGameStore.getState().enterSandboxDossier('003');useGameStore.setState({cachedSaveSlots:[],cachedPlaythroughs:[]});
 await pending;
 expect(useGameStore.getState().cachedSaveSlots).toEqual([]);expect(useGameStore.getState().cachedPlaythroughs).toEqual([]);
});
it('does not erase a new playthrough when an earlier index read completes late',async()=>{
 let release!:()=>void;
 const gate=new Promise<void>(resolve=>{release=resolve;}),read=storage.loadMeta;
 vi.spyOn(storage,'loadMeta').mockImplementation(async key=>{
  if(key===sandboxStorageKey('002','save_index')) await gate;
  return read(key);
 });
 const loading=useGameStore.getState().loadIndices();
 await read(sandboxStorageKey('002','playthrough_index'));
 const id=await useGameStore.getState().createPlaythrough('new-world');
 release();await loading;
 expect(useGameStore.getState().cachedPlaythroughs.map(pt=>pt.id)).toEqual([id]);
});
it('keeps both worlds when two sandbox additions overlap',async()=>{
 await Promise.all([useGameStore.getState().addSandboxWorld(makeWorld('first'),'002'),useGameStore.getState().addSandboxWorld(makeWorld('second'),'002')]);
 await useGameStore.getState().loadSandboxWorlds('002');
 expect(useGameStore.getState().sandboxWorlds.map(w=>w.id).sort()).toEqual(['first','second']);
});
it('does not duplicate legacy worlds in the collection while a new definition is saving',async()=>{
 const world=makeWorld('legacy');localStorage.setItem(sandboxWorldsStorageKey('002'),JSON.stringify([world]));
 useGameStore.getState().enterSandboxDossier('002');
 const pending=useGameStore.getState().addSandboxWorld(makeWorld('newer'),'002');
 try {expect(useGameStore.getState().sandboxWorlds.map(w=>w.id)).toEqual(['legacy','newer']);}
 finally {await pending;}
});
it('reports a failed durable write and retains the previous collection when both stores reject it',async()=>{
 await useGameStore.getState().addSandboxWorld(makeWorld('existing'),'002');
 vi.spyOn(IDBObjectStore.prototype,'put').mockImplementation(()=>{throw new Error('IndexedDB quota');});
 vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new DOMException('local quota','QuotaExceededError');});
 await expect(useGameStore.getState().addSandboxWorld(makeWorld('failed'),'002')).rejects.toThrow();
 expect(useGameStore.getState().sandboxWorlds.map(w=>w.id)).toEqual(['existing']);
});
