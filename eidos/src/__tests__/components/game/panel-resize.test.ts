// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { usePanelWidth, PanelResizeHandle } from '@/components/ui/PanelResizeHandle';
function Panel(){const panel=usePanelWidth('test',320);return React.createElement('aside',{style:panel.style},React.createElement(PanelResizeHandle,{label:'详情宽度',panel}));}
afterEach(cleanup);
it('resizes from the left edge, persists the width, and constrains it',()=>{
 localStorage.clear();const v=render(React.createElement(Panel));const edge=screen.getByRole('separator',{name:'详情宽度'});
 fireEvent.keyDown(edge,{key:'ArrowLeft'});expect(edge.getAttribute('aria-valuenow')).toBe('344');
 expect(localStorage.getItem('eidos-panel-width:test')).toBe('344');v.unmount();render(React.createElement(Panel));
 expect(screen.getByRole('separator').getAttribute('aria-valuenow')).toBe('344');
 for(let i=0;i<10;i++)fireEvent.keyDown(screen.getByRole('separator'),{key:'ArrowRight'});
 expect(screen.getByRole('separator').getAttribute('aria-valuenow')).toBe('260');
});
