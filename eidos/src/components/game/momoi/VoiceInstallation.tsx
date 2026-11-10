'use client';
import { useInterfaceText } from "@/components/shell/useInterfaceText";

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useGameStore } from '@/store/game-store';
import { EidosButton } from '@/components/ui/EidosScreen';
import { VOICE_LANGUAGES, availableVoiceLanguages, type VoiceInstallation as Report } from '@/lib/game/momoi/languages';
import { checkVoiceInstallation, installationInput, installationModelNames } from '@/lib/game/momoi/installation-client';
import { resolveAiRoleConfig } from '@/lib/ai/providers/config';
import { loadSettings } from '@/lib/game/settings';
const InstallationContext = createContext({ report: null as Report | null, checking: false, error: '', refresh: () => {} });
export const useVoiceInstallation = () => useContext(InstallationContext);
export function VoiceInstallationProvider({ children }: { children: ReactNode }) {
  const config = useGameStore(state => state.voiceConfig);
  const input = JSON.stringify(installationInput(config, config.speakers));
  const [revision, setRevision] = useState(0);
  const key = `${input}:${revision}`;
  const [result, setResult] = useState({ key: '', report: null as Report | null, checking: true, error: '' });
  useEffect(() => {
    const abort = new AbortController();
    void checkVoiceInstallation(JSON.parse(input), AbortSignal.any([abort.signal, AbortSignal.timeout(35_000)]))
      .then(report => { if (!abort.signal.aborted) setResult({ key, report, checking: false, error: '' }); })
      .catch(error => { if (!abort.signal.aborted) setResult({ key, report: null, checking: false, error: error.message }); });
    return () => abort.abort();
  }, [input, key]);
  const value = result.key === key ? result : { report: null, checking: true, error: '' };
  return <InstallationContext.Provider value={{ ...value, refresh: () => setRevision(value => value + 1) }}>{children}</InstallationContext.Provider>;
}
export function VoiceInstallationCheck() {
  const ui = useInterfaceText();
  const config = useGameStore(state => state.voiceConfig);
  const modelNames = installationModelNames(config);
  const { report, checking, error, refresh } = useVoiceInstallation();
  const supported = report ? availableVoiceLanguages(report) : [];
  const pending = report ? [...report.checks, ...report.languageResources, ...report.models].filter(check => !check.ready).length : 0;
  const translation = resolveAiRoleConfig('alice', loadSettings());
  return <section aria-label={ui("语音环境检查")} className="eidos-audio-installation space-y-5">
    <div className="eidos-audio-check-toolbar">
      <div><h3>{ui("语音环境检查")}</h3><p>{ui("仅读取安装情况，不下载模型。")}</p></div>
      <EidosButton disabled={checking} onClick={refresh}>{checking ? ui("正在检查安装…") : ui("检查安装情况")}</EidosButton>
    </div>
    {error && <p role="alert" className="eidos-audio-notice">{error}</p>}
    {report && <>
      <div className="eidos-audio-health" aria-label={ui("安装概览")}>
        <div><span>{ui("就绪模型")}</span><strong>{report.models.filter(model => model.ready).length} / {report.models.length}</strong></div>
        <div><span>{ui("可用语言")}</span><strong>{supported.length}</strong></div>
        <div data-warning={pending > 0}><span>{ui("待处理项")}</span><strong>{pending}</strong></div>
      </div>
      <p role="status" className="eidos-audio-notice">{ui("当前权重可用的译文语言：")}{supported.map(id => ui(VOICE_LANGUAGES[id])).join(ui('、')) || ui("尚未确认，请查看检查明细")}</p>
      <div className="eidos-audio-check-grid">
      <section className="eidos-audio-block" aria-label={ui("已选权重")}>
        <h3>{ui("已选权重")}</h3>
        {report.models.map((model, index) => <div key={index} className="eidos-audio-check-row" data-ready={model.ready}><span>{modelNames[index] ?? ui("模型 {0}", {"0": index + 1})}<b>{model.version ?? ui("未知版本")}</b></span><p>{model.error || (model.ready ? model.languages.map(id => ui(VOICE_LANGUAGES[id])).join(ui('、')) : ui("环境未就绪，请查看检查明细"))}</p></div>)}
      </section>
      <section className="eidos-audio-block" aria-label={ui("语言资源")}>
        <h3>{ui("语言资源")}</h3>
        {report.languageResources.length ? report.languageResources.map(check => <div key={check.id} className="eidos-audio-check-row" data-ready={check.ready}>
          <span>{ui(VOICE_LANGUAGES[check.id])}<b>{check.ready ? ui("已就绪") : ui("待补齐")}</b></span><p>{check.detail}</p>
        </div>) : <p className="eidos-audio-caption">{ui("尚无法核实，请查看下方检查明细。")}</p>}
      </section>
      </div>
      <details className="eidos-audio-support" open={pending > 0}><summary>{ui("安装检查明细")}{pending > 0 ? ui(" · {0} 项待处理", {"0": pending}) : ''}</summary>
        <div className="eidos-audio-check-row" data-ready={Boolean(translation.apiKey)}><span>{ui("翻译连接")}<b>{translation.apiKey ? ui("已配置") : ui("待配置")}</b></span><p>{translation.apiKey ? ui("ALICE / {0}，未发起付费测试", {"0": translation.model}) : ui("请在 AI 设置中配置 ALICE 密钥")}</p></div>
        {report.checks.map(check => <div key={check.label} className="eidos-audio-check-row" data-ready={check.ready}><span>{ui(check.label)}<b>{check.ready ? ui("已就绪") : ui("待处理")}</b></span><p>{check.detail}</p></div>)}
      </details>
    </>}
  </section>;
}
