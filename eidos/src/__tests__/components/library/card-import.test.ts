// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CardImportDialog } from '@/components/library/CardImportDialog';
afterEach(cleanup);
describe('card import preview', () => {
  it('reads a dropped original card and keeps its bytes intact when mounting it', async () => {
    const onMount = vi.fn().mockResolvedValue(undefined);
    render(React.createElement(CardImportDialog, { worlds: [], onMount, onClose: vi.fn() }));
    const original = JSON.stringify({ name: '雨港', description: '港口的灯还亮着。' });
    fireEvent.drop(screen.getByRole('button', { name: '导入酒馆卡文件' }), {
      dataTransfer: { files: [new File([original], 'port.json', { type: 'application/json' })] },
    });
    await screen.findByText('雨港');
    fireEvent.click(screen.getByRole('button', { name: '保存并创建卡片世界' }));
    await waitFor(() => expect(onMount).toHaveBeenCalledOnce());
    expect(new TextDecoder().decode(onMount.mock.calls[0][0].bytes)).toBe(original);
  });
  it('shows untouched source and chooses world rather than NPC binding explicitly', async () => {
    const onMount = vi.fn().mockResolvedValue(undefined);
    render(React.createElement(CardImportDialog, { worlds: [], onMount, onClose: vi.fn() }));
    const file = new File([JSON.stringify({ name: '灯塔', description: '甲\n  乙\\n', first_mes: '<div>开场</div>' })], 'card.json');
    fireEvent.change(screen.getByLabelText('选择原卡文件'), { target: { files: [file] } });
    await screen.findByText('灯塔');
    expect(screen.getByLabelText('原文预览').textContent).toContain('甲\n  乙\\n');
    fireEvent.change(screen.getByLabelText('挂载用途'), { target: { value: 'world' } });
    fireEvent.click(screen.getByRole('button', { name: '保存并创建卡片世界' }));
    await waitFor(() => expect(onMount).toHaveBeenCalledWith(expect.objectContaining({ role: 'world', filename: 'card.json' })));
  });
  it('reports template dependency and disables play while allowing original preservation', async () => {
    render(React.createElement(CardImportDialog, { worlds: [], onMount: vi.fn(), onClose: vi.fn() }));
    const file = new File([JSON.stringify({ name: '复杂卡', description: '<% if (level > 70) { %>秘密<% } %>' })], 'complex.json');
    fireEvent.change(screen.getByLabelText('选择原卡文件'), { target: { files: [file] } });
    await screen.findByText(/模板未支持/);
    expect((screen.getByRole('button', { name: '保存并创建卡片世界' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('button', { name: '仅保存原卡' })).not.toBeNull();
  });
  it('mounts a supported conditional card and records explicit public paths outside the original file', async () => {
    const onMount = vi.fn().mockResolvedValue(undefined);
    render(React.createElement(CardImportDialog, { worlds: [], onMount, onClose: vi.fn() }));
    const source = JSON.stringify({ name: '条件门卫', description: "<% if (getvar('stat_data.trust') > 60) { %>通过<% } %>", character_book: { entries: [{ comment: '[InitVar]', enabled: false, content: '{"trust":20,"secret":"隐藏"}' }] } });
    fireEvent.change(screen.getByLabelText('选择原卡文件'), { target: { files: [new File([source], 'advanced.json')] } });
    await screen.findByText('条件门卫');
    expect((screen.getByRole('button', { name: '保存并创建卡片世界' }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole('checkbox', { name: '公开变量 trust' }) as HTMLInputElement).checked).toBe(false);
    fireEvent.click(screen.getByRole('checkbox', { name: '公开变量 trust' }));
    fireEvent.click(screen.getByRole('button', { name: '保存并创建卡片世界' }));
    await waitFor(() => expect(onMount).toHaveBeenCalledWith(expect.objectContaining({ publicVariables: ['trust'] })));
    expect(new TextDecoder().decode(onMount.mock.calls[0][0].bytes)).toBe(source);
  });
});
