// @vitest-environment jsdom
import React from 'react';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { SegmentNav } from '@/components/game/SegmentNav';
afterEach(cleanup);
it('keeps progress visible in review, highlights only selected playback, and allows selecting a paragraph', () => {
 const onSelect=vi.fn(); const props={isShowingSegments:false,segmentIndex:1,segmentsLength:3,onSelect};
 const view=render(React.createElement(SegmentNav,props));
 expect(screen.getByRole('navigation',{name:'叙事段落进度'})).toBeTruthy();
 expect(view.container.querySelector('[aria-current]')).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'播放第 3 段'})); expect(onSelect).toHaveBeenCalledWith(2);
 view.rerender(React.createElement(SegmentNav,{...props,isShowingSegments:true}));
 expect(screen.getByRole('button',{name:'播放第 2 段'}).getAttribute('aria-current')).toBe('step');
 expect(screen.queryByRole('button',{name:'继续'})).toBeNull();
});
