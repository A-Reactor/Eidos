// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ActionInput } from '@/components/game/ActionInput';
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function renderInput(overrides: Partial<React.ComponentProps<typeof ActionInput>> = {}) {
  const props: React.ComponentProps<typeof ActionInput> = { allSegmentsShown: true, isLoading: false, inputValue: '', onInputChange: vi.fn(), onSubmit: vi.fn(), preActionInput: '观察周围', ...overrides };
  render(React.createElement(ActionInput, props)); return props;
}
describe('ActionInput', () => {
  it('remains available while reading and has no action menu', () => {
    renderInput({ allSegmentsShown: false });
    const input = screen.getByRole('textbox', { name: '行动输入' }) as HTMLTextAreaElement;
    expect(input.disabled).toBe(false); expect(input.placeholder).toContain('随时输入行动');
    expect(screen.queryByRole('button', { name: '打开行动菜单' })).toBeNull();
    expect(screen.queryByText('ACTION MENU')).toBeNull();
  });
  it('uses a single stop control during generation even with a queued draft', () => {
    const stop = vi.fn(); const props = renderInput({ isLoading: true, inputValue: '等等', onStop: stop });
    expect(screen.getAllByRole('button')).toHaveLength(1);
    const button = screen.getByRole('button', { name: '停止生成' });
    expect(button.querySelector('rect')).not.toBeNull();
    fireEvent.click(button); expect(stop).toHaveBeenCalledOnce();
    expect(props.onSubmit).not.toHaveBeenCalled();
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('等等');
  });
  it('disables empty and whitespace-only sends, including Enter', () => {
    const props = renderInput({ inputValue: ' \n ' });
    const button = screen.getByRole('button', { name: '发送行动' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button); fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
    expect(props.onSubmit).not.toHaveBeenCalled();
  });
  it('keeps Enter from submitting a draft while the stop control is shown', () => {
    const props = renderInput({ isLoading: true, inputValue: '下一步行动', onStop: vi.fn() });
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
    expect(props.onSubmit).not.toHaveBeenCalled(); expect(props.onStop).not.toHaveBeenCalled();
  });
  it('returns to the enabled send arrow after generation ends and keeps the draft', () => {
    const props = { allSegmentsShown: false, isLoading: true, inputValue: '下一步行动', onInputChange: vi.fn(), onSubmit: vi.fn(), onStop: vi.fn(), preActionInput: '' };
    const view = render(React.createElement(ActionInput, props));
    view.rerender(React.createElement(ActionInput, { ...props, isLoading: false }));
    const button = screen.getByRole('button', { name: '发送行动' }) as HTMLButtonElement;
    expect(button.disabled).toBe(false); expect(button.querySelector('svg')).not.toBeNull();
    expect(button.querySelector('rect')).toBeNull();
    expect(screen.queryByRole('button', { name: '停止生成' })).toBeNull();
    fireEvent.click(button); expect(props.onSubmit).toHaveBeenCalledOnce();
  });
  it('keeps generation unavailable when no stop callback exists', () => {
    const props = renderInput({ isLoading: true, inputValue: '还不能发送' });
    const button = screen.getByRole('button', { name: '正在生成' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true); fireEvent.click(button);
    expect(props.onSubmit).not.toHaveBeenCalled();
  });
  it('passes every dropped file through', () => {
    const onFilesDrop=vi.fn(); renderInput({onFilesDrop});
    const files=[new File(['密码'],'password.txt'),new File(['地图'],'map.md')];
    fireEvent.drop(screen.getByRole('textbox'),{dataTransfer:{files}});expect(onFilesDrop).toHaveBeenCalledWith(files);
  });
  it('preserves composition and Shift+Enter, sends plain Enter', () => {
    const props=renderInput({inputValue:'你好'}); const input=screen.getByRole('textbox');
    fireEvent.keyDown(input,{key:'Enter',isComposing:true});fireEvent.keyDown(input,{key:'Enter',shiftKey:true});
    expect(props.onSubmit).not.toHaveBeenCalled();fireEvent.keyDown(input,{key:'Enter'});expect(props.onSubmit).toHaveBeenCalledOnce();
  });
  it('does not replace a multiline draft on plain arrow keys', () => {
    const props=renderInput({inputValue:'一\n二'});fireEvent.keyDown(screen.getByRole('textbox'),{key:'ArrowUp'});expect(props.onInputChange).not.toHaveBeenCalled();
  });
  it('uses Enter for a newline on a phone and sends only with the explicit button', () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })));
    const props = renderInput({ inputValue: '仔细看看' });
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
    expect(props.onSubmit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '发送行动' }));
    expect(props.onSubmit).toHaveBeenCalledOnce();
  });
  it('shrinks a multiline draft after submission clears it', () => {
    const props = { allSegmentsShown: true, isLoading: false, inputValue: '一\n二\n三', onInputChange: vi.fn(), onSubmit: vi.fn(), preActionInput: '' };
    const view = render(React.createElement(ActionInput, props));
    const input = screen.getByRole('textbox') as HTMLTextAreaElement;
    Object.defineProperty(input, 'scrollHeight', { configurable: true, value: 140 });
    view.rerender(React.createElement(ActionInput, { ...props, inputValue: props.inputValue + '\n四' }));
    expect(input.style.height).toBe('140px');
    Object.defineProperty(input, 'scrollHeight', { configurable: true, value: 48 });
    view.rerender(React.createElement(ActionInput, { ...props, inputValue: '' }));
    expect(input.style.height).toBe('48px');
  });
  it('keeps the reference decoration viewport at the native textarea scroll position', () => {
    renderInput({ inputValue: '[报告](document://report/material_1234567890abcdef)\n' + '正文\n'.repeat(20) });
    const input = screen.getByRole('textbox') as HTMLTextAreaElement;
    const layer = input.parentElement!.querySelector('.eidos-composer-link-layer') as HTMLDivElement;
    input.scrollTop = 64; input.scrollLeft = 3; fireEvent.scroll(input);
    expect(layer.scrollTop).toBe(64); expect(layer.scrollLeft).toBe(3);
    expect(input.value).toContain('报告\n正文');
  });

  it('keeps a recoverable save error and its explicit retry in the same accessible notice', () => {
    const retry = vi.fn();
    renderInput({ generationError: '本地保存失败，候选文档已保留。', onRetry: retry });
    const alert = screen.getByRole('alert');
    const button = screen.getByRole('button', { name: '重试文档保存' });
    expect(alert.contains(button)).toBe(true);
    fireEvent.click(button); expect(retry).toHaveBeenCalledOnce();
  });

});
