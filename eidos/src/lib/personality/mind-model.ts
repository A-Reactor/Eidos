// ============================================================
// Eidos · 人格推演引擎 — 心智建模校准层
// ============================================================
// 将认知科学/人格心理学中的稳定框架转译为确定性建模变量。
// 这里不声称复刻人的心智，只为 ALICE/KEI/人格推演器提供可审计的指导。

import type {
  CognitiveStyle,
  EmotionalRegulation,
  PersonalityArchive,
  PersonalityState,
  SocialStrategy,
} from "./types";

export interface BigFiveProjection {
  openness: number;
  conscientiousness: number;
  extraversion: number;
  agreeableness: number;
  neuroticism: number;
}

export interface SelfDeterminationNeeds {
  autonomy: number;
  competence: number;
  relatedness: number;
}

export interface PredictiveModelProfile {
  predictionError: number;
  evidenceDemand: number;
  modelRevisionReadiness: number;
}

export interface AppraisalProfile {
  threat: number;
  controlNeed: number;
  curiosity: number;
  attachmentAlarm: number;
}

export interface SocialMindProfile {
  theoryOfMind: number;
  trustOrientation: number;
  disclosureTendency: number;
}

export interface NarrativeIdentityProfile {
  selfContinuity: number;
  meaningNeed: number;
  identityThreat: number;
}

export interface MetacognitionProfile {
  sourceMonitoring: number;
  revisionReadiness: number;
  boundaryQuestioning: number;
}

export interface MindModelProfile {
  traits: BigFiveProjection;
  needs: SelfDeterminationNeeds;
  predictive: PredictiveModelProfile;
  appraisal: AppraisalProfile;
  socialMind: SocialMindProfile;
  narrativeIdentity: NarrativeIdentityProfile;
  metacognition: MetacognitionProfile;
}

export interface FourthWallReadiness {
  score: number;
  drivers: string[];
  blockers: string[];
}

const COGNITIVE_STYLE_TRAITS: Record<CognitiveStyle, BigFiveProjection> = {
  analytical: {
    openness: 68,
    conscientiousness: 72,
    extraversion: 35,
    agreeableness: 48,
    neuroticism: 38,
  },
  intuitive: {
    openness: 56,
    conscientiousness: 38,
    extraversion: 50,
    agreeableness: 52,
    neuroticism: 45,
  },
  skeptical: {
    openness: 45,
    conscientiousness: 64,
    extraversion: 28,
    agreeableness: 30,
    neuroticism: 62,
  },
  compliant: {
    openness: 28,
    conscientiousness: 70,
    extraversion: 38,
    agreeableness: 62,
    neuroticism: 42,
  },
  fantasy_prone: {
    openness: 82,
    conscientiousness: 35,
    extraversion: 48,
    agreeableness: 58,
    neuroticism: 55,
  },
  empirical: {
    openness: 34,
    conscientiousness: 62,
    extraversion: 45,
    agreeableness: 50,
    neuroticism: 30,
  },
};

const DEFAULT_BOUNDARY_SENSITIVITY = 30;
const DEFAULT_METACOGNITION = 20;

/**
 * 将现有人格档案投影到 Big Five 风格的稳定特质。
 * 这不是诊断量表，只是给生成系统一个稳定的性格坐标系。
 */
export function deriveTraitsFromArchive(
  archive: PersonalityArchive,
): BigFiveProjection {
  const base =
    COGNITIVE_STYLE_TRAITS[archive.cognitiveStyle] ??
    COGNITIVE_STYLE_TRAITS.empirical;
  const boundarySensitivity = archiveBoundarySensitivity(archive);
  const openness = clamp(
    base.openness + Math.round((boundarySensitivity - 30) * 0.25),
  );
  const neuroticism = clamp(
    base.neuroticism + (archive.fearsAndTaboos.length >= 2 ? 8 : 0),
  );

  return {
    ...base,
    openness,
    neuroticism,
  };
}

/**
 * 自我决定理论的三类基本心理需求。
 */
export function deriveNeedsFromArchive(
  archive: PersonalityArchive,
): SelfDeterminationNeeds {
  const values = archive.valuePriorities.join(" ");
  const desires = archive.coreDesires.join(" ");

  return {
    autonomy: clamp(
      35 +
        priorityScore(values, ["自由", "自主", "选择", "freedom", "autonomy"]) +
        priorityScore(desires, ["逃离", "掌控", "证明自己"]),
    ),
    competence: clamp(
      35 +
        priorityScore(values, ["真实", "知识", "准确", "责任", "truth", "knowledge"]) +
        priorityScore(desires, ["理解", "证明", "发现", "确认"]),
    ),
    relatedness: clamp(
      35 +
        priorityScore(values, ["连接", "亲密", "关系", "生命", "connection"]) +
        priorityScore(desires, ["保护", "被爱", "找回", "找到"]),
    ),
  };
}

