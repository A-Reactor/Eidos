'use client';
import { useInterfaceText } from "@/components/shell/useInterfaceText";

import { useState } from 'react';
import { useGameStore } from '@/store/game-store';
import { captureAuthorRepro } from '@/lib/game/author-repro';
import { saveFile } from '@/lib/game/save-file';

export function AuthorReproControl() {
  const ui = useInterfaceText();
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  return <div className="border-b border-current/15 py-4">
    <h3 className="font-medium">{ui("离线复现场景")}</h3>
    <p className="my-2 text-xs opacity-65">{ui("保存当前模组版本、进度和正文，在作者实验室重放。文件含世界隐藏设定；不包含连接密钥、原卡原件和媒体文件。")}</p>
    <button className="eidos-focus eidos-dossier-action min-h-10 px-4 py-2 text-sm" disabled={busy} onClick={async () => {
      setBusy(true); setMessage('');
      try {
        const result = await saveFile(async () => {
          const repro = await captureAuthorRepro(useGameStore);
          return new Blob([JSON.stringify(repro, null, 2)], { type: 'application/json' });
        }, 'scene.eidos-repro.json');
        if (result === 'cancelled') return;
        setMessage(ui("现场已导出。作者可运行 npm run dev:author，在实验室导入文件。"));
      } catch (error) { setMessage(error instanceof Error ? error.message : ui("现场导出失败")); }
      finally { setBusy(false); }
    }}>{busy ? ui("正在保存现场…") : ui("导出复现场景")}</button>
    {message && <p role="status" className="mt-2 text-xs">{message}</p>}
  </div>;
}
