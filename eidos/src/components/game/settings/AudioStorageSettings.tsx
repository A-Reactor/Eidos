'use client';
import { useEffect, useState } from 'react';
import { audioLimitMB, enforceAudioStorageLimit, setAudioLimitMB, type AudioCacheStats } from '@/lib/game/momoi/storage-quota';
import { useI18n } from '@/components/shell/LocaleProvider';

export function AudioStorageSettings() {
  const english = useI18n().locale === 'en';
  const [limit, setLimit] = useState(String(audioLimitMB()));
  const [stats, setStats] = useState<AudioCacheStats | null>(null), [message, setMessage] = useState(''), [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    void enforceAudioStorageLimit().then(result => { if (active) setStats(result); }).catch(error => { if (active) setMessage(String(error)); });
    return () => { active = false; };
  }, []);
  return <section className="space-y-3 border-b border-current/15 pb-6 mb-6" aria-label={english ? 'Audio storage' : '音频保存限制'}>
    <h3 className="font-medium">{english ? 'Audio cache' : '音频缓存'}</h3>
    <p className="text-xs leading-6 opacity-70">{english ? 'Oldest generated clips are cleared when full. Uploads and voice references are kept.' : '超限时清理最早的生成缓存，保留上传音频与参考音色。'}</p>
    <label className="flex items-center gap-3 text-sm">{english ? 'Limit (MB)' : '容量上限（MB）'}<input aria-label={english ? 'Limit (MB)' : '容量上限（MB）'} type="number" min="1" max="1048576" step="1" className="eidos-settings-control w-32 p-2" value={limit} onChange={event => setLimit(event.target.value)} /></label>
    {stats && <p className="text-xs opacity-65">{english ? 'Generated cache' : '生成缓存'} · {(stats.afterBytes / 1024 / 1024).toFixed(1)} MB · {english ? 'Uploaded audio' : '上传音频'} {(stats.protectedBytes / 1024 / 1024).toFixed(1)} MB</p>}
    <button className="eidos-dossier-action eidos-focus px-4 py-2 text-sm" disabled={busy} onClick={async () => {
      setBusy(true); setMessage('');
      try { const result = await setAudioLimitMB(Number(limit)); setStats(result); setMessage(english ? `Limit applied. Removed ${result.deletedKeys.length} clips.` : `限制已应用，清理 ${result.deletedKeys.length} 段缓存。`); }
      catch (error) { setMessage(error instanceof Error ? error.message : '音频清理失败'); }
      finally { setBusy(false); }
    }}>{busy ? (english ? 'Applying…' : '正在清理…') : (english ? 'Apply limit' : '应用并清理')}</button>
    {message && <p role="status" className="text-xs leading-6">{message}</p>}
  </section>;
}
