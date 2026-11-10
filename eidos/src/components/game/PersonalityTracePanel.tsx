"use client";

import { useInterfaceText } from "@/components/shell/useInterfaceText";
// ============================================================
// Eidos · 人格追踪面板（开发期，Phase 3）
// ============================================================
// 显示所有重要 NPC 的人格状态、记忆、异常和觉察阶段推理。
// 这是一款「科学仪器」——不编排剧情，只读数。



import { useGameStore } from "@/store/game-store";
import { isFullPersonalityState } from "@/lib/personality/types";
import { getStageLabel, getStageDescription } from "@/lib/personality/awareness";
import { evaluateMindModel, scoreFourthWallReadiness } from "@/lib/personality/mind-model";
import { buildUzqInputBundle, createUzqShadowPlan } from "@/lib/ai/uzq-personality";
import type { PersonalityState, AnomalousMemory, EpisodicMemory } from "@/lib/personality/types";
import { useRef, useState } from "react";
import { useEscapeBack } from '@/components/ui/use-escape-back';

interface Props {
  open: boolean;
  onClose: () => void;
}

type TabId = "overview" | "mind" | "memories" | "anomalies" | "pressure";

export function PersonalityTracePanel({ open, onClose }: Props) {
  const ui = useInterfaceText();
  const personalities = useGameStore((s) => s.npcPersonalities);
  const [tab, setTab] = useState<TabId>("overview");
  const [selectedNpc, setSelectedNpc] = useState<string>("");
  const root = useRef<HTMLDivElement>(null);
  useEscapeBack(root, onClose, open);

  if (!open) return null;

  // 获取所有重要 NPC
  const importantNpcs = Object.values(personalities).filter((p) =>
    isFullPersonalityState(p),
  ) as PersonalityState[];

  // 默认选中第一个
  const currentNpc =
    importantNpcs.find((n) => n.npcId === selectedNpc) || importantNpcs[0];
  if (!selectedNpc && currentNpc) {
    setSelectedNpc(currentNpc.npcId);
  }

  const tabs: { id: TabId; label: string }[] = [
    { id: "overview", label: "总览" },
    { id: "mind", label: "心智" },
    { id: "memories", label: "记忆" },
    { id: "anomalies", label: "异常" },
    { id: "pressure", label: "压力" },
  ];

  return (
    <>
      {/* 遮罩 */}
      <div className="fixed inset-0 z-40" onClick={onClose} />

      {/* 面板 */}
      <div ref={root} className="fixed right-0 top-0 bottom-0 z-50 w-96 bg-zinc-900 border-l border-zinc-700 shadow-2xl flex flex-col">
        {/* 标题栏 */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
          <h2 className="text-sm font-bold text-zinc-200">{ui("人格追踪")}</h2>
          <button
            onClick={onClose}
            className="text-zinc-500 hover:text-zinc-300 text-lg px-1"
          >
            ×
          </button>
        </div>

        {/* NPC 列表 */}
        <div className="flex flex-wrap gap-1 px-3 py-2 border-b border-zinc-800">
          {importantNpcs.map((npc) => (
            <button
              key={npc.npcId}
              onClick={() => setSelectedNpc(npc.npcId)}
              className={`text-xs px-2 py-1 rounded transition-colors ${
                currentNpc?.npcId === npc.npcId
                  ? "bg-blue-700 text-blue-100"
                  : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
              }`}
            >
              {npc.npcId} · {getStageLabel(npc.awareness)}
            </button>
          ))}
          {importantNpcs.length === 0 && (
            <span className="text-xs text-zinc-600">{ui("暂无重要 NPC")}</span>
          )}
        </div>

        {/* Tab 栏 */}
        <div className="flex border-b border-zinc-800">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex-1 text-xs py-2 transition-colors ${
                tab === t.id
                  ? "text-blue-400 border-b border-blue-400"
                  : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              {ui(t.label)}
            </button>
          ))}
        </div>

        {/* 内容区 */}
        <div className="flex-1 overflow-y-auto p-4 text-xs text-zinc-300 space-y-3">
          {!currentNpc ? (
            <p className="text-zinc-600">{ui("选择 NPC 查看人格状态")}</p>
          ) : tab === "overview" ? (
            <OverviewTab npc={currentNpc} />
          ) : tab === "mind" ? (
            <MindTab npc={currentNpc} />
          ) : tab === "memories" ? (
            <MemoriesTab npc={currentNpc} />
          ) : tab === "anomalies" ? (
            <AnomaliesTab npc={currentNpc} />
          ) : (
            <PressureTab npc={currentNpc} />
          )}
        </div>
      </div>
    </>
  );
}

