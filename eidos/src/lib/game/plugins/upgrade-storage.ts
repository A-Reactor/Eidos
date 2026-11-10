import type { StoreApi } from 'zustand';
import type { GameStore } from '@/store/game-store';
import type { WorldLineMeta,WorldLineNode,WorldSnapshot } from '../types';
import type { GameplayPackageHistory } from './package-history';
import { scopeStorageKey } from '../archive-scope';
import { hashAndStore,batchDecrementRef } from '../cas-storage';
import { loadMeta,saveMeta,updateMeta } from '../storage';
import { withWorldLineWrite } from '../worldline-persistence';

interface UpgradeWrite {
 store:StoreApi<GameStore>;
 patch:Pick<GameStore,'currentWorld'|'gameplayModState'|'gameplayResources'|'worldFlags'>;
 snapshot:WorldSnapshot;
 history:GameplayPackageHistory;
 assertCurrent:()=>void;
}

/** Package maintenance changes the checkpoint format, never the player's experience. */
export async function persistPluginUpgrade(input:UpgradeWrite):Promise<string> {
 const {store,assertCurrent}=input,state=store.getState(),line=state.worldLine,node=state.currentNode;
 if(!line || !node) throw new Error('请先进入当前世界再更新模组');
 const hash=await hashAndStore('snapshot',input.snapshot);
 const check=()=>{assertCurrent();if(store.getState().allNodes[node.id]?.snapshotHash!==node.snapshotHash) throw new Error('当前快照已变化，请重新应用更新');};
 // Keep immutable candidate bytes on failure: a storage error may also prevent
 // compensation, so eagerly releasing them could leave an unreadable checkpoint.
 await publishUpgrade({...input,state,line,node,hash,check});
 if(node.snapshotHash) await batchDecrementRef([node.snapshotHash]);
 return node.id;
}

type Publication=UpgradeWrite & {state:GameStore;line:WorldLineMeta;node:WorldLineNode;hash:string;check:()=>void};
async function publishUpgrade({store,patch,history,state,line,node,hash,check}:Publication):Promise<void> {
 const key=scopeStorageKey(state,`worldline_data_${line.id}`),indexKey=scopeStorageKey(state,`worldline_index_${line.worldId}`);
 await withWorldLineWrite(key,async()=>{
  check();
  const meta={...store.getState().worldLine!,gameplayPluginHistory:history};
  const candidate=()=>{const nodes=store.getState().allNodes;return {...nodes,[node.id]:{...nodes[node.id],snapshotHash:hash}};};
  try {
   await saveMeta(key,{meta,nodes:candidate()});check();
   const index=await loadMeta<WorldLineMeta[]>(indexKey) ?? [];check();
   await saveMeta(indexKey,index.some(item=>item.id===line.id) ? index.map(item=>item.id===line.id ? meta : item) : [...index,meta]);check();
   const nodes=candidate();
   // Publish only after both writes. A failed maintenance operation remains a
   // retryable preview, without consuming the accepted-action retry slot.
   store.setState({...patch,worldLine:meta,allNodes:nodes,currentNode:nodes[node.id]});
  } catch(error) {
   await updateMeta<{meta:WorldLineMeta;nodes:Record<string,WorldLineNode>}>(key,saved=>saved?.nodes[node.id]?.snapshotHash===hash ? {meta:line,nodes:state.allNodes} : saved);
   await updateMeta<WorldLineMeta[]>(indexKey,index=>index?.map(item=>item.id===line.id && item.gameplayPluginHistory?.current===history.current ? line : item) ?? null);
   throw error;
  }
 });
}
