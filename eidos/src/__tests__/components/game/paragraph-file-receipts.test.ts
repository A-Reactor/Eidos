// @vitest-environment jsdom
import React from 'react';
import { afterEach, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { WorkspaceReceipts } from '@/components/game/WorkspaceReceipts';
import type { WorldLineNode } from '@/lib/game/types';

afterEach(cleanup);
const node = { workspaceBranch: { documents: [{ link: { documentId: 'doc', revision: 'material_0000000000000000', title: '调查笔记' }, segmentIndex: 1, beforeRevision: null, changes: { added: 8, removed: 5 } }], effects: [], attempts: [], mergedThrough: 1 } } as unknown as WorldLineNode;
it('only renders a file result at its bound paragraph in the recommendation style', () => {
  const view = render(React.createElement(WorkspaceReceipts, { node, segmentIndex: 0 }));
  expect(screen.queryByText('调查笔记')).toBeNull();
  view.rerender(React.createElement(WorkspaceReceipts, { node, segmentIndex: 1 }));
  const row = screen.getByRole('listitem');
  expect(row.textContent).toBe('调查笔记+8 -5');
  expect(row.closest('.eidos-record-options')).not.toBeNull();
  expect(row.querySelector('small')).toBeNull();
  expect(screen.queryByText('文件操作')).toBeNull();
});
it('shows failed operations as one compact filename and failure line', () => {
  render(React.createElement(WorkspaceReceipts, { segmentIndex: 2, attempt: [{ method: 'files.patch', status: 'failed', path: 'drafts/turn/report.txt', segmentIndex: 2, error: '版本已变化' }] }));
  expect(screen.getByRole('listitem').textContent).toBe('report.txt失败');
  expect(screen.getByRole('listitem').title).toContain('版本已变化');
});

it('lets the player reveal the real failure reason without a hover or another dialog',()=>{
 render(React.createElement(WorkspaceReceipts,{attempt:[{method:'files.write',status:'denied',path:'library/doc/source.txt',error:'本次未获得修改授权'}]}));
 const button=screen.getByRole('button',{name:'查看 source.txt 失败原因'});
 expect(screen.queryByRole('note')).toBeNull();fireEvent.click(button);
 expect(screen.getByRole('note').textContent).toContain('本次未获得修改授权');
});
it('does not label a corrected file as failed after the selected write succeeded',()=>{
 const updated={...node,workspaceBranch:{...node.workspaceBranch!,effects:[{method:'files.patch',status:'staged',operationId:'fixed',path:'library/doc/source.txt',afterVersion:'material_0000000000000000',segmentIndex:1}],attempts:[{method:'files.patch',status:'failed',path:'library/doc/source.txt',segmentIndex:0,error:'旧版本冲突'}]}} as WorldLineNode;
 render(React.createElement(WorkspaceReceipts,{node:updated}));
 expect(screen.queryByText('失败')).toBeNull();
 expect(screen.getAllByRole('listitem')).toHaveLength(1);
});

it('keeps a failed attempt visible until its later correction has actually played',()=>{
 const updated={...node,workspaceBranch:{...node.workspaceBranch!,mergedThrough:0,effects:[{method:'files.patch',status:'staged',operationId:'fixed',path:'library/doc/source.txt',afterVersion:'material_0000000000000000',segmentIndex:1}],attempts:[{method:'files.patch',status:'failed',path:'library/doc/source.txt',segmentIndex:0,error:'旧版本冲突'}]}} as WorldLineNode;
 render(React.createElement(WorkspaceReceipts,{node:updated,segmentIndex:0}));expect(screen.getByText('失败')).toBeTruthy();
});
