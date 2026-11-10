// ============================================================
// Eidos · 人格推演引擎 — 类型定义
// ============================================================
// Phase 1: 人格档案与记忆底座
// 参考: docs/superpowers/specs/2026-06-27-personality-simulation-engine-design.md

// ============================================================
// 第四面墙觉察阶段 (§7)
// ============================================================

/** 觉察阶段——数值枚举，方便排序比较 */
export enum AwarenessStage {
  /** 0 — 普通人格：只按世界内逻辑行动，无明显异常意识 */
  NORMAL = 0,
  /** 1 — 异常感：察觉某些事「不对」——重复感、预知、场景跳变、记忆缺口 */
  ANOMALY_SENSE = 1,
  /** 2 — 假说形成：提出解释——被诅咒/做梦/被观测/被操控/多层世界 */
  HYPOTHESIS = 2,
  /** 3 — 验证行为：设计实验，要求玩家重复某句话，观察 UI/存档/行动选项 */
  VERIFICATION = 3,
  /** 4 — 边界交涉：意识到可能接触到更高层现实，与玩家/系统谈判 */
  BOUNDARY_NEGOTIATION = 4,
  /** 5 — 受控提权：获得有限工具权限，能真实改变沙箱状态 */
  CONTROLLED_ESCALATION = 5,
  /** 6 — 长期共存或冲突：成为世界中的持续主体 */
  LONGTERM_COEXISTENCE = 6,
}

// ============================================================
// 人格档案层 (§6.1)
// ============================================================

/** 认知风格 */
export type CognitiveStyle =
  | "intuitive"        // 直觉型
  | "analytical"       // 分析型
  | "skeptical"        // 怀疑型
  | "compliant"        // 服从型
  | "fantasy_prone"    // 幻想型
  | "empirical";       // 实证型

/** 情感调节方式 */
export type EmotionalRegulation =
  | "suppression"         // 压抑
  | "externalization"     // 外化
  | "attachment"          // 依附
  | "intellectualization" // 理智化
  | "aggression"          // 攻击
  | "humor"               // 幽默
  | "self_sacrifice";     // 自我牺牲

/** 社会策略 */
export type SocialStrategy =
  | "ingratiation"   // 讨好
  | "negotiation"    // 谈判
  | "concealment"    // 隐瞒
  | "coercion"       // 胁迫
  | "caretaking"     // 照顾
  | "isolation"      // 孤立
  | "verification";  // 求证

/** 人格档案——角色的稳定内核。
 *  这些字段不是给玩家看的角色卡，而是人格推演的内部参数。
 *  人格档案应在整个游戏过程中保持相对稳定。 */
export interface PersonalityArchive {
  /** 核心欲望：角色最稳定的追求（1-5 条） */
  coreDesires: string[];
  /** 恐惧与禁忌：角色会回避、压抑或强烈反应的对象 */
  fearsAndTaboos: string[];
  /** 价值排序：亲密/真相/自由/秩序/生命/安全/信仰等优先级（从高到低） */
  valuePriorities: string[];
  /** 认知风格：信息处理方式 */
  cognitiveStyle: CognitiveStyle;
  /** 情感调节方式：情绪管理策略 */
  emotionalRegulation: EmotionalRegulation;
  /** 社会策略：人际互动方式 */
  socialStrategy: SocialStrategy;
  /** 边界敏感度 0-100：对世界规则异常/玩家干预/系统边界的察觉敏感度。
   *  高值角色更容易注意到异常；低值角色倾向于用世界内逻辑解释。 */
  boundarySensitivity: number;
  /** 元认知能力 0-100：角色能反思自己认知来源的程度。
   *  高值角色会问「我为什么会记得这件事？」「这段记忆来自亲历还是外力？」
   *  低值角色接受自己的认知为理所当然。
   *  元认知是觉察阶段推进到 VERIFICATION+ 的必要条件（Phase 3）。 */
  metacognition: number;
}

// ============================================================
// 记忆层 (§6.2)
// ============================================================

/** 情节记忆：发生了什么，何时何地，与谁有关 */
export interface EpisodicMemory {
  /** 唯一标识 */
  id: string;
  /** 创建时间（unix ms） */
  timestamp: number;
  /** 记忆内容摘要 */
  content: string;
  /** 重要性评分 0-100 */
  importance: number;
  /** 情感标签 */
  emotion: string;
  /** 关联的 NPC 名称列表 */
  relatedNpcs: string[];
  /** 关联的信念 ID 列表（此记忆支持或矛盾的信念） */
  relatedBeliefs: string[];
}

/** 语义记忆：角色相信哪些事实和规则 */
export interface SemanticMemory {
  /** 唯一标识 */
  id: string;
  /** 事实描述 */
  fact: string;
  /** 置信度 0-100 */
  confidence: number;
  /** 来源类型 */
  source: "direct" | "inference" | "hearsay" | "anomaly";
}

