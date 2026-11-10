// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { saveFile } from '@/lib/game/save-file';
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it('writes the original Blob to the chosen browser file and closes it', async () => {
  const write = vi.fn(), close = vi.fn(), picker = vi.fn(async () => ({ createWritable: async () => ({ write, close }) }));
  vi.stubGlobal('showSaveFilePicker', picker);
  const blob = new Blob([Uint8Array.from([0, 255, 17])], { type: 'application/zip' });
  expect(await saveFile(blob, '世界.eidos.zip')).toBe('saved');
  expect(picker).toHaveBeenCalledWith(expect.objectContaining({ suggestedName: '世界.eidos.zip' }));
  expect(write).toHaveBeenCalledWith(blob); expect(close).toHaveBeenCalledOnce();
});

it('does not download after cancellation or a write error', async () => {
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  vi.stubGlobal('showSaveFilePicker', vi.fn().mockRejectedValue(new DOMException('Cancelled', 'AbortError')));
  expect(await saveFile(new Blob(['text']), 'report.md')).toBe('cancelled');
  vi.stubGlobal('showSaveFilePicker', vi.fn(async () => ({ createWritable: async () => { throw new Error('磁盘只读'); } })));
  await expect(saveFile(new Blob(['text']), 'report.md')).rejects.toThrow('磁盘只读');
  expect(click).not.toHaveBeenCalled();
});

it('can cancel the explicit browser-download fallback before any download starts', async () => {
  vi.stubGlobal('showSaveFilePicker', undefined); vi.spyOn(window, 'confirm').mockReturnValue(false);
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  expect(await saveFile(new Blob(['text']), 'report.md')).toBe('cancelled');
  expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('下载设置'));
  expect(click).not.toHaveBeenCalled();
});

it('selects a desktop target before packaging and sends raw bytes instead of a JSON number array',async()=>{
 const order:string[]=[];const payloads:unknown[]=[];
 const invoke=vi.fn(async(command:string,args:unknown,options:unknown)=>{order.push(command);payloads.push([args,options]);return command==='export_file_select'?'target-token':true;});
 vi.stubGlobal('__TAURI__',{core:{invoke}});
 const picker=vi.fn();vi.stubGlobal('showSaveFilePicker',picker);
 const blob=new Blob(['abc']);Object.defineProperty(blob,'arrayBuffer',{value:async()=>new TextEncoder().encode('abc').buffer});
 const source=async()=>{order.push('prepare');return blob;};
 expect(await saveFile(source,'报告.md')).toBe('saved');
 expect(order).toEqual(['export_file_select','prepare','export_file']);
 expect(payloads[0]).toEqual([{filename:'报告.md'},undefined]);
 expect(payloads[1]).toEqual([new Uint8Array([97,98,99]),{headers:{'x-eidos-export-token':'target-token'}}]);
 expect(picker).not.toHaveBeenCalled();
});
it('does not build a cancelled desktop archive and releases the target after a packing failure',async()=>{
 const source=vi.fn(async()=>{throw new Error('缺少原件');});
 const invoke=vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce('target-token').mockResolvedValueOnce(true);
 vi.stubGlobal('__TAURI__',{core:{invoke}});
 expect(await saveFile(source,'archive.zip')).toBe('cancelled');expect(source).not.toHaveBeenCalled();
 await expect(saveFile(source,'archive.zip')).rejects.toThrow('缺少原件');
 expect(invoke).toHaveBeenLastCalledWith('export_file_cancel',{token:'target-token'});
});

it('opens the picker before asynchronous packaging and does not prepare cancelled exports', async () => {
  const order: string[] = [];
  const source = vi.fn(async () => { order.push('prepare'); return new Blob(['prepared']); });
  vi.stubGlobal('showSaveFilePicker', vi.fn(async () => {
    order.push('picker');
    return { createWritable: async () => { order.push('open'); return { write: async () => { order.push('write'); }, close: async () => { order.push('close'); } }; } };
  }));
  expect(await saveFile(source, 'archive.zip')).toBe('saved');
  expect(order).toEqual(['picker', 'prepare', 'open', 'write', 'close']);
  source.mockClear();
  vi.stubGlobal('showSaveFilePicker', vi.fn().mockRejectedValue(new DOMException('Cancelled', 'AbortError')));
  expect(await saveFile(source, 'archive.zip')).toBe('cancelled');
  expect(source).not.toHaveBeenCalled();
});
