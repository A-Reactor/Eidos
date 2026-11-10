"use client";
import { useRef, useState, type ChangeEvent } from 'react';
import { exportAiConfig, importAiConfig } from '@/lib/ai/config-document';
import { saveFile } from '@/lib/game/save-file';
import type { GameSettings } from '@/lib/game/types';
import { useI18n } from '@/components/shell/LocaleProvider';

export function AiConfigDocument({ settings, onImport }: { settings: GameSettings; onImport: (patch: Partial<GameSettings>) => void }) {
  const { locale } = useI18n(), picker = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState(''), [error, setError] = useState('');
  const text = (zh: string, en: string) => locale === 'en' ? en : zh;
  async function load(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; event.target.value = '';
    if (!file) return;
    setError(''); setMessage('');
    try {
      if (file.size > 128 * 1024) throw new Error(text('配置文件不能超过 128 KB', 'Configuration files must be smaller than 128 KB'));
      const patch = importAiConfig(await file.text(), settings);
      onImport(patch);
      setMessage(text('配置已载入草稿，请检查后保存。', 'Configuration loaded into the draft. Review and save.'));
    } catch (cause) { setError(cause instanceof Error ? cause.message : text('配置导入失败', 'Configuration import failed')); }
  }
  async function download() {
    setError(''); setMessage('');
    try {
      const result = await saveFile(new Blob([exportAiConfig(settings)], { type: 'application/json;charset=utf-8' }), 'eidos-ai-config.json');
      if (result !== 'cancelled') setMessage(text('配置已导出，不含 API 密钥。', 'Configuration exported without API keys.'));
    } catch (cause) { setError(cause instanceof Error ? cause.message : text('配置导出失败', 'Configuration export failed')); }
  }
  return <div className="space-y-3 border-t border-current/15 pt-4">
    <h3 className="text-sm font-medium">{text('AI 配置文件', 'AI configuration file')}</h3>
    <p className="text-xs leading-6 opacity-65">{text('导出不含密钥与提示词。导入需保存；更换供应商或地址会清空对应密钥。', 'Exports exclude keys and custom instructions. Save to apply imports; changing a provider or endpoint clears its key.')}</p>
    <div className="flex flex-wrap gap-3">
      <input ref={picker} type="file" accept=".json,application/json" className="sr-only" aria-label={text('导入 AI 配置文件', 'Import AI configuration file')} onChange={event => void load(event)} />
      <button className="eidos-focus eidos-archive-button" onClick={() => picker.current?.click()}>{text('导入配置', 'Import configuration')}</button>
      <button className="eidos-focus eidos-archive-button" onClick={() => void download()}>{text('导出配置', 'Export configuration')}</button>
    </div>
    {message && <p role="status" className="text-xs leading-6">{message}</p>}
    {error && <p role="alert" className="text-xs leading-6">{error}</p>}
  </div>;
}
