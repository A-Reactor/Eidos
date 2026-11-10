"use client";
import { useInterfaceText } from "@/components/shell/useInterfaceText";

import { useState } from "react";
import { useGameStore } from "@/store/game-store";
import { EidosButton } from "@/components/ui/EidosScreen";
import { FileImportCard } from '@/components/ui/FileImportCard';
import { SettingsField as EidosField } from "../settings/SettingsField";
import { resolveVoice, type SpeakerVoice } from "@/lib/game/momoi/model";
import { VOICE_LANGUAGES, availableVoiceLanguages } from '@/lib/game/momoi/languages';
import { useVoiceInstallation } from './VoiceInstallation';
import { VoiceTarget } from './VoiceTarget';
import { VoiceTrainedModels } from './VoiceTrainedModels';
const control = "eidos-field w-full rounded-sm border border-current/20 p-2.5 text-sm";
export function VoiceCasting({ speaker, onSpeakerChange }: { speaker: string; onSpeakerChange: (speaker: string) => void }) {
  const ui = useInterfaceText();
  const config = useGameStore(s => s.voiceConfig);
  const patch = useGameStore(s => s.setVoiceConfig);
  const [error, setError] = useState("");
  const voice = speaker ? config.speakers[speaker] ?? {} : config;
  const resolved = resolveVoice(config, speaker);
  const { report } = useVoiceInstallation();
  const languages = report ? availableVoiceLanguages(report) : [];
  const referenceLanguage = resolved.referenceLanguage ?? config.language;
  const local = config.provider === 'legacy';
  const hasWeights = Boolean(voice.gptWeights || voice.sovitsWeights);
  const defaultModel = config.gptWeights || config.sovitsWeights ? config.modelName || config.model || ui("自定义权重") : local ? ui("初始权重") : ui("服务当前模型");
  const currentModel = hasWeights ? voice.modelName || (speaker ? ui("角色自定义权重") : defaultModel) : speaker ? ui("沿用默认模型 · {0}", {"0": defaultModel}) : defaultModel;
  function update(value: Partial<SpeakerVoice>) {
    if (speaker) patch({ speakers: { ...config.speakers, [speaker]: { ...voice, ...value } } });
    else patch(value);
  }
  function updateReference(value: Partial<SpeakerVoice>) {
    update({ referenceAudio: resolved.referenceAudio, referencePath: resolved.referencePath, referenceText: resolved.referenceText,
      referenceLanguage: resolved.referenceLanguage ?? config.language, ...value });
  }
  return <fieldset className="eidos-audio-casting">
    <legend>{ui("角色音色与权重")}</legend>
    <VoiceTarget speaker={speaker} onChange={onSpeakerChange} />
    {config.provider === 'compatible' && <EidosField id="voice-id" label={ui("音色 ID")} hint={speaker ? ui("留空时使用默认音色") : ui("用于没有单独设置音色的角色")}><input id="voice-id" className={control} value={voice.voice ?? ""} onChange={e => update({ voice: e.target.value })} /></EidosField>}
    <div className="eidos-audio-casting-grid">
    {config.provider !== 'compatible' && <section aria-label={ui("模型加载")} className="eidos-audio-block eidos-audio-model space-y-3">
      <h3 className="text-sm font-medium">{ui("模型加载")}</h3>
      <p className="text-xs leading-6">{ui("当前配置：")}{currentModel}</p>
      {local && <VoiceTrainedModels key={speaker} speaker={speaker} />}
      <EidosButton disabled={!hasWeights} onClick={() => {
        if (!speaker && local) patch({ gptWeights: '', sovitsWeights: '', model: '', trainingJobId: '', modelName: '' });
        else update({ gptWeights: '', sovitsWeights: '', trainingJobId: '', modelName: '' });
      }}>{speaker ? ui("使用默认模型") : local ? ui("恢复初始权重") : ui("使用服务当前模型")}</EidosButton>
      <p className="eidos-audio-caption">{speaker ? ui("只切换当前角色模型，保留参考录音。") : ui("只切换默认模型，独立角色配置保留。")} {ui("下次生成时生效。")}</p>
      <details className="space-y-3">
        <summary className="cursor-pointer text-sm">{local ? ui("权重路径（高级）") : ui("社区模型与 LoRA（可选）")}</summary>
        <p className="eidos-audio-caption">{ui("GPT / SoVITS 路径需成对填写，文件位于语音服务所在电脑。LoRA 需先安装对应底模。")}</p>
        {speaker && <p className="text-xs opacity-65 leading-6">{ui("留空沿用默认模型；使用外部 API v2 时，请先配置默认权重，便于其他角色切回。")}</p>}
        <EidosField id="voice-gpt-weights" label={ui("GPT 权重路径")}><input id="voice-gpt-weights" className={control} value={voice.gptWeights ?? ''} placeholder={speaker ? config.gptWeights || ui("沿用默认 GPT 权重") : local ? ui("留空使用初始 GPT 权重") : 'GPT_weights_v4/character.ckpt'} maxLength={2000} onChange={e => update({ gptWeights: e.target.value, trainingJobId: '', modelName: '', ...(!speaker ? { model: '' } : {}) })} /></EidosField>
        <EidosField id="voice-sovits-weights" label={ui("SoVITS / LoRA 权重路径")}><input id="voice-sovits-weights" className={control} value={voice.sovitsWeights ?? ''} placeholder={speaker ? config.sovitsWeights || ui("沿用默认 SoVITS 权重") : local ? ui("留空使用初始 SoVITS 权重") : 'SoVITS_weights_v4/character_lora.pth'} maxLength={2000} onChange={e => update({ sovitsWeights: e.target.value, trainingJobId: '', modelName: '', ...(!speaker ? { model: '' } : {}) })} /></EidosField>
        <p className="text-xs opacity-65 leading-6">{ui("指定权重后会在生成前加载，可能增加等待时间；切换失败会停止生成。使用外部 API v2 时，请为 Eidos 单独运行服务。")}</p>
      </details>
    </section>}
    {config.provider !== 'compatible' && <section className="eidos-audio-block eidos-audio-reference" aria-label={ui("参考录音")}>
      <h3 className="text-sm font-medium">{ui("参考录音")}</h3>
      <p className="eidos-audio-caption">{speaker && !voice.referenceAudio && !voice.referencePath && !voice.voice ? ui("沿用默认录音，编辑后单独保存。") : resolved.referenceAudio ? ui("已配置参考录音，可直接试听。") : resolved.referencePath ? ui("使用指定路径的参考录音。") : ui("上传录音，或选择已训练音色。")}</p>
    {config.provider === "legacy" && <>
    <FileImportCard label={ui("导入音色参考文件")} inputLabel={ui("上传音色参考")} heading={ui("导入参考录音")} description={ui("拖入 WAV / MP3，或点击选择文件")} hint={ui("3–10 秒单人干净录音 · 最多 10 MB")}
      accept=".wav,.mp3,audio/wav,audio/mpeg" onFiles={async files => {
      const file = files[0];
      try { if (file.size > 10 * 1024 * 1024) throw new Error(ui("参考音频不能超过 10 MB"));
        const data = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(",")[1]); reader.onerror = () => reject(new Error(ui("文件读取失败"))); reader.readAsDataURL(file); });
        if (useGameStore.getState().voiceConfig !== config) throw new Error(ui("配置已更改，请重新上传参考音频"));
        update({ referenceAudio: data, referencePath: '', referenceText: '', referenceLanguage: 'auto' }); setError("");
      } catch (error) { setError(error instanceof Error ? error.message : ui("上传失败")); }
    }} />{(voice.referenceAudio || voice.referencePath) && <p className="text-xs"><button type="button" className="underline" onClick={() => update({ voice: '', referenceAudio: '', referencePath: '', referenceText: '', referenceLanguage: '' })}>{speaker ? ui("使用默认参考录音") : ui("移除参考")}</button></p>}</>}
    {config.provider === "gpt-sovits" && <>
      <EidosField id="voice-ref" label={ui("参考音频路径")} hint={ui("语音服务电脑上的单人干净录音，建议 3–10 秒；微调模型也需要参考音频。")}><input id="voice-ref" className={control} value={voice.referencePath ?? ""} placeholder={speaker ? config.referencePath || ui("留空使用默认参考音频") : '/voices/reference.wav'} onChange={e => update({ referencePath: e.target.value })} /></EidosField>
    </>}
    <EidosField id="voice-transcript" label={ui("参考音频中的原话")} hint={ui("与录音逐字对应；v2 系列可留空。")}><textarea id="voice-transcript" className={control} value={resolved.referenceText ?? ''} placeholder={ui("录音中的完整台词")} onChange={e => updateReference({ referenceText: e.target.value })} /></EidosField>
    <EidosField id="voice-lang" label={ui("参考音频语言")} hint={ui("与参考录音一致。")}><select id="voice-lang" className={control} value={referenceLanguage} onChange={event => updateReference({ referenceLanguage: event.target.value })}>
      <option value="auto">{ui("自动识别")}</option>
      {languages.map(language => <option key={language} value={language}>{ui(VOICE_LANGUAGES[language])}</option>)}
      {referenceLanguage !== 'auto' && !languages.includes(referenceLanguage as keyof typeof VOICE_LANGUAGES) && <option value={referenceLanguage} disabled>{ui(VOICE_LANGUAGES[referenceLanguage as keyof typeof VOICE_LANGUAGES]) ?? referenceLanguage} {ui("· 尚未通过检查")}</option>}
    </select></EidosField>
    {local && <details><summary className="cursor-pointer text-xs">{ui("已有音色档案（高级）")}</summary><EidosField id="voice-id" label={ui("已有音色档案名称")} hint={ui("按名称查找旧版录音；已上传参考录音时无需填写。")}><input id="voice-id" className={control} value={voice.voice ?? ''} onChange={e => update({ voice: e.target.value })} /></EidosField></details>}
    </section>}
    </div>
    {speaker && <EidosButton onClick={() => { const next = { ...config.speakers }; delete next[speaker]; patch({ speakers: next }); }}>{ui("恢复默认音色")}</EidosButton>}
    {error && <p role="alert" className="text-xs">{error}</p>}
  </fieldset>;
}
