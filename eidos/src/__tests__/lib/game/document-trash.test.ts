// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import {expect,it} from 'vitest';
import {saveLocalDocument} from '@/lib/game/documents/ingest';
import {loadDocuments,loadTrashedDocuments,readDocument,setDocumentTrashed} from '@/lib/game/documents/repository';
import {collectDocumentBundle,restoreDocumentBundle} from '@/lib/game/documents/transfer';
import {documentScopeKey} from '@/lib/game/model-documents';
import {documentCapacity} from '@/lib/game/documents/capacity';
it('hides trashed documents while preserving pinned references, export and restoration',async()=>{
 const scope={worldId:crypto.randomUUID(),playthroughId:'trash'};
 const doc=await saveLocalDocument(scope,{title:'报告',content:'永久保留的旧引用'});
 await setDocumentTrashed(scope,doc,true);
 expect(await loadDocuments(scope)).toHaveLength(0);expect(await loadTrashedDocuments(scope)).toHaveLength(1);
 expect((await readDocument(scope,doc)).resource.text).toBe('永久保留的旧引用');
 const bundle=await collectDocumentBundle({scopes:[scope]});
 const destination={...scope,playthroughId:'imported'};
 await restoreDocumentBundle(bundle,new Map([[documentScopeKey(scope),destination]]));
 expect(await loadDocuments(destination)).toHaveLength(0);expect(await loadTrashedDocuments(destination)).toHaveLength(1);
 await setDocumentTrashed(scope,doc,false);
 expect((await loadDocuments(scope))[0].id).toBe(doc.documentId);
});
it('counts unique originals including history and trash and rejects stale deletion',async()=>{
 const scope={worldId:crypto.randomUUID(),playthroughId:'bytes'};
 const a=await saveLocalDocument(scope,{title:'A',content:'abc',format:'text'});
 const b=await saveLocalDocument(scope,{title:'B',content:'abc',format:'text'});
 const newer=await saveLocalDocument(scope,{title:'A',content:'abcd',format:'text',previous:a});
 await expect(setDocumentTrashed(scope,a,true)).rejects.toThrow('版本');
 await setDocumentTrashed(scope,b,true);
 expect(await documentCapacity(scope)).toMatchObject({documents:1,trashed:1,versions:3,resources:2,bytes:7});
 expect((await readDocument(scope,newer)).resource.text).toBe('abcd');
});
it('keeps a pinned historical input readable but refuses new edits',async()=>{
 const scope={worldId:crypto.randomUUID(),playthroughId:'pinned'};
 const doc=await saveLocalDocument(scope,{title:'报告',content:'历史原文'});
 await setDocumentTrashed(scope,doc,true);
 const {createWorkspaceSession,runWorkspaceTool}=await import('@/lib/game/workspace/session');
 const session=await createWorkspaceSession({scope,actionId:'history',parentNodeId:null,inputs:[doc],library:[doc]});
 expect(Object.keys(session.files).some(path=>path.startsWith('library/'))).toBe(false);
 const path=Object.keys(session.files)[0];expect((await runWorkspaceTool(session,{method:'files.read',params:{path}})).text).toBe('历史原文');
 await expect(saveLocalDocument(scope,{title:'报告',content:'不允许的覆盖',previous:doc})).rejects.toThrow('回收站');
});
it('does not recreate a trashed image document during metadata synchronization',async()=>{
 const {saveImageDocument}=await import('@/lib/game/midori/image-documents');
 const {storeResource}=await import('@/lib/game/workspace/resources');
 const scope={worldId:crypto.randomUUID(),playthroughId:'image-trash'};
 const image:import('@/lib/game/midori/image-resource').ImageResource={id:'image-trash',worldId:scope.worldId,type:'illustration',targetId:'',label:'照片',description:'原始描述',tags:[],source:'uploaded',createdAt:1,updatedAt:1,originalResource:await storeResource({name:'a.gif',mimeType:'image/gif',base64:'R0lGODlh'})};
 const doc=await saveImageDocument(scope,image);await setDocumentTrashed(scope,doc,true);
 await saveImageDocument(scope,{...image,description:'新描述'});
 expect(await loadDocuments(scope)).toHaveLength(0);expect(await loadTrashedDocuments(scope)).toHaveLength(1);
});
