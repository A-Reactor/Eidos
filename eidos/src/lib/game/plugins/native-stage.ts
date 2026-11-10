import type { ModStage } from './workspace';
import { nativeWorkspaceAvailable } from './native-workspace';

interface NativeBridge { core: { invoke<T>(command: string, args: Record<string, unknown>): Promise<T> } }
export interface NativeStageLink { peer: Window; activate(): void; update(html: string): void; close(): void }
export async function openNativeStage(stage: ModStage, token: string, receive: (event: MessageEvent) => void, closed: () => void): Promise<NativeStageLink> {
  if (!nativeWorkspaceAvailable()) throw new Error('当前运行环境没有独立桌面窗口');
  const api = (window as unknown as Window & { __TAURI__: NativeBridge }).__TAURI__;
  const lease = crypto.randomUUID().replaceAll('-', '');
  const channel = new BroadcastChannel(`eidos-stage:${lease}`);
  let html = stage.html, disposed = false, active = false;
  const queued: MessageEvent[] = [];
  const peer = { postMessage: (data: unknown) => { if (!disposed) channel.postMessage({ kind: 'host', data }); } } as unknown as Window;
  channel.onmessage = event => {
    if (disposed) return;
    if (event.data?.kind === 'connect') channel.postMessage({ kind: 'document', html, token });
    if (event.data?.kind === 'command') {
      const message = { source: peer, data: event.data.data } as MessageEvent;
      if (active) receive(message); else queued.push(message);
    }
    if (event.data?.kind === 'closed') { disposed = true; channel.close(); closed(); }
  };
  const close = () => { if (disposed) return; disposed = true; channel.close(); void api.core.invoke('mod_stage_close', { lease }).catch(error => console.warn('辅助窗口关闭失败', error)); };
  try { await api.core.invoke('mod_stage_open', { lease, title: stage.title, width: stage.width, height: stage.height }); }
  catch (error) { channel.close(); throw error; }
  return { peer, close, activate() { active = true; for (const message of queued.splice(0)) receive(message); }, update(value) { if (html === value) return; html = value; if (!disposed) channel.postMessage({ kind: 'document', html, token }); } };
}
