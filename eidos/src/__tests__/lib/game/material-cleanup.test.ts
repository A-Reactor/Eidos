// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import {expect,it} from 'vitest';
import {storeResource} from '@/lib/game/workspace/resources';
import {loadMeta,saveMeta} from '@/lib/game/storage';
import {cleanupUnusedMaterials} from '@/lib/game/documents/material-cleanup';
const age=8*24*60*60*1000;
async function material(text:string,old=true){const r=await storeResource({name:'draft.txt',mimeType:'text/plain',text});if(old)await saveMeta(r.id,{...await loadMeta<object>(r.id),lastStoredAt:Date.now()-age});return r;}
it('deletes only old unreferenced originals, preserving durable, shared, fallback and live workspace pins',async()=>{
 const unused=await material('unused'),saved=await material('save'),snapshot=await material('snapshot'),live=await material('live'),fallback=await material('fallback'),recent=await material('recent',false);
 await saveMeta('other-archive-save',{documentRef:{revision:saved.id}});
 const {storeBlob}=await import('@/lib/game/cas-storage');await storeBlob('protected-snapshot','snapshot',{workspaceState:{a:snapshot}});
 localStorage.setItem('old-save-with-reference',JSON.stringify({resource:fallback}));
 const result=await cleanupUnusedMaterials({pins:()=>[live.id]});
 expect(result.deleted).toBeGreaterThanOrEqual(1);expect(await loadMeta(unused.id)).toBeNull();
 for(const r of [saved,snapshot,live,fallback,recent])expect(await loadMeta(r.id)).not.toBeNull();
});
it('protects legacy timestamps, indirect references in retained materials, and aborts a stale cleanup',async()=>{
 const child=await material('child'),root=await material(`original ${child.id}`),unknown=await material('legacy');
 await saveMeta('retained-root',{resource:root});
 const data=await loadMeta<Record<string,unknown>>(unknown.id);delete data!.lastStoredAt;await saveMeta(unknown.id,data);
 const unused=await material('cancelled-cleanup');
 await expect(cleanupUnusedMaterials({isCurrent:()=>false})).rejects.toThrow();expect(await loadMeta(unused.id)).not.toBeNull();
 await cleanupUnusedMaterials();expect(await loadMeta(child.id)).not.toBeNull();expect(await loadMeta(unknown.id)).not.toBeNull();
});
it('retains dependencies of recent and legacy originals even before they have a catalog entry',async()=>{
 const child=await material('dependency of recent'),legacyChild=await material('dependency of legacy');
 await material(`recent parent ${child.id}`,false);
 const legacy=await material(`legacy parent ${legacyChild.id}`);
 const raw=await loadMeta<Record<string,unknown>>(legacy.id);delete raw!.lastStoredAt;await saveMeta(legacy.id,raw);
 await cleanupUnusedMaterials();
 expect(await loadMeta(child.id)).not.toBeNull();expect(await loadMeta(legacyChild.id)).not.toBeNull();
});
it('refreshes an old original lease before handing it to an in-flight publisher',async()=>{
 const old=await material('being-read-before-publication');
 const {readResource}=await import('@/lib/game/workspace/resources');
 const result=await readResource(old);expect(result.id).toBe(old.id);
 await cleanupUnusedMaterials();expect(await loadMeta(old.id)).not.toBeNull();
});
