// ============================================================
// Eidos · KEI 审核质量追踪 Slice
// ============================================================
// 追踪 KEI 审核的纠正率——ALICE 原始输出 vs KEI 修正后。
// 数据在游戏过程中持续累积，TokenDisplay 质量 tab 展示。
// ============================================================

/** KEI 审核质量指标 */
export interface KeiQualityMetrics {
  // 百科更新
  encyclopediaUpdatesOriginal: number;    // ALICE 建议的百科更新数
  encyclopediaUpdatesCorrected: number;   // KEI 修正后的百科更新数
  encyclopediaUpdatesChanged: number;     // KEI 实际修改了内容的条目数

  // 关键信息
  criticalFactsOriginal: number;
  criticalFactsCorrected: number;

  // 任务
  questsOriginal: number;
  questsCorrected: number;

  // 修正率
  correctionRate: number;  // 被 KEI 修改的条目 / 总条目

  // 审核计数
  totalReviews: number;    // 总审核次数
  approvedReviews: number; // KEI 直接 approved（无修正）的次数

  // 文学控制指标（文学性世界引擎 v1）
  spoilerWarningCount: number;   // 累计泄密警告次数
  literaryWarningCount: number;  // 累计文学退化警告次数
}

export interface QualitySlice {
  keiQuality: KeiQualityMetrics;

  /** 记录一次 KEI 审核结果，自动计算原始 vs 修正差异 */
  recordKeiReview: (params: {
    originalEncyclopedias: number;
    originalCriticalFacts: number;
    originalQuests: number;
    correctedEncyclopedias: number;
    correctedCriticalFacts: number;
    correctedQuests: number;
    /** KEI 实际修改了内容的条目数（非仅格式调整） */
    encyclopediasChanged: number;
    /** KEI 是否直接 approved（无任何修正） */
    approved: boolean;
    /** 本轮泄密警告数 */
    spoilerWarningCount?: number;
    /** 本轮文学退化警告数 */
    literaryWarningCount?: number;
  }) => void;

  /** 重置本局质量指标 */
  resetQuality: () => void;
}

const DEFAULT_METRICS: KeiQualityMetrics = {
  encyclopediaUpdatesOriginal: 0,
  encyclopediaUpdatesCorrected: 0,
  encyclopediaUpdatesChanged: 0,
  criticalFactsOriginal: 0,
  criticalFactsCorrected: 0,
  questsOriginal: 0,
  questsCorrected: 0,
  correctionRate: 0,
  totalReviews: 0,
  approvedReviews: 0,
  spoilerWarningCount: 0,
  literaryWarningCount: 0,
};

export const createQualitySlice = (
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  set: (partial: any) => void,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  _get: () => any,
  _store?: any
): QualitySlice => ({
  keiQuality: { ...DEFAULT_METRICS },

  recordKeiReview: (params) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    set((s: any) => {
      const prev = s.keiQuality as KeiQualityMetrics;
      const encycOriginal = prev.encyclopediaUpdatesOriginal + params.originalEncyclopedias;
      const encycCorrected = prev.encyclopediaUpdatesCorrected + params.correctedEncyclopedias;
      const encycChanged = prev.encyclopediaUpdatesChanged + params.encyclopediasChanged;
      const factsOriginal = prev.criticalFactsOriginal + params.originalCriticalFacts;
      const factsCorrected = prev.criticalFactsCorrected + params.correctedCriticalFacts;
      const questsOriginal = prev.questsOriginal + params.originalQuests;
      const questsCorrected = prev.questsCorrected + params.correctedQuests;
      const totalReviews = prev.totalReviews + 1;
      const approvedReviews = prev.approvedReviews + (params.approved ? 1 : 0);
      const spoilerWarningCount = prev.spoilerWarningCount + (params.spoilerWarningCount ?? 0);
      const literaryWarningCount = prev.literaryWarningCount + (params.literaryWarningCount ?? 0);

      // 修正率 = 被修改的条目数 / 总原始条目数
      const totalOriginal = encycOriginal + factsOriginal + questsOriginal;
      const totalChanged = encycChanged;
      const correctionRate = totalOriginal > 0
        ? Math.round((totalChanged / totalOriginal) * 1000) / 1000
        : 0;

      return {
        keiQuality: {
          encyclopediaUpdatesOriginal: encycOriginal,
          encyclopediaUpdatesCorrected: encycCorrected,
          encyclopediaUpdatesChanged: encycChanged,
          criticalFactsOriginal: factsOriginal,
          criticalFactsCorrected: factsCorrected,
          questsOriginal: questsOriginal,
          questsCorrected: questsCorrected,
          correctionRate,
          totalReviews,
          approvedReviews,
          spoilerWarningCount,
          literaryWarningCount,
        },
      };
    }),

  resetQuality: () => set({ keiQuality: { ...DEFAULT_METRICS } }),
});
