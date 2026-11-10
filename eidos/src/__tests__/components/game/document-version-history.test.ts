// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import React from 'react';
import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {DocumentVersionHistory} from '@/components/game/DocumentVersionHistory';
import {saveLocalDocument} from '@/lib/game/documents/ingest';
import {loadDocuments,readDocument,stageDocumentRevision} from '@/lib/game/documents/repository';
import {storeResource} from '@/lib/game/workspace/resources';
import {useGameStore} from '@/store/game-store';
import {buildRiftCityStartState} from '@/lib/test/fixtures';
import {currentDocumentScope} from '@/lib/game/model-documents';
afterEach(cleanup);
it('compares, reads and restores an old version without changing story history or pinned text',async()=>{
 const {world}=buildRiftCityStartState();useGameStore.setState({...useGameStore.getInitialState(),currentWorld:world,currentPlaythroughId:crypto.randomUUID()});
 const scope=currentDocumentScope(useGameStore.getState())!;
 const old=await saveLocalDocument(scope,{title:'旧名',content:'旧正文',format:'text'});
 const latest=await saveLocalDocument(scope,{title:'新名',content:'新正文',format:'text',previous:old});
 const restored=vi.fn(async()=>{});
 render(React.createElement(DocumentVersionHistory,{scope,initial:(await loadDocuments(scope))[0],onBack(){},onRestored:restored}));
 fireEvent.click(screen.getByRole('button',{name:/历史版本.*旧名/}));
 await waitFor(()=>expect(screen.getByLabelText('版本差异').textContent).toContain('旧正文'));
 expect(screen.getByLabelText('版本差异').textContent).toContain('新正文');
 fireEvent.click(screen.getByRole('button',{name:'查看历史全文'}));expect(screen.getByLabelText('历史版本正文').textContent).toBe('旧正文');
 fireEvent.click(screen.getByRole('button',{name:'恢复此版本'}));
 await waitFor(()=>expect(restored).toHaveBeenCalledOnce());
 const current=(await loadDocuments(scope))[0];expect(current.currentRevision).not.toBe(old.revision);expect(current.currentRevision).not.toBe(latest.revision);
 expect((await readDocument(scope,latest)).resource.text).toBe('新正文');expect(useGameStore.getState().history).toHaveLength(0);
});
it('does not list an unpublished staged revision',async()=>{
 const {world}=buildRiftCityStartState();useGameStore.setState({...useGameStore.getInitialState(),currentWorld:world,currentPlaythroughId:crypto.randomUUID()});
 const scope=currentDocumentScope(useGameStore.getState())!;
 const old=await saveLocalDocument(scope,{title:'报告',content:'公开文本'});
 await stageDocumentRevision(scope,old,await storeResource({name:'candidate.md',mimeType:'text/markdown',text:'秘密候选',revisionName:'未播放的文件名'}));
 render(React.createElement(DocumentVersionHistory,{scope,initial:(await loadDocuments(scope))[0],onBack(){},onRestored:async()=>{}}));
 expect(screen.queryByText(/未播放的文件名/)).toBeNull();expect(screen.getByRole('button',{name:'恢复此版本'}).hasAttribute('disabled')).toBe(true);
});
