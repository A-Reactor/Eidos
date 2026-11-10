"use client";
import { BackButton } from "@/components/ui/BackButton";

import { PaletteSetting } from "./settings/PaletteSetting";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useGameStore } from "@/store/game-store";
import { EIDOS_SETTINGS_STORAGE_KEY, loadSettings, saveSettings, applyFontSize } from "@/lib/game/settings";
import { DEFAULT_SETTINGS, type GameSettings } from "@/lib/game/types";
import { AI_PROVIDER_PRESETS, AI_QUALITY_PROFILES, getProviderPreset } from "@/lib/ai/provider-presets";
import { useI18n } from "@/components/shell/LocaleProvider";
import { InteractionDialog } from "@/components/ui/InteractionDialog";
import { ArchiveScreen } from "@/components/ui/ArchiveScreen";
import { ResponsiveSidebar } from "@/components/ui/ResponsiveSidebar";
import { SettingsField as Field, SettingsToggle } from "./settings/SettingsField";
import { AI_ROLES, hasIndependentConnections, qualityProfilePatch, roleProviderPatch, sharedKeyPatch, sharedProviderPatch, type ConnectionRole } from "./settings/connection-model";
import { SettingsDataActions } from "./settings/SettingsDataActions";
import { DataAnalytics } from './settings/DataAnalytics';
import { AudioStorageSettings } from './settings/AudioStorageSettings';
import { ContextCompressionSetting } from './settings/ContextCompressionSetting';
import { KeyboardSettings } from './settings/KeyboardSettings';
import { AiConfigDocument } from './settings/AiConfigDocument';

import { parseGameplayPlugins } from '@/lib/game/plugins/manifest';
import { mergeModPreferenceDraft, settingValue } from '@/lib/game/plugins/preferences';
import { AuthorToolsPage } from './settings/AuthorToolsPage';
import { GlobalPluginManager } from './settings/GlobalPluginManager';
import { SettingsModPage } from './settings/SettingsModPage';

function Section({ title, children }: { title: string; children: ReactNode }) {
  return <section className="eidos-settings-page"><h2>{title}</h2><div className="eidos-settings-fields">{children}</div></section>;
}
const same = (a: unknown, b: unknown) => typeof a === 'object' ? JSON.stringify(a) === JSON.stringify(b) : a === b;
const keys = Object.keys(DEFAULT_SETTINGS) as (keyof GameSettings)[];
const control = "eidos-settings-control w-full p-2.5 text-sm";
const button = "eidos-focus eidos-archive-button disabled:opacity-40";

