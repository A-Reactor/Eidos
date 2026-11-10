import {expect,it} from 'vitest';
import {resourceReferences} from '@/lib/game/plugins/workspace';
import {assertDocumentReferences} from '@/lib/game/documents/transfer';
it('visits each shared snapshot once while retaining nested resource and document references',()=>{
 let visits=0;const resource={id:'material_1111111111111111',name:'note.txt',mimeType:'text/plain',size:4};
 const leaf={workspaceState:{'outputs/a/note.txt':resource},documentId:'missing',revision:resource.id};
 let graph:object={get child(){visits++;return leaf;}};
 for(let i=0;i<12;i++)graph={left:graph,right:graph};
 expect(resourceReferences(graph).get(resource.id)).toEqual(resource);expect(visits).toBe(1);
 expect(()=>assertDocumentReferences(graph,{worldId:'w',playthroughId:'p'},{version:'eidos_documents_v1',records:[],resources:{}})).toThrow('版本缺失');
});