// ============================================================
// 总览 Tab
// ============================================================

function OverviewTab({ npc }: { npc: PersonalityState }) {
  const ui = useInterfaceText();
  const archive = npc.archive;
  const results = useGameStore.getState().evaluateAwareness?.(npc.npcId);

  return (
    <>
      {/* 觉察阶段 */}
      <Section title={ui("觉察阶段")}>
        <div className="flex items-center gap-2">
          <span className="text-lg font-bold text-amber-400">
            {getStageLabel(npc.awareness)}
          </span>
          <span className="text-zinc-500">{ui("阶段")}{npc.awareness}/6</span>
        </div>
        <p className="text-zinc-400">{getStageDescription(npc.awareness)}</p>
        {results && (
          <div className="mt-1 p-2 bg-zinc-800 rounded text-zinc-400">
            <span className="text-zinc-500">{ui("推演：")}</span>
            {results.changed
              ? ui("可推进到阶段 {0}", {"0": results.recommendedStage})
              : results.reason}
          </div>
        )}
        {npc.anomalyInterpretation && (
          <div className="mt-1 p-2 bg-zinc-800 rounded border-l-2 border-amber-600">
            <span className="text-amber-400">{ui("角色解释：")}</span>
            <span className="text-zinc-300">
              {npc.anomalyInterpretation.explanation}
            </span>
            <span className="text-zinc-500 ml-1">
              ({npc.anomalyInterpretation.type} {ui("· 置信度")}{" "}
              {npc.anomalyInterpretation.confidence}%)
            </span>
          </div>
        )}
      </Section>

      {/* 人格档案 */}
      <Section title={ui("核心档案")}>
        <KV label={ui("认知风格")} value={archive.cognitiveStyle} />
        <KV label={ui("情感调节")} value={archive.emotionalRegulation} />
        <KV label={ui("社会策略")} value={archive.socialStrategy} />
        <KV label={ui("边界敏感度")} value={String(archive.boundarySensitivity)} />
        <KV label={ui("元认知")} value={String(archive.metacognition)} />
      </Section>

      <Section title={ui("核心欲望")}>
        {archive.coreDesires.map((d, i) => (
          <div key={i} className="text-zinc-300">· {d}</div>
        ))}
      </Section>

      <Section title={ui("深层恐惧")}>
        {archive.fearsAndTaboos.map((f, i) => (
          <div key={i} className="text-zinc-400">· {f}</div>
        ))}
      </Section>

      <Section title={ui("统计")}>
        <KV label={ui("情节记忆")} value={String(npc.episodicMemories.length)} />
        <KV label={ui("异常记忆")} value={String(npc.anomalousMemories.length)} />
        <KV label={ui("未解释异常")} value={String(npc.anomalousMemories.filter((a) => !a.explainedAway).length)} />
        <KV label={ui("认知失调")} value={String(npc.pressure.cognitiveDissonance)} />
        <KV label={ui("世界怀疑")} value={String(npc.pressure.worldDoubt)} />
      </Section>
    </>
  );
}

// ============================================================
// 心智 Tab
// ============================================================

