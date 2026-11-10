export type SaveFileResult = 'saved' | 'downloaded' | 'cancelled';
interface WritableFile { write(data: Blob): Promise<void>; close(): Promise<void>; abort?(): Promise<void> }
interface SaveWindow extends Window {
  showSaveFilePicker?: (options: { suggestedName: string }) => Promise<{ createWritable(): Promise<WritableFile> }>;
  __TAURI__?: { core: { invoke<T>(command: string, args: Record<string, unknown> | Uint8Array, options?: { headers: Record<string, string> }): Promise<T> } };
}

/** Only the user-selected target is written. A failed write never starts another export. */
export async function saveFile(source: Blob | (() => Promise<Blob>), suggestedName: string): Promise<SaveFileResult> {
  if (typeof window === 'undefined') throw new Error('请在应用中导出文件');
  const host = window as SaveWindow;
  const content = () => typeof source === 'function' ? source() : Promise.resolve(source);
  const filename = suggestedName.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').trim() || 'eidos-export';
  if (host.__TAURI__?.core?.invoke) {
    const invoke = host.__TAURI__.core.invoke;
    const token = await invoke<string | null>('export_file_select', { filename });
    if (!token) return 'cancelled';
    try {
      const blob = await content();
      // Raw IPC avoids expanding each byte into a JS number and serializing the entire array.
      const bytes = new Uint8Array(await blob.arrayBuffer());
      await invoke<boolean>('export_file', bytes, { headers: { 'x-eidos-export-token': token } });
      return 'saved';
    } catch (error) {
      await invoke('export_file_cancel', { token }).catch(cause => console.warn('[Export] 无法释放导出目标', cause));
      throw error;
    }
  }
  if (host.showSaveFilePicker) {
    let writable: WritableFile | undefined;
    try {
      const handle = await host.showSaveFilePicker({ suggestedName: filename });
      const blob = await content();
      writable = await handle.createWritable();
      await writable.write(blob); await writable.close();
      return 'saved';
    } catch (error) {
      if (writable?.abort) await writable.abort().catch(cause => console.warn('[Export] 无法中止文件写入', cause));
      if (error && typeof error === 'object' && 'name' in error && error.name === 'AbortError') return 'cancelled';
      throw error;
    }
  }
  if (!window.confirm('当前浏览器不支持选择保存位置，将按浏览器的下载设置保存文件。可在浏览器设置中开启“下载前询问保存位置”。是否继续？')) return 'cancelled';
  const blob = await content();
  const url = URL.createObjectURL(blob), anchor = document.createElement('a');
  try {
    anchor.href = url; anchor.download = filename; document.body.appendChild(anchor); anchor.click();
    return 'downloaded';
  } finally { anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
}