export function SettingsScreen() {
  const { t, locale } = useI18n();
  const text = (zh: string, en: string) => locale === "en" ? en : zh;
  const goBack = useGameStore((s) => s.goBack);
  const history = useGameStore((s) => s.history);
  const inArchive = useGameStore(s => Boolean(s.currentWorld) && (s.phase === 'playing' || s.navigationStack.includes('playing')));
  const definitions = useGameStore(s => s.currentWorld?.gameplayPlugins);
  // The library is an authoring catalogue; only the archive's pinned packages run in this game.
  const plugins = useMemo(() => inArchive ? parseGameplayPlugins(definitions) : [], [definitions, inArchive]);
  const [requestedPage, setPage] = useState('general');
  const [baseline, setBaseline] = useState(loadSettings);
  const [settings, setSettings] = useState(() => {
    const value = loadSettings();
    return hasIndependentConnections(value) ? { ...value, aiProviderMode: "advanced" as const } : value;
  });
  const [feedback, setFeedback] = useState<"saved" | "error" | null>(null);
  const [leave, setLeave] = useState<(() => void) | null>(null);
  const [convert, setConvert] = useState(false);
  const [testResults, setTestResults] = useState<Partial<Record<ConnectionRole, string>>>({});
  const [testing, setTesting] = useState(false);
  const testVersion = useRef(0);
  const testController = useRef<AbortController | null>(null);
  const dirty = keys.some((key) => !same(settings[key], baseline[key]));
  const snapshot = useRef({ baseline, settings });
  useEffect(() => { snapshot.current = { baseline, settings }; }, [baseline, settings]);

  useEffect(() => {
    const reconcile = (event: StorageEvent) => {
      if (event.key !== EIDOS_SETTINGS_STORAGE_KEY) return;
      const remote = loadSettings();
      const { baseline: old, settings: local } = snapshot.current;
      const merged = { ...remote };
      for (const key of keys) if (key !== "modPreferences" && !same(old[key], local[key])) Object.assign(merged, { [key]: local[key] });
      merged.modPreferences = mergeModPreferenceDraft(remote.modPreferences, old.modPreferences, local.modPreferences);
      setBaseline(remote); setSettings(merged);
    };
    window.addEventListener("storage", reconcile);
    return () => { window.removeEventListener("storage", reconcile); testController.current?.abort(); };
  }, []);
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => { if (dirty) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [dirty]);

  const patch = (values: Partial<GameSettings>) => {
    testVersion.current++; testController.current?.abort();
    setTesting(false); setTestResults({}); setFeedback(null);
    setSettings((s) => ({ ...s, ...values }));
  };
  const update = <K extends keyof GameSettings>(key: K, value: GameSettings[K]) => patch({ [key]: value });
  const save = () => {
    const candidate = loadSettings();
    for (const key of keys) if (key !== "modPreferences" && !same(settings[key], baseline[key])) Object.assign(candidate, { [key]: settings[key] });
    candidate.modPreferences = mergeModPreferenceDraft(candidate.modPreferences, baseline.modPreferences, settings.modPreferences);
    if (!saveSettings(candidate)) { setFeedback("error"); return false; }
    const canonical = loadSettings();
    setSettings(canonical); setBaseline(canonical); applyFontSize(canonical.fontSize); setFeedback("saved");
    return true;
  };
  const navigate = (action: () => void) => { if (dirty) setLeave(() => action); else action(); };
  const testConnection = async () => {
    const version = ++testVersion.current;
    const controller = new AbortController(); testController.current = controller;
    setTesting(true); setTestResults({});
    const timer = setTimeout(() => controller.abort(), 30000);
    const results: Partial<Record<ConnectionRole, string>> = {};
    await Promise.all(AI_ROLES.map(async (role) => {
      try {
        const response = await fetch("/api/ai/test-connection", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ role, settings }), signal: controller.signal });
        const body = await response.json();
        results[role] = response.ok && body.ok !== false ? "ok" : body.error || t("settings.aiTestUnknownError");
      } catch (error) { results[role] = error instanceof Error ? error.message : t("settings.aiTestUnknownError"); }
    }));
    clearTimeout(timer);
    if (version === testVersion.current) { setTestResults(results); setTesting(false); }
  };
  const providerSelect = (value: string, onChange: (id: string) => void, id: string) => <select id={id} className={control} value={value} onChange={(e) => onChange(e.target.value)}>{Object.values(AI_PROVIDER_PRESETS).map((p) => <option key={p.id} value={p.id}>{t(p.labelKey as never)}</option>)}</select>;
  const editField = (key: keyof GameSettings, label: string, id: string, password = false) => <Field id={id} label={label}><input id={id} type={password ? "password" : "text"} autoComplete="off" value={String(settings[key])} onChange={(e) => patch({ [key]: e.target.value })} className={control} /></Field>;
  const builtInSections = [["general", t("settings.display")], ["reading", text("阅读与自动操作", "Reading and automation")], ["connection", t("settings.aiAccess")], ["data", t("settings.data")], ["mods", inArchive ? text("模组", "Mods") : text("全局插件", "Global plugins")], ["author", text("作者工具", "Author tools")]];
  const modSections = plugins.map(p => [`mod:${p.id}`, p.name]);
  builtInSections.splice(2, 0, ['keyboard', text('快捷键', 'Keyboard shortcuts')]);
  const sections = [...builtInSections, ...modSections];
  const sectionGroups = [{ label: text('本体设置', 'Built-in settings'), items: builtInSections }, { label: text('模组设置', 'Mod settings'), items: modSections }].filter(group => group.items.length);
  const page = sections.some(([id]) => id === requestedPage) ? requestedPage : 'mods';
  const mode = settings.autoSelect && settings.autoAdvance ? "play" : settings.autoAdvance ? "read" : "manual";
  const failures = AI_ROLES.filter((role) => testResults[role] && testResults[role] !== "ok");

  return <ArchiveScreen directoryFirst className="eidos-settings-screen" title={t("settings.title")} subtitle={t("settings.subtitle")} onBack={() => navigate(goBack)}
    action={<BackButton onClick={() => navigate(goBack)} label={t("settings.back")} />}>
    <div className="eidos-settings-layout">
      <ResponsiveSidebar as="nav" label={text("设置分类", "Settings sections")} current={sections.find(([id]) => id === page)?.[1]} closeLabel={text('收起菜单', 'Close menu')} className="eidos-settings-nav">
        {sectionGroups.map(group => <div key={group.label} role="group" aria-label={group.label} className="eidos-settings-nav-group">
          <p className="eidos-settings-nav-label">{group.label}</p>
          {group.items.map(([id, label]) => <button key={id} type="button" aria-current={page === id ? 'page' : undefined} onClick={() => setPage(id)} className="eidos-focus eidos-settings-category">{label}</button>)}
        </div>)}
      </ResponsiveSidebar>
      <main key={page} className="eidos-settings-main" aria-label={`${sections.find(([id]) => id === page)?.[1]} ${text('设置页', 'settings page')}`}>
        <div className="eidos-settings-main-inner">
          {page === 'keyboard' && <KeyboardSettings value={settings.keyboardShortcuts} onChange={keyboardShortcuts => patch({ keyboardShortcuts })} english={locale === 'en'} />}
          {page === "general" && <div id="settings-general"><Section title={t("settings.display")}>
            <div className="eidos-settings-fields">
              <Field id="settings-interface-language" label={t("settings.interfaceLanguage")}><select id="settings-interface-language" value={settings.interfaceLanguage} onChange={(e) => update("interfaceLanguage", e.target.value as GameSettings["interfaceLanguage"])} className={control}><option value="zh-CN">简体中文</option><option value="en">English</option></select></Field>
              <Field id="settings-interface-theme" label={t("settings.interfaceTheme")}><select id="settings-interface-theme" value={settings.interfaceTheme} onChange={(e) => update("interfaceTheme", e.target.value as GameSettings["interfaceTheme"])} className={control}><option value="light">{t("settings.themeLight")}</option><option value="dark">{t("settings.themeDark")}</option></select></Field>
              <PaletteSetting settings={settings} onChange={patch} english={locale === "en"} />
              <Field id="settings-narrative-language" label={t("settings.narrativeLanguage")}><select id="settings-narrative-language" className={control} value={settings.narrativeLanguage} onChange={(e) => { if (history.length && !window.confirm(t("settings.narrativeLanguageChangeWarning"))) return; update("narrativeLanguage", e.target.value as GameSettings["narrativeLanguage"]); }}><option value="zh-CN">简体中文</option><option value="en">English</option></select></Field>
              <Field id="settings-font" label={t("settings.fontSize")}><select id="settings-font" className={control} value={settings.fontSize} onChange={(e) => update("fontSize", Number(e.target.value) as GameSettings["fontSize"])}>{[text("标准", "Standard"), text("大", "Large"), text("更大", "Larger"), text("特大", "Largest")].map((label, i) => <option key={i} value={i + 1}>{label}</option>)}</select></Field>
              <Field id="settings-scene-overlay" label={text("场景遮罩不透明度", "Scene overlay opacity")}><div className="eidos-settings-range"><input id="settings-scene-overlay" className="eidos-settings-slider" style={{ '--slider-progress': `${settings.sceneOverlayOpacity}%` } as CSSProperties} type="range" min={0} max={100} step={1} value={settings.sceneOverlayOpacity} onChange={e => update('sceneOverlayOpacity', Number(e.target.value))} /><output htmlFor="settings-scene-overlay">{settings.sceneOverlayOpacity}%</output></div></Field>
            </div>
            <SettingsToggle id="settings-hide-narration" label={text("旁白不通过对话框展示", "Keep narration out of the dialogue box")} checked={settings.hideNarrationInDialogue} onChange={checked => update('hideNarrationInDialogue', checked)} />
            <SettingsToggle id="settings-reduce-motion" label={t("settings.reduceMotion")} checked={settings.reduceMotion} onChange={checked => update("reduceMotion", checked)} />
          </Section></div>}
          {page === "reading" && <div id="settings-reading"><Section title={text("阅读与自动操作", "Reading and automation")}>
            <Field id="settings-reading-mode" label={text("阅读与自动操作", "Reading and automation")}><select id="settings-reading-mode" value={mode} className={control} onChange={(e) => patch({ autoAdvance: e.target.value !== "manual", autoSelect: e.target.value === "play" })}><option value="manual">{text("手动操作", "Manual")}</option><option value="read">{text("自动翻页", "Auto read")}</option><option value="play">{text("自动游玩 · 首个推荐行动", "Auto play · first suggestion")}</option></select></Field>
            {mode !== "manual" && <Field id="settings-delay" label={t("settings.advanceDelay")} hint={t("settings.milliseconds")}><input id="settings-delay" className={control} type="number" min={500} step={500} value={settings.autoAdvanceDelay} onChange={(e) => update("autoAdvanceDelay", Math.max(500, Number(e.target.value)))} /></Field>}
            {mode === "play" && <Field id="settings-limit" label={t("settings.autoStop")} hint={t("settings.autoStopHint")}><input id="settings-limit" type="number" min={0} max={999} className={control} value={settings.autoStopSteps} onChange={(e) => update("autoStopSteps", Math.max(0, Math.trunc(Number(e.target.value))))} /></Field>}
            <SettingsToggle id="settings-speculation" label={text("开启预生成", "Enable pregeneration")} checked={settings.enableSpeculation} onChange={checked => update("enableSpeculation", checked)} hint={text("减少等待，会增加模型用量。", "Reduces waiting; uses more model calls.")} />
            <SettingsToggle id="settings-content-review" label={text("开启内容审核", "Enable content review")} checked={settings.enableContentReview} onChange={checked => update("enableContentReview", checked)} hint={text("检查剧情连贯性与状态变化。", "Checks story continuity and state changes.")} />
            <div className="eidos-settings-prompt"><label htmlFor="settings-alice-user-prompt">{text('自定义提示词（ALICE）', 'Custom instructions (ALICE)')}</label><p>{text('用于正文、内省与预生成；留空使用默认值。', 'Applies to narrative, introspection and pregeneration. Leave blank for defaults.')}</p><textarea id="settings-alice-user-prompt" rows={5} className={control} value={settings.aliceUserPrompt} onChange={event => update('aliceUserPrompt', event.target.value)} placeholder={text('例如：对白简练，注重动作与环境。', 'For example: concise dialogue, detailed gestures and surroundings.')} /></div>
            <ContextCompressionSetting settings={settings} onChange={patch} />
            <Field id="settings-autosave" label={t("settings.autoSaveInterval")} hint={text("阅读结束或空闲时保存，退出时仍保存。", "Saves when reading ends or the app is idle, and on exit.")}><select id="settings-autosave" className={control} value={settings.autoSaveInterval} onChange={e => update('autoSaveInterval', Number(e.target.value))}>{[...new Set([0, 60, 180, 300, 600, settings.autoSaveInterval])].sort((a,b) => a-b).map(seconds => <option key={seconds} value={seconds}>{seconds === 0 ? text('关闭背景保存', 'Background saving off') : seconds < 60 ? `${seconds} ${text('秒', 'seconds')}` : `${seconds / 60} ${text('分钟', 'minutes')}`}</option>)}</select></Field>
          </Section></div>}
          {page === "connection" && <div id="settings-connection"><Section title={t("settings.aiAccess")}>
            <SettingsToggle id="settings-advanced-mode" label={t("settings.advancedAiSettings")} checked={settings.aiProviderMode === "advanced"} onChange={checked => checked ? update("aiProviderMode", "advanced") : setConvert(true)} />
            {settings.aiProviderMode === "simple" ? <>
              <Field id="settings-ai-provider" label={t("settings.provider")}>{providerSelect(settings.aiGlobalProviderId, (id) => patch({ ...sharedProviderPatch(id, settings.aiQualityProfile), ...sharedKeyPatch('') }), "settings-ai-provider")}</Field>
              <Field id="settings-ai-quality" label={t("settings.qualityProfile")}><select id="settings-ai-quality" className={control} value={settings.aiQualityProfile} onChange={(e) => patch(qualityProfilePatch(settings, e.target.value as GameSettings['aiQualityProfile']))}>{Object.values(AI_QUALITY_PROFILES).map((q) => <option key={q.id} value={q.id}>{t(q.labelKey as never)}</option>)}</select></Field>
              <Field id="settings-ai-shared-key" label={t("settings.apiKeyShared")} hint={t("settings.apiKeyHint")}><input id="settings-ai-shared-key" type="password" autoComplete="off" className={control} value={settings.aliceApiKey} onChange={(e) => patch(sharedKeyPatch(e.target.value))} /></Field>
              <Field id="settings-shared-endpoint" label={t("settings.apiEndpoint")}><input id="settings-shared-endpoint" className={control} value={settings.aliceEndpoint} onChange={(e) => patch({ aliceEndpoint: e.target.value, keiEndpoint: e.target.value, uzqEndpoint: e.target.value })} /></Field>
              {getProviderPreset(settings.aiGlobalProviderId).allowCustomBaseUrl && <Field id="settings-local-model" label={text('本地或自定义模型 ID', 'Local or custom model ID')} hint={text('填写已加载的模型 ID；本地服务可留空密钥。', 'Use the loaded model ID. Local servers can omit the key.')}><input id="settings-local-model" className={control} value={settings.aliceModel} onChange={e => patch({ aliceModel: e.target.value, keiModel: e.target.value, uzqModel: e.target.value })} /></Field>}
            </> : <div className="space-y-4 pt-2">{(["kei", "uzq", "alice"] as const).map((role) => <fieldset key={role} className="border-t border-current/15 pt-2"><legend className="px-2 text-base font-semibold">{t(`settings.${role}Section`)}</legend>
              <Field id={`settings-${role}-provider`} label={`${role.toUpperCase()} ${t("settings.provider")}`}>{providerSelect(settings[`${role}ProviderId`], (id) => patch({ ...roleProviderPatch(role, id, settings.aiQualityProfile), [`${role}ApiKey`]: '' }), `settings-${role}-provider`)}</Field>
              {editField(`${role}Endpoint`, `${role.toUpperCase()} ${t("settings.apiEndpoint")}`, `settings-${role}-endpoint`)}
              {editField(`${role}ApiKey`, `${role.toUpperCase()} ${t("settings.apiKey")}`, `settings-${role}-api-key`, true)}
              {editField(`${role}Model`, `${role.toUpperCase()} ${t("settings.modelName")}`, `settings-${role}-model`)}
              {getProviderPreset(settings[`${role}ProviderId`]).protocol !== 'openai-compatible' && <>
                <label className="flex min-h-10 items-center gap-3 text-sm"><input type="checkbox" checked={settings[`${role}EnableReasoning`]} onChange={(e) => patch({ [`${role}EnableReasoning`]: e.target.checked })} />{`${role.toUpperCase()} ${text('思考模式', 'Thinking mode')}`}</label>
                {settings[`${role}EnableReasoning`] && <Field id={`settings-${role}-reasoning-effort`} label={`${role.toUpperCase()} ${text('思考强度', 'Thinking effort')}`}><select id={`settings-${role}-reasoning-effort`} className={control} value={settings[`${role}ReasoningEffort`]} onChange={(e) => patch({ [`${role}ReasoningEffort`]: e.target.value })}><option value="low">{text('低', 'Low')}</option><option value="medium">{text('中', 'Medium')}</option><option value="high">{text('高', 'High')}</option><option value="max">{text('最高', 'Maximum')}</option></select></Field>}
              </>}
            </fieldset>)}</div>}
            <div className="eidos-settings-fields"><Field id="settings-temperature" label={t("settings.temperature")}><input id="settings-temperature" type="number" min={0} max={2} step={0.05} className={control} value={settings.temperature} onChange={(e) => update("temperature", Math.min(2, Math.max(0, Number(e.target.value))))} /></Field><Field id="settings-max-tokens" label={t("settings.maxTokens")}><input id="settings-max-tokens" type="number" min={500} max={32000} step={500} className={control} value={settings.maxTokens} onChange={(e) => update("maxTokens", Math.min(32000, Math.max(500, Number(e.target.value))))} /></Field></div>
            <div className="space-y-2">
              <label className="flex items-center gap-3 text-sm"><input type="checkbox" aria-describedby="settings-reasoning-reserve-hint" checked={settings.reserveReasoningBudget} onChange={(e) => update('reserveReasoningBudget', e.target.checked)} />{text('生成限额预留思考额度', 'Reserve generation budget for thinking')}</label>
              <p id="settings-reasoning-reserve-hint" className="text-xs leading-5 opacity-65">{text('额外预留思考 Token，可能增加用量与耗时。', 'Reserves extra reasoning tokens; may increase usage and latency.')}</p>
            </div>
            <details className="border-t border-current/15 pt-3"><summary className="cursor-pointer text-sm">{text('兼容接口选项', 'Compatible API options')}</summary><p className="my-3 text-xs opacity-65">{text('接口不支持时，可关闭相应选项。', 'Disable options your endpoint does not support.')}</p><div className="space-y-2"><SettingsToggle id="settings-compatible-json" label={text('发送 JSON 模式参数', 'Send JSON mode parameter')} checked={settings.aiCompatibleJsonMode} onChange={checked => update('aiCompatibleJsonMode', checked)} /><SettingsToggle id="settings-compatible-usage" label={text('请求流式用量统计', 'Request streaming usage')} checked={settings.aiCompatibleStreamUsage} onChange={checked => update('aiCompatibleStreamUsage', checked)} /></div></details>
            <AiConfigDocument settings={settings} onImport={patch} />
            {settings.aiProviderMode === "advanced" && <label className="flex items-center gap-3 text-sm"><input type="checkbox" checked={settings.enableUzqAliceBrief} onChange={(e) => update("enableUzqAliceBrief", e.target.checked)} />{t("settings.enableUzqAliceBrief")}</label>}
            <details className="border-t border-current/15 pt-3"><summary className="cursor-pointer text-sm">{text('上下文窗口覆盖（高级）', 'Context window override (advanced)')}</summary><p className="my-3 text-xs opacity-65">{text('0 自动识别；未知或自定义模型请填写实际 Token 上限。', '0 detects known models. Enter the actual token limit for other deployments.')}</p>{AI_ROLES.map(role => <Field key={role} id={`settings-${role}-context-window`} label={`${role.toUpperCase()} ${text('上下文窗口', 'context window')}`}><input id={`settings-${role}-context-window`} className={control} type="number" min={0} step={1024} value={settings[`${role}ContextWindowTokens`]} onChange={e => patch({ [`${role}ContextWindowTokens`]: Math.max(0, Math.trunc(Number(e.target.value))) })} /></Field>)}</details>
            <div className="border-t border-current/15 pt-4 text-sm"><p className="mb-2 font-medium">{text("模型预览", "Model preview")}</p>{AI_ROLES.map((role) => <p key={role} className="break-all py-1"><b>{role.toUpperCase()}</b> · {settings[`${role}Model`]} · {settings[`${role}ProviderId`]}</p>)}</div>
            <button className={button} disabled={testing} onClick={() => void testConnection()}>{testing ? t("settings.aiTestRunning") : t("settings.aiTestConnection")}</button>
            {Object.keys(testResults).length > 0 && <div role={failures.length ? "alert" : "status"} className="text-sm">{failures.length ? failures.map((role) => <p key={role}>{role.toUpperCase()}: {testResults[role]}</p>) : t("settings.aiTestSuccess")}</div>}
          </Section></div>}
          {page === "author" && <AuthorToolsPage />}
          {page === "data" && <div id="settings-data"><Section title={t("settings.data")}><DataAnalytics /><AudioStorageSettings /><SettingsDataActions /></Section></div>}
          {page === 'mods' && !inArchive && <GlobalPluginManager />}
          {page === 'mods' && inArchive && <Section title={text('模组', 'Mods')}><p className="text-sm opacity-65">{text('查看已加载模组，调整本机偏好。', 'Manage preferences for loaded mods.')}</p>{plugins.length ? plugins.map(plugin => <div key={plugin.id} className="eidos-settings-row"><div className="min-w-0"><b>{plugin.name}</b><p className="whitespace-pre-wrap break-words">{plugin.description}</p></div><button className={button} onClick={() => setPage(`mod:${plugin.id}`)}>{plugin.settings?.length ? text('设置', 'Settings') : text('查看说明', 'Details')}</button></div>) : <p>{text('当前档案没有加载模组。', 'No mods loaded in the current archive.')}</p>}</Section>}
          {plugins.filter(plugin => page === `mod:${plugin.id}`).map(plugin => <SettingsModPage key={plugin.id} plugin={plugin} preferences={settings.modPreferences} onChange={(id, value) => {
            const definition = plugin.settings?.find(s => s.id === id);
            if (definition) setSettings(current => ({ ...current, modPreferences: { ...current.modPreferences, [plugin.id]: { ...current.modPreferences[plugin.id], [id]: settingValue(definition, value) } } }));
            setFeedback(null);
          }} />)}
        </div>
      </main>
    </div>
    <footer className="eidos-settings-footer">
      <button disabled={!dirty} className={button} data-variant="primary" onClick={save}>{t("settings.save")}</button>
      <button disabled={!dirty} className={button} onClick={() => { const value = loadSettings(); patch(value); setBaseline(value); }}>{text("放弃更改", "Discard changes")}</button>
      <span className="text-sm opacity-65">{dirty ? text("有未保存的更改", "Unsaved changes") : text("所有设置已保存", "All settings saved")}</span>
      {feedback === "saved" && <span role="status" className="text-sm">{t("settings.saved")}</span>}
      {feedback === "error" && <span role="alert" className="text-sm text-red-600">{t("settings.saveFailed")}</span>}
    </footer>
    {leave && <InteractionDialog title={text("保存更改后再离开？", "Save changes before leaving?")} onClose={() => setLeave(null)}><p className="text-sm">{text("未保存的修改会在离开后丢失。", "Unsaved changes will be lost.")}</p><div className="flex flex-wrap gap-3"><button className={button} onClick={() => setLeave(null)}>{text("继续编辑", "Keep editing")}</button><button className={button} onClick={() => { leave(); setLeave(null); }}>{text("放弃并离开", "Discard and leave")}</button><button className={button} onClick={() => { if (save()) { leave(); setLeave(null); } }}>{text("保存并离开", "Save and leave")}</button></div>{feedback === "error" && <p className="text-red-600">{t("settings.saveFailed")}</p>}</InteractionDialog>}
    {convert && <InteractionDialog title={text("切换为统一接入？", "Switch to shared connection?")} onClose={() => setConvert(false)}><p className="text-sm leading-6">{text("采用 ALICE 的供应商、地址和密钥，按质量档位分配模型。保存后替换独立配置。", "Use ALICE’s connection and the selected quality profile. Replaces independent settings when saved.")}</p><div className="flex gap-3"><button className={button} onClick={() => setConvert(false)}>{t("common.cancel")}</button><button className={button} onClick={() => { patch({ ...sharedProviderPatch(settings.aliceProviderId, settings.aiQualityProfile), ...sharedKeyPatch(settings.aliceApiKey), aliceEndpoint: settings.aliceEndpoint, keiEndpoint: settings.aliceEndpoint, uzqEndpoint: settings.aliceEndpoint, aiProviderMode: "simple" }); setConvert(false); }}>{text("使用统一配置", "Use shared connection")}</button></div></InteractionDialog>}
  </ArchiveScreen>;
}