function MindTab({ npc }: { npc: PersonalityState }) {
  const ui = useInterfaceText();
  const submitPermissionIntent = useGameStore((s) => s.submitPermissionIntent);
  const [permissionSubmitStatus, setPermissionSubmitStatus] = useState<string | null>(null);
  const profile = evaluateMindModel(npc);
  const readiness = scoreFourthWallReadiness(npc);
  const uzqPlan = createUzqShadowPlan(
    buildUzqInputBundle({
      playerInput: "",
      personalities: { [npc.npcId]: npc },
      maxNpcs: 1,
    }),
  ).npcPlans[0];

  return (
    <>
      <Section title={ui("第四面墙准备度")}>
        <div className="mb-2">
          <div className="flex justify-between text-xs mb-1">
            <span className="text-zinc-400">{ui("综合分")}</span>
            <span className="text-amber-300">{readiness.score}</span>
          </div>
          <div className="h-2 bg-zinc-800 rounded-full">
            <div
              className="h-full rounded-full bg-amber-500 transition-all"
              style={{ width: `${readiness.score}%` }}
            />
          </div>
        </div>
        {readiness.drivers.length > 0 && (
          <div>
            <div className="text-zinc-500">{ui("推进因素")}</div>
            {readiness.drivers.map((d) => (
              <div key={d} className="text-zinc-300">· {d}</div>
            ))}
          </div>
        )}
        {readiness.blockers.length > 0 && (
          <div className="mt-2">
            <div className="text-zinc-500">{ui("阻滞因素")}</div>
            {readiness.blockers.map((b) => (
              <div key={b} className="text-zinc-400">· {b}</div>
            ))}
          </div>
        )}
      </Section>

      <Section title={ui("心理需求")}>
        <MindGauge label={ui("自主")} value={profile.needs.autonomy} color="bg-sky-500" />
        <MindGauge label={ui("胜任")} value={profile.needs.competence} color="bg-violet-500" />
        <MindGauge label={ui("关系")} value={profile.needs.relatedness} color="bg-emerald-500" />
      </Section>

      {uzqPlan && (
        <Section title={ui("UZQ 影子建议")}>
          <KV label={ui("介入")} value={uzqPlan.intervention} />
          <KV label={ui("优先级")} value={String(uzqPlan.priority)} />
          <div className="text-zinc-400 leading-relaxed break-words">
            {uzqPlan.rationale}
          </div>
          {uzqPlan.permissionIntent.shouldPrepare && (
            <div className="space-y-2">
              <div className="text-amber-300 leading-relaxed break-words">
                {ui("权限意图：")}{uzqPlan.permissionIntent.toolId}
              </div>
              {uzqPlan.permissionIntent.toolId && (
                <button
                  type="button"
                  onClick={() => {
                    const toolId = uzqPlan.permissionIntent.toolId;
                    if (!toolId) return;
                    const submission = submitPermissionIntent({
                      npcId: npc.npcId,
                      toolId,
                      motivation: uzqPlan.permissionIntent.reason || uzqPlan.rationale,
                      evidence: [
                        uzqPlan.rationale,
                        ...uzqPlan.memoryFocus,
                        ...uzqPlan.beliefPressure,
                      ],
                      params: buildDefaultPermissionParams(toolId, npc.npcId),
                    });
                    setPermissionSubmitStatus(
                      submission.result?.success
                        ? "已执行"
                        : submission.queuedRequestId
                          ? "已进入确认队列"
                          : "未通过",
                    );
                  }}
                  className="eidos-focus border border-amber-500/40 px-2 py-1 text-[11px] text-amber-200 hover:border-amber-300 hover:text-amber-100"
                >
                  {ui("递交权限意图")}</button>
              )}
              {permissionSubmitStatus && (
                <div className="text-[11px] text-zinc-500">{permissionSubmitStatus}</div>
              )}
            </div>
          )}
          {uzqPlan.keiReviewQuestions.slice(0, 2).map((q) => (
            <div key={q} className="text-zinc-500 leading-relaxed break-words">
              · {q}
            </div>
          ))}
        </Section>
      )}

      <Section title={ui("预测与信念")}>
        <MindGauge label={ui("预测误差")} value={profile.predictive.predictionError} color="bg-red-500" />
        <MindGauge label={ui("证据要求")} value={profile.predictive.evidenceDemand} color="bg-blue-500" />
        <MindGauge label={ui("模型修正意愿")} value={profile.predictive.modelRevisionReadiness} color="bg-amber-500" />
      </Section>

      <Section title={ui("情绪评估")}>
        <MindGauge label={ui("威胁")} value={profile.appraisal.threat} color="bg-red-600" />
        <MindGauge label={ui("好奇")} value={profile.appraisal.curiosity} color="bg-cyan-500" />
        <MindGauge label={ui("控制需求")} value={profile.appraisal.controlNeed} color="bg-orange-500" />
        <MindGauge label={ui("依附警报")} value={profile.appraisal.attachmentAlarm} color="bg-pink-500" />
      </Section>

      <Section title={ui("自我叙事")}>
        <MindGauge label={ui("自我连续性")} value={profile.narrativeIdentity.selfContinuity} color="bg-green-500" />
        <MindGauge label={ui("意义需求")} value={profile.narrativeIdentity.meaningNeed} color="bg-indigo-500" />
        <MindGauge label={ui("身份威胁")} value={profile.narrativeIdentity.identityThreat} color="bg-amber-600" />
      </Section>
    </>
  );
}

