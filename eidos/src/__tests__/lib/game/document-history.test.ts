// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import {expect,it} from 'vitest';
import {saveLocalDocument} from '@/lib/game/documents/ingest';
import {readDocument,loadDocuments,stageDocumentRevision,restoreDocumentVersion} from '@/lib/game/documents/repository';
import {storeResource} from '@/lib/game/workspace/resources';
import {collectDocumentBundle,validateDocumentBundle} from '@/lib/game/documents/transfer';
it('restores old bytes as a distinct revision and keeps both pinned versions exportable',async()=>{
 const scope={worldId:crypto.randomUUID(),playthroughId:'history'};
 const one=await saveLocalDocument(scope,{title:'旧名',content:'第一版'});
 const two=await saveLocalDocument(scope,{title:'新名',content:'第二版',previous:one});
 const restored=await restoreDocumentVersion(scope,{current:two,source:one});
 expect(restored.revision).not.toBe(one.revision);expect(restored.revision).not.toBe(two.revision);
 expect((await readDocument(scope,restored)).resource.text).toBe('第一版');
 expect((await readDocument(scope,two)).resource.text).toBe('第二版');
 expect((await readDocument(scope,restored)).record.title).toBe('旧名');
 await validateDocumentBundle(await collectDocumentBundle({scopes:[scope]}));
 await expect(restoreDocumentVersion(scope,{current:two,source:one})).rejects.toThrow('版本');
});
it('rejects pending and foreign document versions before changing the active head',async()=>{
 const scope={worldId:crypto.randomUUID(),playthroughId:'pending'};
 const one=await saveLocalDocument(scope,{title:'报告',content:'已发布'});
 const staged=await stageDocumentRevision(scope,one,await storeResource({name:'draft.md',mimeType:'text/markdown',text:'未播放的候选'}));
 await expect(restoreDocumentVersion(scope,{current:one,source:staged})).rejects.toThrow('候选');
 await expect(restoreDocumentVersion(scope,{current:one,source:{...one,documentId:'other'}})).rejects.toThrow();
 expect((await loadDocuments(scope))[0].currentRevision).toBe(one.revision);
});
it('keeps a restored image description from being overwritten by gallery metadata synchronization',async()=>{
 const {saveImageDocument}=await import('@/lib/game/midori/image-documents');
 const scope={worldId:crypto.randomUUID(),playthroughId:'image-history'};
 const image:import('@/lib/game/midori/image-resource').ImageResource={id:'test-image',worldId:scope.worldId,type:'illustration',targetId:'',label:'照片',description:'旧描述',tags:[],source:'uploaded',createdAt:1,updatedAt:1,originalResource:await storeResource({name:'a.gif',mimeType:'image/gif',base64:'R0lGODlh'})};
 const old=await saveImageDocument(scope,image),latest=await saveImageDocument(scope,{...image,description:'新描述'});
 const restored=await restoreDocumentVersion(scope,{current:latest,source:old});
 const synced=await saveImageDocument(scope,{...image,description:'新描述'});
 expect(synced.revision).toBe(restored.revision);
 expect((await readDocument(scope,restored)).resource.text).toContain('旧描述');
});
it('restores against the current branch projection without changing older branch heads',async()=>{
 const {useGameStore}=await import('@/store/game-store');
 const {buildRiftCityStartState}=await import('@/lib/test/fixtures');
 const {currentDocumentScope}=await import('@/lib/game/model-documents');
 const {world}=buildRiftCityStartState();useGameStore.setState({...useGameStore.getInitialState(),currentWorld:world,currentPlaythroughId:crypto.randomUUID()});
 const scope=currentDocumentScope(useGameStore.getState())!;
 const one=await saveLocalDocument(scope,{title:'报告',content:'分支一'});
 const two=await saveLocalDocument(scope,{title:'报告',content:'分支二',previous:one});
 useGameStore.setState({documentHeads:[one]});
 const restored=await restoreDocumentVersion(scope,{current:one,source:two});
 expect((await loadDocuments(scope))[0].currentRevision).toBe(restored.revision);
 expect((await loadDocuments(scope,[one]))[0].currentRevision).toBe(one.revision);
 expect((await readDocument(scope,one)).resource.text).toBe('分支一');
 await expect(restoreDocumentVersion(scope,{current:restored,source:one,isCurrent:()=>false})).rejects.toThrow('进度');
});