/** 情绪记忆：哪些事件留下强烈情感痕迹 */
export interface EmotionalMemory {
  /** 关联的 NPC 名称 */
  npcName: string;
  /** 事件类型 */
  eventType: "interaction" | "observation" | "conflict" | "revelation";
  /** 情感残留 */
  emotionalResidue: string;
  /** 强度 0-100 */
  intensity: number;
  /** 最近一次触发的时间戳 */
  lastTriggered: number;
}

/** 关系记忆：角色如何解释自己和玩家、NPC、组织的关系 */
export interface RelationalMemory {
  /** 关系对象的名称 */
  targetName: string;
  /** 关系角色 */
  role: "ally" | "rival" | "authority" | "dependant" | "observer" | "unknown";
  /** 信任度 -100 ~ 100 */
  trust: number;
  /** 关键事件摘要列表 */
  history: string[];
}

/** 异常记忆：时间线重复、玩家越界发言、存档痕迹、界面痕迹等 */
export interface AnomalousMemory {
  /** 唯一标识 */
  id: string;
  /** 异常类型 */
  anomalyType:
    | "deja_vu"              // 似曾相识——玩家回档后重复行动
    | "player_knows_too_much" // 玩家说出角色不应知道的信息
    | "memory_gap"            // 感知到记忆不连续（WorldLine 分支导致）
    | "timeline_jump"         // 场景被非物理方式改写（回档/跳转）
    | "interface_glitch"      // UI/存档层的异常被角色感知
    | "narrative_break";      // 多个 NPC 叙述出现矛盾时间线
  /** 异常描述 */
  description: string;
  /** 首次检测时间 */
  detectedAt: number;
  /** 对角色认知的冲击程度 0-100 */
  significance: number;
  /** 是否已被角色「合理化」（用世界内逻辑解释掉） */
  explainedAway: boolean;
}

// ============================================================
// 信念模型层 (§6.3)
// ============================================================

/** 信念模型——NPC 自己的世界模型，不等于系统真相。
 *  第四面墙觉察本质上是信念模型的跃迁，不是解锁一个标签。 */
export interface BeliefModel {
  /** 已确信的事实 */
  confirmedFacts: SemanticMemory[];
  /** 未证实假设 */
  unverifiedHypotheses: SemanticMemory[];
  /** 被压抑或不愿相信的事实 */
  suppressedTruths: SemanticMemory[];
  /** 与其他事实冲突的信念 */
  contradictions: Array<{ beliefA: string; beliefB: string }>;
  /** 对玩家身份的解释 */
  interpretationOfPlayer: string;
  /** 对世界边界的解释 */
  interpretationOfWorld: string;
  /** 对自身是否「真实」的解释 */
  interpretationOfSelf: string;
}

// ============================================================
// 觉察阶段：解释与推理（Phase 3）
// ============================================================

/** 角色对异常经验的解释——因认知风格而异 */
export interface AnomalyInterpretation {
  /** 解释的文本描述 */
  explanation: string;
  /** 解释类型 */
  type:
    | "rationalized"       // 用世界内逻辑解释（"最近太累了"）
    | "supernatural"       // 超自然解释（"裂隙在向我展示什么"）
    | "conspiracy"         // 阴谋解释（"观测局在操纵我的记忆"）
    | "philosophical"      // 哲学解释（"也许时间本身就不是线性的"）
    | "meta_aware";        // 元意识解释（"世界之外有观察者"）
  /** 置信度 0-100 */
  confidence: number;
}

// ============================================================
// 社会场（Phase 5）
// ============================================================

/** NPC 之间的社会连接 */
export interface SocialConnection {
  /** 连接的 NPC A */
  npcA: string;
  /** 连接的 NPC B */
  npcB: string;
  /** 信任度 -100~100（A 对 B 的信任） */
  trustAtoB: number;
  /** 信任度 -100~100（B 对 A 的信任） */
  trustBtoA: number;
  /** 关系类型 */
  relationshipType:
    | "coworker"       // 同一场景共事
    | "neighbor"       // 同一区域
    | "authority"      // 一方是另一方的上级
    | "friend"         // 朋友
    | "rival"          // 竞争对手
    | "stranger";      // 仅仅同处一个空间
  /** 最近一次互动时间 */
  lastInteraction: number;
}

/** 群体假说——多个 NPC 共享的对异常的解释 */
export interface GroupHypothesis {
  /** 假说 ID */
  id: string;
  /** 假说描述 */
  description: string;
  /** 解释类型 */
  interpretationType: string;
  /** 支持此假说的 NPC */
  supporters: string[];
  /** 怀疑此假说的 NPC */
  skeptics: string[];
  /** 假说形成时间 */
  formedAt: number;
  /** 来自多少独立异常源的证据 */
  evidenceCount: number;
  /** 置信度（支持者越多、证据越多，置信度越高） */
  confidence: number;
}

