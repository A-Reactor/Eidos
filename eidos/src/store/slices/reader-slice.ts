import type { StorySegment } from '@/lib/ai/types';
import type { GameStore } from '../game-store';
import { loadBlob } from '@/lib/game/cas-storage';
import { getPlayerVisibleText,getReadingPath } from '@/lib/game/player-reading';
import { readSegments,type ReadingView } from '@/lib/game/reader-session';
import { archiveScopeSessionValue } from '@/lib/game/archive-scope';

export interface ReaderSlice {
 readingView:ReadingView|null;
 readingSegments:StorySegment[]|null;
 openReadingNode(nodeId:string,originId?:string):Promise<void>;
 closeReadingView():void;
 setReadingSegment(index:number):void;
}
export function createReaderSlice(set:(value:Partial<GameStore>)=>void,get:()=>GameStore):ReaderSlice {
 let request=0;
 const scope=(s:GameStore)=>JSON.stringify([s.currentWorld?.id,s.currentPlaythroughId,s.worldLine?.id,archiveScopeSessionValue(s)]);
 return {
  readingView:null,readingSegments:null,
  closeReadingView(){request++;set({readingView:null,readingSegments:null});},
  setReadingSegment(index){const s=get();if(s.readingView && Number.isSafeInteger(index) && index>=0 && index<(s.readingSegments?.length ?? 0)) set({readingView:{...s.readingView,segmentIndex:index}});},
  async openReadingNode(nodeId,originId){
   const before=get();
   const node=before.allNodes[nodeId],token=++request,key=scope(before);
   if(nodeId===before.currentNode?.id && !originId){set({readingView:null,readingSegments:null});return;}
   if(!node || !getPlayerVisibleText(node)) throw new Error('此处尚无已读正文可供回看');
   let origin=originId ?? before.readingView?.originId ?? before.currentNode?.id ?? nodeId;
   if(!getReadingPath(before.allNodes,origin).some(n=>n.id===nodeId)) origin=nodeId;
   const lines=node.segmentHash ? await loadBlob(node.segmentHash) as StorySegment[]|null : null;
   if(token!==request || scope(get())!==key) return;
   const live=get().allNodes[nodeId];if(!live || live.segmentHash!==node.segmentHash) return;
   const segments=readSegments(live,lines?.length ? lines : [{type:'narration',text:live.aiResponse}]);
   const segmentIndex=before.readingView?.nodeId===nodeId ? Math.min(before.readingView.segmentIndex,Math.max(0,segments.length-1)) : 0;
   set({readingView:{nodeId,originId:origin,segmentIndex},readingSegments:segments});
  },
 };
}
