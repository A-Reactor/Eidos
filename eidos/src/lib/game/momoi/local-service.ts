/** Generation owns startup so previews, playback and batch requests share the same lifecycle. */
export async function ensureLocalVoiceService(signal: AbortSignal) {
  const startupSignal = AbortSignal.any([signal, AbortSignal.timeout(135_000)]);
  startupSignal.throwIfAborted();
  const response = await fetch('/api/momoi/start', { method: 'POST', signal: startupSignal });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.ok) throw new Error(data?.error || '本地语音服务启动失败，请查看安装检查');
  if (['ready', 'already_running'].includes(data.status)) return;
  if (data.status !== 'loading_model') throw new Error('本地语音服务返回了未知启动状态');
  while (true) {
    await new Promise<void>((resolve, reject) => {
      const abort = () => { clearTimeout(timer); reject(startupSignal.reason); };
      const timer = setTimeout(() => { startupSignal.removeEventListener('abort', abort); resolve(); }, 1000);
      startupSignal.addEventListener('abort', abort, { once: true });
      if (startupSignal.aborted) abort();
    });
    const check = await fetch('/api/momoi/status', { cache: 'no-store', signal: startupSignal });
    const status = await check.json().catch(() => null);
    if (!check.ok || !status) throw new Error(status?.error || '无法读取本地模型加载状态');
    if (status.status === 'ready') return;
    if (!['loading', 'busy'].includes(status.status)) throw new Error(status.error || status.hint || '本地语音模型未能就绪');
  }
}
