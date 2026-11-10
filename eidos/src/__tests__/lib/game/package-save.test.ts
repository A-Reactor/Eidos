// @vitest-environment jsdom
import { Blob as NodeBlob } from 'node:buffer';
import { afterEach, expect, it, vi } from 'vitest';
import { exportPackage, writePackageToDirectory } from '@/lib/game/package-download';
import { parseZipImport } from '@/lib/game/import-records';
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it('saves a complete Unicode ZIP to the selected file with an importable round trip', async () => {
  vi.stubGlobal('Blob', NodeBlob);
  const write = vi.fn(), close = vi.fn();
  const picker = vi.fn(async () => ({ createWritable: async () => ({ write, close }) }));
  vi.stubGlobal('showSaveFilePicker', picker);
  const pkg = { rootName: '中文世界', files: [{ path: '报告.md', content: '# 原文\n\n' + '完整内容。'.repeat(10000), mimeType: 'text/markdown' }] };
  expect(await exportPackage(pkg)).toBe('single_file');
  expect(picker).toHaveBeenCalledWith({ suggestedName: '中文世界.eidos.zip' });
  const imported = await parseZipImport(write.mock.calls[0][0]);
  expect(imported.map(({ path, content }) => ({ path, content }))).toEqual(pkg.files.map(({ path, content }) => ({ path, content })));
  expect(close).toHaveBeenCalledOnce();
});

it('preserves directory write failures without silently starting a download', async () => {
  const picker = vi.fn(); vi.stubGlobal('showSaveFilePicker', picker);
  vi.stubGlobal('showDirectoryPicker', vi.fn(async () => ({ getDirectoryHandle: async () => { throw new Error('目录只读'); } })));
  await expect(writePackageToDirectory({ rootName: '世界', files: [] })).rejects.toThrow('目录只读');
  expect(picker).not.toHaveBeenCalled();
});

it('yields to the UI while building a multi-megabyte ZIP and preserves all bytes',async()=>{
 vi.stubGlobal('Blob',NodeBlob);let timerRan=false,paintedBeforeWrite=false;
 const write=vi.fn(async(_blob:Blob)=>{paintedBeforeWrite=timerRan;});
 vi.stubGlobal('showSaveFilePicker',vi.fn(async()=>({createWritable:async()=>({write,close:async()=>{}})})));
 const content='内容\n'.repeat(200000);setTimeout(()=>{timerRan=true;},0);
 await exportPackage({rootName:'big',files:[{path:'大文件.txt',content,mimeType:'text/plain'}]});
 expect(paintedBeforeWrite).toBe(true);
 const files=await parseZipImport(write.mock.calls[0][0]);expect(files[0].content).toBe(content);
});
