"use client";

// ============================================================
// Eidos · 创造模式 — 创作设置页面
// ============================================================
// 创造模式的 AI 生成参数微调 + 模式切换。
// ============================================================

import { useState } from "react";
import { useGameStore } from "@/store/game-store";
import type { CreativeModeConfig } from "@/lib/game/types";
import { DEFAULT_CREATIVE_CONFIG } from "@/lib/game/types";
import { useI18n } from "@/components/shell/LocaleProvider";
import {
  EidosButton,
  EidosField,
  EidosScreen,
  EidosSection,
} from "@/components/ui/EidosScreen";

export function CreativeSettingsScreen() {
  const { t } = useI18n();
  const store = useGameStore();
  const creativeConfig = useGameStore((s) => s.creativeConfig);
  const setPhase = useGameStore((s) => s.setPhase);
  const {
    setCreativeConfig,
    enterCreativeMode,
    exitCreativeMode,
  } = store;

  const [localConfig, setLocalConfig] = useState<CreativeModeConfig>({
    ...creativeConfig,
  });
  const [saved, setSaved] = useState(false);

  const update = <K extends keyof CreativeModeConfig>(
    key: K,
    value: CreativeModeConfig[K]
  ) => {
    setLocalConfig((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = () => {
    setCreativeConfig(localConfig);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  const handleReset = () => {
    setLocalConfig({ ...DEFAULT_CREATIVE_CONFIG });
  };

  const isCreative = localConfig.gameMode === "creative";
  const isCurrentlyCreative = creativeConfig.gameMode === "creative";

  return (
    <EidosScreen
      eyebrow={t("creativeSettings.eyebrow")}
      title={t("creativeSettings.title")}
      subtitle={t("creativeSettings.subtitle")}
      maxWidth="lg"
      action={
        <EidosButton
          onClick={() => setPhase("playing")}
          className="px-4 py-2"
        >
          {t("creativeSettings.back")}
        </EidosButton>
      }
    >
        <EidosSection
          title={t("creativeSettings.gameMode")}
          subtitle={t("creativeSettings.gameModeHint")}
        >
          <div className="flex gap-3">
            <EidosButton
              onClick={() => {
                if (isCurrentlyCreative) {
                  exitCreativeMode();
                }
                update("gameMode", "narrative");
              }}
              active={!isCreative}
              className="flex-1 py-3 text-sm"
            >
              {t("settings.reasoningMode")}
            </EidosButton>
            <EidosButton
              onClick={() => update("gameMode", "creative")}
              active={isCreative}
              className="flex-1 py-3 text-sm"
            >
              {t("settings.creativeMode")}
            </EidosButton>
          </div>
          <p className="text-xs leading-5 text-zinc-600">
            {!isCreative
              ? t("settings.reasoningDescription")
              : t("settings.creativeDescription")}
          </p>

          {isCreative && !isCurrentlyCreative && (
            <div className="border-l border-[color:var(--eidos-accent)]/40 pl-4">
              <EidosButton
                onClick={() => {
                  setCreativeConfig(localConfig);
                  enterCreativeMode();
                }}
                className="w-full py-2.5 text-sm"
              >
                {t("creativeSettings.enterCreative")}
              </EidosButton>
              <p className="mt-2 text-[10px] leading-4 text-zinc-600">
                {t("creativeSettings.enterCreativeHint")}
              </p>
            </div>
          )}
          {isCreative && isCurrentlyCreative && (
            <div className="border-l border-red-700/40 pl-4">
              <EidosButton
                onClick={() => {
                  setCreativeConfig(localConfig);
                  exitCreativeMode();
                }}
                className="w-full border-red-800/40 text-sm text-red-300/80 hover:border-red-500/50 hover:bg-red-950/20"
              >
                {t("creativeSettings.exitCreative")}
              </EidosButton>
              <p className="mt-2 text-[10px] leading-4 text-zinc-600">
                {t("creativeSettings.exitCreativeHint")}
              </p>
            </div>
          )}
        </EidosSection>

        <EidosSection
          title={t("creativeSettings.aliceSection")}
          subtitle={t("creativeSettings.aliceSectionHint")}
        >
          <EidosField
            id="creative-alice-expectations"
            label={t("creativeSettings.aliceExpectations")}
            hint={t("creativeSettings.aliceExpectationsHint")}
          >
            <textarea
              id="creative-alice-expectations"
              value={localConfig.aliceExpectations}
              onChange={(e) => update("aliceExpectations", e.target.value)}
              placeholder={t("creativeSettings.aliceExpectationsPlaceholder")}
              rows={4}
              className="eidos-field w-full resize-none px-3 py-2 text-sm placeholder:text-zinc-600"
            />
          </EidosField>
          <EidosField
            label={t("creativeSettings.aliceTemperature", {
              value: localConfig.aliceTemperature.toFixed(2),
            })}
            hint={t("creativeSettings.aliceTemperatureHint")}
          >
            <input
              type="range"
              value={localConfig.aliceTemperature}
              onChange={(e) => update("aliceTemperature", parseFloat(e.target.value))}
              min={0}
              max={2}
              step={0.05}
              className="w-full accent-[color:var(--eidos-accent)]"
            />
            <div className="mt-0.5 flex justify-between text-[10px] text-zinc-600">
              <span>{t("creativeSettings.temperaturePrecise")}</span>
              <span>1</span>
              <span>{t("creativeSettings.temperatureCreative")}</span>
            </div>
          </EidosField>
        </EidosSection>

        <EidosSection
          title={t("creativeSettings.keiSection")}
          subtitle={t("creativeSettings.keiSectionHint")}
        >
          <EidosField
            id="creative-kei-expectations"
            label={t("creativeSettings.keiExpectations")}
            hint={t("creativeSettings.keiExpectationsHint")}
          >
            <textarea
              id="creative-kei-expectations"
              value={localConfig.keiExpectations}
              onChange={(e) => update("keiExpectations", e.target.value)}
              placeholder={t("creativeSettings.keiExpectationsPlaceholder")}
              rows={3}
              className="eidos-field w-full resize-none px-3 py-2 text-sm placeholder:text-zinc-600"
            />
          </EidosField>
          <EidosField
            label={t("creativeSettings.keiTemperature", {
              value: localConfig.keiTemperature.toFixed(2),
            })}
            hint={t("creativeSettings.keiTemperatureHint")}
          >
            <input
              type="range"
              value={localConfig.keiTemperature}
              onChange={(e) => update("keiTemperature", parseFloat(e.target.value))}
              min={0}
              max={2}
              step={0.05}
              className="w-full accent-[color:var(--eidos-accent)]"
            />
            <div className="mt-0.5 flex justify-between text-[10px] text-zinc-600">
              <span>{t("creativeSettings.temperatureStrict")}</span>
              <span>1</span>
              <span>{t("creativeSettings.temperatureLoose")}</span>
            </div>
          </EidosField>
        </EidosSection>

        <EidosSection
          title={t("creativeSettings.dataSection")}
          subtitle={t("creativeSettings.dataSectionHint")}
        >
          <EidosButton
            onClick={handleReset}
          >
            {t("settings.reset")}
          </EidosButton>
        </EidosSection>

        <div className="flex items-center gap-3 pb-8">
          <EidosButton
            onClick={handleSave}
            className="eidos-button-primary px-6 py-2.5 text-sm"
          >
            {t("settings.save")}
          </EidosButton>
          {saved && (
            <span className="text-xs text-emerald-400" role="status">
              {t("settings.saved")}
            </span>
          )}
        </div>
    </EidosScreen>
  );
}