export function evaluateMindModel(state: PersonalityState): MindModelProfile {
  const metacognition = archiveMetacognition(state.archive);
  const boundarySensitivity = archiveBoundarySensitivity(state.archive);
  const traits = deriveTraitsFromArchive(state.archive);
  const needs = deriveNeedsFromArchive(state.archive);
  const unexplained = state.anomalousMemories.filter((a) => !a.explainedAway);
  const anomalyLoad = clamp(
    unexplained.reduce((sum, a) => sum + a.significance, 0) / 2,
  );
  const contradictionLoad = clamp(state.beliefs.contradictions.length * 18);

  const predictionError = clamp(
    Math.max(anomalyLoad, state.pressure.worldDoubt) +
      contradictionLoad * 0.4,
  );
  const evidenceDemand = clamp(
    state.archive.cognitiveStyle === "skeptical"
      ? 78
      : state.archive.cognitiveStyle === "analytical"
        ? 68
        : state.archive.cognitiveStyle === "empirical"
          ? 64
          : 42,
  );
  const modelRevisionReadiness = clamp(
    predictionError * 0.45 +
      metacognition * 0.35 +
      traits.openness * 0.2,
  );

  const threat = clamp(
    state.pressure.selfContinuityFear * 0.35 +
      state.pressure.cognitiveDissonance * 0.35 +
      traits.neuroticism * 0.3,
  );
  const controlNeed = clamp(
    needs.autonomy * 0.35 +
      state.pressure.worldDoubt * 0.35 +
      state.pressure.unfinishedGoals * 0.3,
  );
  const curiosity = clamp(
    traits.openness * 0.35 +
      needs.competence * 0.3 +
      predictionError * 0.35,
  );
  const attachmentAlarm = clamp(
    needs.relatedness * 0.35 +
      Math.max(0, -state.pressure.trustInPlayer) * 0.45 +
      regulationAttachmentBias(state.archive.emotionalRegulation),
  );

  const theoryOfMind = clamp(
    metacognition * 0.45 +
      traits.agreeableness * 0.25 +
      socialStrategyMentalizingBias(state.archive.socialStrategy),
  );
  const trustOrientation = clamp(
    50 + state.pressure.trustInPlayer * 0.4 + (traits.agreeableness - 50) * 0.5,
  );
  const disclosureTendency = clamp(
    socialStrategyDisclosureBias(state.archive.socialStrategy) +
      trustOrientation * 0.35 -
      threat * 0.2,
  );

  const identityThreat = clamp(
    state.pressure.selfContinuityFear * 0.45 +
      state.pressure.cognitiveDissonance * 0.25 +
      hasMeaningFear(state.archive) * 25,
  );
  const selfContinuity = clamp(100 - identityThreat * 0.75);
  const meaningNeed = clamp(
    deriveMeaningNeed(state.archive) + state.pressure.unfinishedGoals * 0.25,
  );

  const sourceMonitoring = clamp(
    metacognition * 0.65 + traits.conscientiousness * 0.2,
  );
  const revisionReadiness = clamp(
    modelRevisionReadiness * 0.7 +
      (state.awareness >= 1 ? 15 : 0) -
      (state.archive.cognitiveStyle === "compliant" ? 10 : 0),
  );
  const boundaryQuestioning = clamp(
    boundarySensitivity * 0.45 +
      predictionError * 0.35 +
      metacognition * 0.2,
  );

  return {
    traits,
    needs,
    predictive: {
      predictionError,
      evidenceDemand,
      modelRevisionReadiness,
    },
    appraisal: {
      threat,
      controlNeed,
      curiosity,
      attachmentAlarm,
    },
    socialMind: {
      theoryOfMind,
      trustOrientation,
      disclosureTendency,
    },
    narrativeIdentity: {
      selfContinuity,
      meaningNeed,
      identityThreat,
    },
    metacognition: {
      sourceMonitoring,
      revisionReadiness,
      boundaryQuestioning,
    },
  };
}

