// @vitest-environment jsdom
import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { DialogueReadout } from '@/components/game/DialogueReadout';
afterEach(()=>{cleanup();vi.restoreAllMocks();});
it('follows growing map dialogue, preserves a deliberate scroll back, and starts a new passage at its beginning',()=>{
 let height=80;
 vi.spyOn(HTMLElement.prototype,'scrollHeight','get').mockImplementation(()=>height);
 vi.spyOn(HTMLElement.prototype,'clientHeight','get').mockReturnValue(100);
 const draw=(text:string,key='one')=>React.createElement('div',{'data-scene-map':'true'},React.createElement(DialogueReadout,{passageKey:key,currentSegment:{type:'dialogue',speaker:'路人',text:'逐渐出现的完整对话'},displayedText:text,sceneName:'街口',hasSceneImage:false}));
 const view=render(draw('逐渐'));
 const panel=screen.getByLabelText('当前对话读条').querySelector<HTMLElement>('.eidos-dialogue-readout__text')!;expect(panel.scrollTop).toBe(0);
 height=300;view.rerender(draw('逐渐出现'));expect(panel.scrollTop).toBe(300);
 panel.scrollTop=20;height=400;view.rerender(draw('逐渐出现的完整'));expect(panel.scrollTop).toBe(20);
 view.rerender(draw('新的对话','two'));expect(panel.scrollTop).toBe(0);
});