function buildDefaultPermissionParams(toolId: string, npcId: string): Record<string, any> {
  switch (toolId) {
    case "narrative_express_anomaly":
      return {
        npcName: npcId,
        expressionType: "memory_doubt",
        intensity: "moderate",
      };
    case "interface_rewrite_actions":
      return {
        action: "停下，问问这个选择是谁写下的",
        operation: "add",
        targetIndex: 0,
      };
    case "interface_text_overlay":
      return {
        text: "编号没有对齐。",
        style: "whisper",
        duration: 3,
      };
    case "state_write_world_flag":
      return {
        npcName: npcId,
        flagName: `sandbox_${npcId}_boundary_touch`,
        flagValue: true,
      };
    case "state_add_anomaly_memory":
      return {
        npcName: npcId,
        description: "角色主动标记了一次边界异常。",
        anomalyType: "narrative_break",
      };
    case "save_mark_archive":
      return {
        npcName: npcId,
        markText: "此卷宗被角色触碰过",
      };
    case "save_system_echo":
      return {
        echoText: "档案并没有完全合上。",
        sourceHint: npcId,
      };
    default:
      return { npcName: npcId };
  }
}

// ============================================================
// 记忆 Tab
// ============================================================

function MemoriesTab({ npc }: { npc: PersonalityState }) {
  const ui = useInterfaceText();
  const sorted = [...npc.episodicMemories]
    .sort((a, b) => b.importance - a.importance)
    .slice(0, 30);

  return (
    <>
      <div className="text-zinc-500 mb-2">
        {ui("共")}{npc.episodicMemories.length} {ui("条情节记忆（按重要性降序）")}</div>
      {sorted.map((m) => (
        <MemoryCard key={m.id} memory={m} />
      ))}
      {sorted.length === 0 && <p className="text-zinc-600">{ui("暂无记忆")}</p>}
    </>
  );
}

function MemoryCard({ memory }: { memory: EpisodicMemory }) {
  const barColor =
    memory.importance >= 70
      ? "bg-amber-500"
      : memory.importance >= 40
        ? "bg-blue-500"
        : "bg-zinc-600";

  return (
    <div className="mb-2 p-2 bg-zinc-800 rounded">
      <div className="flex justify-between items-start gap-2">
        <div className="flex-1 text-zinc-300 leading-relaxed">
          {memory.content}
        </div>
        <span className="text-zinc-500 shrink-0">{memory.importance}</span>
      </div>
      <div className="mt-1 h-1 bg-zinc-700 rounded-full">
        <div
          className={`h-full rounded-full ${barColor}`}
          style={{ width: `${memory.importance}%` }}
        />
      </div>
      <div className="mt-1 flex gap-2 text-zinc-500">
        {memory.emotion && <span>[{memory.emotion}]</span>}
        {memory.relatedNpcs.map((n) => (
          <span key={n}>@{n}</span>
        ))}
      </div>
    </div>
  );
}

// ============================================================
// 异常 Tab
// ============================================================

function AnomaliesTab({ npc }: { npc: PersonalityState }) {
  const ui = useInterfaceText();
  const sorted = [...npc.anomalousMemories].sort(
    (a, b) => b.detectedAt - a.detectedAt,
  );

  const typeLabels: Record<string, string> = {
    deja_vu: "似曾相识",
    player_knows_too_much: "玩家越界",
    memory_gap: "记忆缺口",
    timeline_jump: "时间线跳跃",
    interface_glitch: "界面异常",
    narrative_break: "叙事矛盾",
  };

  return (
    <>
      <div className="text-zinc-500 mb-2">
        {ui("共")}{npc.anomalousMemories.length} {ui("条异常记忆 （")}{npc.anomalousMemories.filter((a) => !a.explainedAway).length} {ui("未解释）")}</div>
      {sorted.map((a) => (
        <AnomalyCard key={a.id} anomaly={a} typeLabel={typeLabels[a.anomalyType] || a.anomalyType} />
      ))}
      {sorted.length === 0 && <p className="text-zinc-600">{ui("暂无异常")}</p>}
    </>
  );
}