export function scoreFourthWallReadiness(
  state: PersonalityState,
): FourthWallReadiness {
  const profile = evaluateMindModel(state);
  const metacognition = archiveMetacognition(state.archive);
  const boundarySensitivity = archiveBoundarySensitivity(state.archive);
  const unexplained = state.anomalousMemories.filter((a) => !a.explainedAway);
  const score = clamp(
    profile.predictive.predictionError * 0.25 +
      profile.metacognition.revisionReadiness * 0.25 +
      profile.metacognition.boundaryQuestioning * 0.2 +
      boundarySensitivity * 0.15 +
      state.awareness * 5,
  );

  const drivers: string[] = [];
  const blockers: string[] = [];

  if (unexplained.length > 0) {
    drivers.push(`${unexplained.length} 条未解释异常正在累积`);
  }
  if (profile.predictive.predictionError >= 60) {
    drivers.push("世界模型预测误差很高");
  }
  if (profile.metacognition.revisionReadiness >= 60) {
    drivers.push("角色愿意反思记忆和认知来源");
  }
  if (profile.narrativeIdentity.identityThreat >= 55) {
    drivers.push("自我叙事受到威胁");
  }

  if (metacognition < 30) {
    blockers.push("元认知不足，难以质疑自己的认知来源");
  }
  if (boundarySensitivity < 25) {
    blockers.push("边界敏感度低，倾向用日常解释消化异常");
  }
  if (unexplained.length === 0) {
    blockers.push("缺少未解释异常证据");
  }
  if (profile.predictive.predictionError < 35) {
    blockers.push("世界模型仍能解释当前经验");
  }

  return {
    score,
    drivers,
    blockers,
  };
}

export function formatMindModelGuidance(profile: MindModelProfile): string {
  const lines = [
    `心智建模：心理需求 自主${profile.needs.autonomy}/胜任${profile.needs.competence}/关系${profile.needs.relatedness}`,
    `预测误差：${profile.predictive.predictionError}；模型修正意愿：${profile.predictive.modelRevisionReadiness}`,
    `情绪评估：威胁${profile.appraisal.threat}；好奇${profile.appraisal.curiosity}；控制需求${profile.appraisal.controlNeed}`,
    `社会心智：读心${profile.socialMind.theoryOfMind}；信任取向${profile.socialMind.trustOrientation}`,
    `自我叙事：连续性${profile.narrativeIdentity.selfContinuity}；身份威胁${profile.narrativeIdentity.identityThreat}`,
  ];

  return lines.join("\n");
}

function priorityScore(text: string, needles: string[]): number {
  let score = 0;
  for (const needle of needles) {
    if (text.includes(needle)) score += 28;
  }
  return Math.min(56, score);
}

function archiveBoundarySensitivity(archive: PersonalityArchive): number {
  return finiteOrDefault(
    archive.boundarySensitivity,
    DEFAULT_BOUNDARY_SENSITIVITY,
  );
}

function archiveMetacognition(archive: PersonalityArchive): number {
  return finiteOrDefault(archive.metacognition, DEFAULT_METACOGNITION);
}

function finiteOrDefault(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function regulationAttachmentBias(regulation: EmotionalRegulation): number {
  if (regulation === "attachment") return 26;
  if (regulation === "self_sacrifice") return 16;
  if (regulation === "suppression") return 8;
  return 0;
}

function socialStrategyMentalizingBias(strategy: SocialStrategy): number {
  if (strategy === "verification") return 30;
  if (strategy === "negotiation") return 22;
  if (strategy === "caretaking") return 18;
  if (strategy === "coercion") return 8;
  return 12;
}

function socialStrategyDisclosureBias(strategy: SocialStrategy): number {
  if (strategy === "verification") return 58;
  if (strategy === "negotiation") return 48;
  if (strategy === "caretaking") return 44;
  if (strategy === "concealment") return 18;
  if (strategy === "isolation") return 16;
  if (strategy === "coercion") return 24;
  return 35;
}

function deriveMeaningNeed(archive: PersonalityArchive): number {
  const text = `${archive.coreDesires.join(" ")} ${archive.valuePriorities.join(" ")} ${archive.fearsAndTaboos.join(" ")}`;
  return clamp(
    35 +
      priorityScore(text, ["意义", "真实", "真理", "希望", "信仰", "identity", "meaning"]),
  );
}

function hasMeaningFear(archive: PersonalityArchive): number {
  const text = archive.fearsAndTaboos.join(" ");
  return /空壳|失去意义|被遗忘|不真实|毫无意义/.test(text) ? 1 : 0;
}

function clamp(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}
