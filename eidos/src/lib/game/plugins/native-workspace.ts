interface TauriBridge { core: { invoke<T>(command: string, args: Record<string, unknown>): Promise<T> } }
function bridge(): TauriBridge | undefined {
  return typeof window === 'undefined' ? undefined : (window as Window & { __TAURI__?: TauriBridge }).__TAURI__;
}
export const nativeWorkspaceAvailable = () => Boolean(bridge()?.core?.invoke);
export async function nativeWorkspaceFile(workspace: string, path: string, content?: string, expectedContent?: string | null): Promise<{ content: string; directory: string }> {
  const api = bridge();
  if (!api) throw new Error('当前运行环境没有桌面工作目录接口');
  return api.core.invoke('mod_workspace_file', { workspace, path, content, expectedContent });
}