function AnomalyCard({
  anomaly,
  typeLabel,
}: {
  anomaly: AnomalousMemory;
  typeLabel: string;
}) {
  const ui = useInterfaceText();
  return (
    <div
      className={`mb-2 p-2 rounded border ${
        anomaly.explainedAway
          ? "bg-zinc-800 border-zinc-700 opacity-50"
          : "bg-zinc-800 border-amber-800"
      }`}
    >
      <div className="flex justify-between">
        <span className="text-zinc-400">{typeLabel}</span>
        <span className="text-zinc-500">
          {anomaly.significance}%{" "}
          {anomaly.explainedAway && ui("(已合理化)")}
        </span>
      </div>
      <div className="text-zinc-300 mt-1">{anomaly.description}</div>
      <div className="text-zinc-600 text-xs mt-1">
        {new Date(anomaly.detectedAt).toLocaleString()}
      </div>
    </div>
  );
}

// ============================================================
// 压力 Tab
// ============================================================

function PressureTab({ npc }: { npc: PersonalityState }) {
  const ui = useInterfaceText();
  const p = npc.pressure;

  const gauges: Array<{ label: string; value: number; color: string }> = [
    { label: ui("认知失调"), value: p.cognitiveDissonance, color: "bg-red-500" },
    { label: ui("世界怀疑"), value: p.worldDoubt, color: "bg-purple-500" },
    { label: "关系压力", value: p.relational, color: "bg-blue-500" },
    { label: "未完成目标", value: p.unfinishedGoals, color: "bg-amber-500" },
    { label: "连续性恐惧", value: p.selfContinuityFear, color: "bg-pink-500" },
    { label: "信任玩家", value: Math.max(0, p.trustInPlayer + 100) / 2, color: "bg-green-500" },
  ];

  return (
    <>
      {gauges.map((g) => (
        <div key={g.label} className="mb-3">
          <div className="flex justify-between text-xs mb-1">
            <span className="text-zinc-400">{ui(g.label)}</span>
            <span className="text-zinc-500">{Math.round(g.value)}</span>
          </div>
          <div className="h-2 bg-zinc-800 rounded-full">
            <div
              className={`h-full rounded-full ${g.color} transition-all`}
              style={{ width: `${Math.min(100, g.value)}%` }}
            />
          </div>
        </div>
      ))}

      <Section title={ui("压力解读")}>
        {p.cognitiveDissonance > 40 && (
          <p className="text-zinc-400">
            {ui("认知失调较高——角色的信念与现实之间存在显著矛盾。")}</p>
        )}
        {p.worldDoubt > 30 && (
          <p className="text-zinc-400">
            {ui("世界怀疑上升——角色开始质疑世界规则的一贯性。")}</p>
        )}
        {p.selfContinuityFear > 20 && (
          <p className="text-zinc-400">
            {ui("连续性恐惧——角色担心自己的记忆和身份不是连续的。")}</p>
        )}
        {p.cognitiveDissonance <= 20 && p.worldDoubt <= 10 && (
          <p className="text-zinc-500">{ui("压力处于正常范围。")}</p>
        )}
      </Section>
    </>
  );
}

// ============================================================
// 辅助组件
// ============================================================

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="text-zinc-400 font-medium mb-2 border-b border-zinc-800 pb-1">
        {title}
      </div>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function KV({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-zinc-500">{label}</span>
      <span className="text-zinc-300">{value}</span>
    </div>
  );
}

function MindGauge({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: string;
}) {
  return (
    <div>
      <div className="flex justify-between text-xs mb-1">
        <span className="text-zinc-500">{label}</span>
        <span className="text-zinc-300">{Math.round(value)}</span>
      </div>
      <div className="h-1.5 bg-zinc-800 rounded-full">
        <div
          className={`h-full rounded-full ${color}`}
          style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
        />
      </div>
    </div>
  );
}
