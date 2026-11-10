// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { MobilePlayBar } from '@/components/game/MobilePlayBar';
afterEach(cleanup);
const props = () => ({ index: 1, count: 4, showing: true, loading: false, modActive: false, onSelect: vi.fn() });
it('uses equal divider segments and keeps only accessible progress, without a toolbar', () => {
  const actions = props(); const view = render(React.createElement(MobilePlayBar, actions));
  expect(screen.queryByRole('button')).toBeNull();
  const marks = view.container.querySelectorAll('[data-read]');
  expect(marks).toHaveLength(4);
  expect([...marks].map(mark => mark.getAttribute('data-read'))).toEqual(['true', 'true', 'false', 'false']);
  fireEvent.change(screen.getByRole('slider', { name: '当前叙事段落' }), { target: { value: '3' } });
  expect(actions.onSelect).toHaveBeenCalledWith(2);
  expect(screen.queryByText(/第 .* 步|档案|继续阅读/)).toBeNull();
});
it('allows selecting received paragraphs during generation but locks navigation and mod-controlled reading', () => {
  const actions = props(); const view = render(React.createElement(MobilePlayBar, { ...actions, showing: false }));
  expect(view.container.querySelectorAll('[data-read="true"]')).toHaveLength(4);
  view.rerender(React.createElement(MobilePlayBar, { ...actions, loading: true }));
  expect((screen.getByRole('slider') as HTMLInputElement).disabled).toBe(false);
  fireEvent.change(screen.getByRole('slider'), { target: { value: '3' } });
  expect(actions.onSelect).toHaveBeenCalledWith(2);
  view.rerender(React.createElement(MobilePlayBar, { ...actions, busy: true }));
  expect((screen.getByRole('slider') as HTMLInputElement).disabled).toBe(true);
  view.rerender(React.createElement(MobilePlayBar, { ...actions, modActive: true }));
  expect(view.container.childElementCount).toBe(0);
});

it('previews progress without highlighting a paragraph until it is selected', () => {
  const actions = { ...props(), focused: false };
  const view = render(React.createElement(MobilePlayBar, actions));
  expect(view.container.querySelector('[data-current="true"]')).toBeNull();
  expect(screen.getByRole('slider').getAttribute('aria-valuetext')).toBe('第 2 段，共 4 段');
  view.rerender(React.createElement(MobilePlayBar, { ...actions, focused: true }));
  expect(view.container.querySelectorAll('[data-current="true"]')).toHaveLength(1);
});
