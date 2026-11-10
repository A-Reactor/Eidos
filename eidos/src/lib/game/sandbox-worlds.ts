import { sandboxStorageKey,getSandboxDossierId } from './archive-scope';
import { loadMeta,loadFromDB,updateMeta } from './storage';
import type { GameSave,PlaythroughMeta,SaveSlot,WorldDefinition } from './types';

interface LiveWorld { world:WorldDefinition|null;playthroughId:string|null }
const validWorld=(value:unknown):value is WorldDefinition=>Boolean(value && typeof value==='object' &&
 typeof (value as WorldDefinition).id==='string' && typeof (value as WorldDefinition).name==='string');
const merge=(worlds:WorldDefinition[])=>[...new Map(worlds.filter(validWorld).map(world=>[world.id,world])).values()];

function saveKey(id:string):string {
 if(id.startsWith('autosave_prev_')) return `autosave_prev_data_${id.slice('autosave_prev_'.length)}`;
 if(id.startsWith('autosave_')) return `autosave_data_${id.slice('autosave_'.length)}`;
 return `save_data_${id}`;
}

/** Old quota failures can lose the index while complete definitions survive in saves. */
async function recoverWorlds(dossier:string,known:WorldDefinition[],live?:LiveWorld):Promise<WorldDefinition[]> {
 const key=(name:string)=>sandboxStorageKey(dossier,name);
 const [playthroughs,slots,draft]=await Promise.all([
  loadMeta<PlaythroughMeta[]>(key('playthrough_index')),
  loadMeta<SaveSlot[]>(key('save_index')),
  loadFromDB(`world-creation-draft:${getSandboxDossierId(dossier)}`) as Promise<{world?:WorldDefinition}|null>,
 ]);
 const worlds=new Map(merge(known).map(world=>[world.id,world]));
 const add=(world:unknown,id:string)=>{if(validWorld(world) && world.id===id && !worlds.has(id)) worlds.set(id,world);};
 if(live?.world && playthroughs?.some(pt=>pt.id===live.playthroughId && pt.worldId===live.world!.id)) add(live.world,live.world.id);
 if(draft?.world && playthroughs?.some(pt=>pt.worldId===draft.world!.id)) add(draft.world,draft.world.id);
 for(const slot of [...(slots ?? [])].sort((a,b)=>b.updatedAt-a.updatedAt)) {
  if(worlds.has(slot.worldId)) continue;
  const save=await loadFromDB(key(saveKey(slot.id))) as GameSave|null;
  if(save?.meta?.worldId===slot.worldId && save.meta.playthroughId===slot.playthroughId) add(save.world,slot.worldId);
 }
 // A finished save may precede its index update. Only indexed playthroughs prove ownership.
 for(const pt of [...(playthroughs ?? [])].sort((a,b)=>b.updatedAt-a.updatedAt)) {
  if(worlds.has(pt.worldId)) continue;
  const save=await loadFromDB(key(`autosave_data_${pt.id}`)) as GameSave|null;
  if(save?.meta?.worldId===pt.worldId && save.meta.playthroughId===pt.id) add(save.world,pt.worldId);
 }
 return [...worlds.values()];
}

/** A committed empty list is authoritative: deleted worlds must not be recovered again. */
export async function readSandboxWorlds(dossier:string,seeds:WorldDefinition[]=[],live?:LiveWorld):Promise<WorldDefinition[]> {
 const key=sandboxStorageKey(dossier,'worlds_index'),stored=await loadMeta<WorldDefinition[]>(key);
 if(stored!==null) {
  if(!Array.isArray(stored)) throw new Error('沙盒世界集合数据格式无效，已保留原件');
  return stored;
 }
 const recovered=await recoverWorlds(dossier,seeds,live);
 let result=recovered;
 await updateMeta<WorldDefinition[]>(key,current=>{result=current ?? recovered;return result;});
 return result;
}

export async function writeSandboxWorld(dossier:string,world:WorldDefinition,seeds:WorldDefinition[]):Promise<WorldDefinition[]> {
 await readSandboxWorlds(dossier,seeds);
 let result:WorldDefinition[]=[];
 await updateMeta<WorldDefinition[]>(sandboxStorageKey(dossier,'worlds_index'),current=>{
  result=merge([...(current ?? []),world]);return result;
 });
 return result;
}

export async function removeSandboxWorldRecord(dossier:string,id:string,seeds:WorldDefinition[]):Promise<WorldDefinition[]> {
 await readSandboxWorlds(dossier,seeds);
 let result:WorldDefinition[]=[];
 await updateMeta<WorldDefinition[]>(sandboxStorageKey(dossier,'worlds_index'),current=>{
  result=(current ?? []).filter(world=>world.id!==id);return result;
 });
 return result;
}