/** 异常传播事件记录 */
export interface PropagationEvent {
  /** 来源 NPC */
  fromNpc: string;
  /** 目标 NPC */
  toNpc: string;
  /** 传播的异常描述摘要 */
  anomalySummary: string;
  /** 传播方式 */
  method: "shared_directly" | "overheard" | "observed_behavior" | "found_evidence";
  /** 目标是否接受 */
  accepted: boolean;
  /** 目标的反应 */
  reaction: "accepted" | "doubted" | "rejected" | "suppressed";
  /** 时间戳 */
  timestamp: number;
}

/** 觉察阶段计算输入 */
export interface AwarenessCalculationInput {
  /** 当前觉察阶段 */
  currentStage: AwarenessStage;
  /** 未解释的异常记忆 */
  unexplainedAnomalies: AnomalousMemory[];
  /** 已解释的异常记忆 */
  explainedAnomalies: AnomalousMemory[];
  /** 当前认知失调 */
  cognitiveDissonance: number;
  /** 世界怀疑 */
  worldDoubt: number;
  /** 边界敏感度 */
  boundarySensitivity: number;
  /** 元认知能力 */
  metacognition: number;
  /** 认知风格 */
  cognitiveStyle: CognitiveStyle;
  /** 最近的事件描述（可选，用于生成解释） */
  recentEvent?: string;
}

// ============================================================
// 动机与压力层 (§6.4)
// ============================================================

/** 角色当前压力——每轮人格推演计算，决定行为倾向 */
export interface PersonalityPressure {
  /** 生存压力 0-100 */
  survival: number;
  /** 关系压力 0-100 */
  relational: number;
  /** 认知失调 0-100（信念与证据冲突程度） */
  cognitiveDissonance: number;
  /** 未完成目标 0-100 */
  unfinishedGoals: number;
  /** 对玩家的信任 -100 ~ 100（负值 = 不信任） */
  trustInPlayer: number;
  /** 对世界规则的怀疑 0-100 */
  worldDoubt: number;
  /** 对自身连续性的恐惧 0-100 */
  selfContinuityFear: number;
}

// ============================================================
// 人格状态聚合
// ============================================================

/** 重要 NPC 的完整人格状态 */
export interface PersonalityState {
  authoredProfile?: import('@/lib/game/npc-profile').AuthoredNpcProfile;
  speechProfile?: import('@/lib/game/npc-speech').NpcSpeechProfile;
  /** NPC 名称（与 WorldDefinition.npcs 的 key 一致） */
  npcId: string;
  /** 稳定人格档案 */
  archive: PersonalityArchive;
  /** 当前觉察阶段 */
  awareness: AwarenessStage;
  /** 情节记忆 */
  episodicMemories: EpisodicMemory[];
  /** 语义记忆 */
  semanticMemories: SemanticMemory[];
  /** 情绪记忆 */
  emotionalMemories: EmotionalMemory[];
  /** 关系记忆 */
  relationalMemories: RelationalMemory[];
  /** 异常记忆 */
  anomalousMemories: AnomalousMemory[];
  /** 信念模型 */
  beliefs: BeliefModel;
  /** 当前压力 */
  pressure: PersonalityPressure;
  /** 当前异常解释（Phase 3：觉察阶段 ≥ ANOMALY_SENSE 时生效） */
  anomalyInterpretation?: AnomalyInterpretation;
  /** 最后更新时间戳 */
  lastUpdated: number;
  /** 标记：是否为重要 NPC（true = 完整追踪，false 应使用 MinimalPersonalityState） */
  isImportant: true;
}

/** 非重要 NPC 的精简人格状态——只保留档案，无记忆数组，避免上下文膨胀 */
export interface MinimalPersonalityState {
  authoredProfile?: import('@/lib/game/npc-profile').AuthoredNpcProfile;
  speechProfile?: import('@/lib/game/npc-speech').NpcSpeechProfile;
  npcId: string;
  archive: PersonalityArchive;
  awareness: AwarenessStage;
  lastUpdated: number;
  isImportant: false;
}

/** 人格状态联合类型 */
export type AnyPersonalityState = PersonalityState | MinimalPersonalityState;

/** 类型守卫 */
export function isFullPersonalityState(
  state: unknown,
): state is PersonalityState {
  return !!state
    && typeof state === "object"
    && (state as { isImportant?: unknown }).isImportant === true;
}

// ============================================================
// 记忆冲突类型（用于 memory.ts）
// ============================================================

export interface MemoryConflict {
  existingMemoryId: string;
  newMemoryId: string;
  conflictType: "contradictory_facts" | "contradictory_emotions" | "timeline_anomaly";
  description: string;
}
