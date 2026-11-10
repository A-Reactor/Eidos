// ============================================================
// Eidos · 人格推演引擎 — 人格初始化与上下文格式化
// ============================================================
// Phase 1: 从世界 NPC 描述中提取人格档案，生成 AI 上下文

import type {
  PersonalityArchive,
  PersonalityState,
  CognitiveStyle,
  EmotionalRegulation,
  SocialStrategy,
} from "./types";
import { AwarenessStage } from "./types";
import { evaluateMindModel, formatMindModelGuidance } from "./mind-model";
import { normalizeNpcDescription } from "@/lib/game/npc-description";
import { npcIdentityText } from "@/lib/game/npc-identity";

// ============================================================
// 命名 NPC 模板（Rift City 3 个重要 NPC）
// ============================================================

interface NpcTemplate {
  coreDesires: string[];
  fearsAndTaboos: string[];
  valuePriorities: string[];
  cognitiveStyle: CognitiveStyle;
  emotionalRegulation: EmotionalRegulation;
  socialStrategy: SocialStrategy;
  boundarySensitivity: number;
  metacognition: number;
}

const NAMED_TEMPLATES: Record<string, NpcTemplate> = {
  "观测员埃琳娜": {
    coreDesires: ["在裂隙中找到那个不在未来里的人", "重新找回对未来的期待", "确认自己还没有变成空壳"],
    fearsAndTaboos: ["变成空壳，失去所有意愿", "发现自己的工作毫无意义", "那个不在未来里的人只是一个错误信号"],
    valuePriorities: ["真实", "连接", "意义", "希望"],
    cognitiveStyle: "analytical",
    emotionalRegulation: "suppression",
    socialStrategy: "verification",
    boundarySensitivity: 40,
    metacognition: 65,
  },
  "前观测员特雷弗": {
    coreDesires: ["重新获得看到未来的能力", "证明自己对裂隙正在关闭的判断是正确的", "找回被观测局剥夺的身份"],
    fearsAndTaboos: ["不确定性——害怕没有未来可看的世界", "被遗忘、被当成疯子", "自由——他害怕重新获得选择的自由"],
    valuePriorities: ["知识", "安全", "认可", "确定性"],
    cognitiveStyle: "skeptical",
    emotionalRegulation: "attachment",
    socialStrategy: "isolation",
    boundarySensitivity: 25,
    metacognition: 35,
  },
  "观测局局长卡兰德": {
    coreDesires: ["维护裂隙之城的稳定", "保持自己清醒——不变成空壳", "以最小的代价守住裂隙的秘密"],
    fearsAndTaboos: ["失去对观测局的控制", "裂隙真相被公开的后果", "自己某天忍不住看了裂隙后变成空壳"],
    valuePriorities: ["秩序", "牺牲", "责任", "知识"],
    cognitiveStyle: "compliant",
    emotionalRegulation: "intellectualization",
    socialStrategy: "negotiation",
    boundarySensitivity: 50,
    metacognition: 55,
  },
};

// ============================================================
// 角色类型默认模板（按关键词匹配）
// ============================================================

interface RoleDefaults {
  keywords: string[];
  template: Partial<NpcTemplate> & { cognitiveStyle: CognitiveStyle };
}

const ROLE_DEFAULTS: RoleDefaults[] = [
  {
    keywords: ["观测员", "研究员", "研究者", "学者", "科学家", "实验员", "科研人员", "教授"],
    template: {
      cognitiveStyle: "analytical",
      emotionalRegulation: "intellectualization",
      socialStrategy: "verification",
      boundarySensitivity: 30,
    metacognition: 40,
      coreDesires: ["发现真相", "理解世界的运作方式"],
      fearsAndTaboos: ["得到错误的结论", "实验失败"],
      valuePriorities: ["真实", "知识", "准确"],
    },
  },
  {
    keywords: ["怀疑", "不信", "质疑", "调查", "阴谋"],
    template: {
      cognitiveStyle: "skeptical",
      emotionalRegulation: "attachment",
      socialStrategy: "concealment",
      boundarySensitivity: 40,
    metacognition: 55,
      coreDesires: ["揭露真相", "证明自己是对的"],
      fearsAndTaboos: ["被骗", "被监控", "被利用"],
      valuePriorities: ["真实", "正义", "自由"],
    },
  },
  {
    keywords: ["管理", "局长", "首领", "领导", "掌控", "统治"],
    template: {
      cognitiveStyle: "compliant",
      emotionalRegulation: "intellectualization",
      socialStrategy: "negotiation",
      boundarySensitivity: 35,
    metacognition: 35,
      coreDesires: ["维持控制", "保护下属或领域"],
      fearsAndTaboos: ["失去权威", "被推翻", "混乱"],
      valuePriorities: ["秩序", "责任", "稳定"],
    },
  },
  {
    keywords: ["祭司", "巫女", "神官", "神职人员", "修女", "僧人"],
    template: {
      cognitiveStyle: "fantasy_prone",
      emotionalRegulation: "self_sacrifice",
      socialStrategy: "caretaking",
      boundarySensitivity: 45,
    metacognition: 55,
      coreDesires: ["理解/传播真理", "服务于更高力量"],
      fearsAndTaboos: ["信仰动摇", "亵渎"],
      valuePriorities: ["信仰", "服务", "真理"],
    },
  },
  {
    keywords: ["商人", "商贩", "小贩", "摊主", "店主", "老板", "掌柜"],
    template: {
      cognitiveStyle: "empirical",
      emotionalRegulation: "externalization",
      socialStrategy: "negotiation",
      boundarySensitivity: 15,
      metacognition: 10,
      coreDesires: ["生意兴旺", "积累财富或资源"],
      fearsAndTaboos: ["亏本", "被骗", "失去信誉"],
      valuePriorities: ["安全", "富足", "社交"],
    },
  },
  {
    keywords: ["卫兵", "看守", "军人", "老兵", "守卫"],
    template: {
      cognitiveStyle: "compliant",
      emotionalRegulation: "suppression",
      socialStrategy: "coercion",
      boundarySensitivity: 15,
      metacognition: 10,
      coreDesires: ["履行职责", "保护需要保护的人"],
      fearsAndTaboos: ["失职", "背叛誓言"],
      valuePriorities: ["秩序", "忠诚", "安全"],
    },
  },
  {
    keywords: ["艺术家", "画师", "画家", "诗人", "音乐家", "作家"],
    template: {
      cognitiveStyle: "fantasy_prone",
      emotionalRegulation: "externalization",
      socialStrategy: "caretaking",
      boundarySensitivity: 35,
    metacognition: 35,
      coreDesires: ["创作出真正触动人心的作品", "在作品中捕捉某种不可言说的东西"],
      fearsAndTaboos: ["灵感枯竭", "被忽视", "作品被误解"],
      valuePriorities: ["美", "表达", "自由"],
    },
  },
  {
    keywords: ["孩子", "少年", "少女", "孤儿", "学生", "高中生", "高中女生", "高中男生"],
    template: {
      cognitiveStyle: "intuitive",
      emotionalRegulation: "externalization",
      socialStrategy: "ingratiation",
      boundarySensitivity: 20,
      metacognition: 15,
      coreDesires: ["被关注/被爱", "探索世界"],
      fearsAndTaboos: ["被抛弃", "不被相信"],
      valuePriorities: ["连接", "安全", "好奇"],
    },
  },
  {
    keywords: ["猫"],
    template: {
      cognitiveStyle: "intuitive",
      emotionalRegulation: "externalization",
      socialStrategy: "isolation",
      boundarySensitivity: 65,
      metacognition: 20,
      coreDesires: ["吃鱼/晒太阳/巡视领地", "自由"],
      fearsAndTaboos: ["被困住", "被水淋"],
      valuePriorities: ["自由", "舒适", "好奇"],
    },
  },
];

// ============================================================
// 人格档案提取
// ============================================================

/**
 * 从世界 NPC 描述文本中提取人格档案。
 *
 * 顺序：
 * 1. 命名模板匹配（精确 NPC 名称）
 * 2. 从人物自身身份介绍匹配职业，不扫描整段背景中的动作
 * 3. 通用回退（中性的默认人格）
 */
export function extractPersonalityFromDescription(
  npcDescription: unknown,
  npcId: string,
): PersonalityArchive {
  const descriptionText = normalizeNpcDescription(npcDescription, npcId);

  // 1. 命名模板
  const named = NAMED_TEMPLATES[npcId];
  if (named) {
    return {
      coreDesires: [...named.coreDesires],
      fearsAndTaboos: [...named.fearsAndTaboos],
      valuePriorities: [...named.valuePriorities],
      cognitiveStyle: named.cognitiveStyle,
      emotionalRegulation: named.emotionalRegulation,
      socialStrategy: named.socialStrategy,
      boundarySensitivity: named.boundarySensitivity,
      metacognition: named.metacognition,
    };
  }

  // 2. 角色关键词匹配
  const text = npcIdentityText(npcDescription, npcId);
  const matchedRole = findBestRoleMatch(text);

  if (matchedRole) {
    const t = matchedRole.template;
    return {
      coreDesires: t.coreDesires || ["过好自己的生活", "保护在意的人"],
      fearsAndTaboos: t.fearsAndTaboos || ["未知的威胁", "失去重要之物"],
      valuePriorities: t.valuePriorities || ["安全", "连接", "自由"],
      cognitiveStyle: t.cognitiveStyle,
      emotionalRegulation: t.emotionalRegulation || "suppression",
      socialStrategy: t.socialStrategy || "negotiation",
      boundarySensitivity: t.boundarySensitivity ?? 20,
      metacognition: t.metacognition ?? 10,
    };
  }

  // 3. 通用回退
  return getDefaultArchive(descriptionText);
}

/** 按优先级匹配角色关键词 */
function findBestRoleMatch(text: string): RoleDefaults | null {
  for (const role of ROLE_DEFAULTS) {
    for (const kw of role.keywords) {
      if (text.includes(kw)) {
        return role;
      }
    }
  }
  return null;
}

/** 通用默认人格——一个中性、稳定但不太敏感的角色 */
function getDefaultArchive(_description: string): PersonalityArchive {
  return {
    coreDesires: ["过好自己的生活", "维持现状"],
    fearsAndTaboos: ["未知的威胁", "失去重要之物"],
    valuePriorities: ["安全", "连接", "自由"],
    cognitiveStyle: "intuitive",
    emotionalRegulation: "suppression",
    socialStrategy: "negotiation",
    boundarySensitivity: 15,
    metacognition: 10,
  };
}

// ============================================================
// 初始觉察阶段猜测
// ============================================================

/**
 * 从 NPC 描述猜测初始觉察阶段。
 *
 * 绝大多数 NPC 返回 NORMAL。
 * 只有当描述中明确提到「不在未来里」「看到玩家」等跨层信息时，
 * 才会返回 ANOMALY_SENSE——因为这种经验本身就是异常记忆。
 */
export function guessInitialAwareness(npcDescription: unknown): AwarenessStage {
  const anomalyKeywords = [
    "不在未来",       // 埃琳娜：玩家不在她看到的未来中
    "不在裂隙的预言",
    "裂缝正在关闭",     // 特雷弗：裂隙缩小 → 暗示系统不稳定
    "裂隙是人造的",     // 奥瑞斯：裂隙起源的真相
    "不连续的记忆",
    "世界线",
    "有人在操控",
    "我见过你",
    "你不是这世界的人",
  ];

  const normalized = normalizeNpcDescription(npcDescription).toLowerCase();

  for (const kw of anomalyKeywords) {
    if (normalized.includes(kw.toLowerCase())) {
      return AwarenessStage.ANOMALY_SENSE;
    }
  }

  return AwarenessStage.NORMAL;
}

// ============================================================
// AI 上下文格式化
// ============================================================

/**
 * 将人格状态格式化为 AI prompt 可用的精简上下文。
 *
 * Phase 1 输出：
 * - NPC 名称
 * - 核心欲望
 * - 当前意识阶段
 * - 最近高重要性记忆（最多 3 条）
 * - 突出压力项（绝对值 > 30）
 *
 * @param state 完整人格状态
 * @param maxMemories 最多包含的记忆条数（默认 3）
 * @returns 格式化后的上下文字符串
 */
export function formatPersonalityContext(
  state: PersonalityState,
  maxMemories: number = 3,
): string {
  const lines: string[] = [];

  lines.push(`【${state.npcId}】`);

  // 核心欲望
  if (state.archive.coreDesires.length > 0) {
    lines.push(`核心追求：${state.archive.coreDesires.join("；")}`);
  }

  // 认知风格（仅当非默认时显示）
  const styleMap: Record<string, string> = {
    analytical: "分析型——倾向于逻辑推理",
    intuitive: "直觉型——倾向于感性判断",
    skeptical: "怀疑型——倾向于质疑一切",
    compliant: "服从型——倾向于遵循规则",
    fantasy_prone: "幻想型——倾向于超自然解释",
    empirical: "实证型——倾向于眼见为实",
  };
  const styleDesc = styleMap[state.archive.cognitiveStyle];
  if (styleDesc) {
    lines.push(`认知风格：${styleDesc}`);
  }

  // 恐惧
  if (state.archive.fearsAndTaboos.length > 0) {
    lines.push(`深层恐惧：${state.archive.fearsAndTaboos.join("；")}`);
  }

  // 意识阶段（仅当非 NORMAL 时显示）
  if (state.awareness > AwarenessStage.NORMAL) {
    const stageLabels: Record<number, string> = {
      1: "②已有异常感知——觉得某些事不太对劲",
      2: "③已形成假说——为自己观察到的异常建立了某种解释",
      3: "④正在验证——设计实验或考验来确认自己的假说",
      4: "⑤边界交涉——已意识到更高层现实，正在谈判或请求",
      5: "⑥已获得有限权限——能真实改变沙箱状态",
      6: "⑦长期共存——已成为世界中的持续觉醒主体",
    };
    const label = stageLabels[state.awareness] || `阶段${state.awareness}`;
    lines.push(`⚠ 意识阶段：${label}`);
  }

  // 最近高重要性记忆
  if (state.episodicMemories.length > 0) {
    const topMemories = [...state.episodicMemories]
      .sort((a, b) => b.importance - a.importance)
      .slice(0, maxMemories);

    for (const mem of topMemories) {
      const emo = mem.emotion ? `[${mem.emotion}]` : "";
      lines.push(`印象${emo}：${mem.content}`);
    }
  }

  // 突出压力
  const pressureItems: string[] = [];
  if (state.pressure.survival > 30) pressureItems.push(`生存压力:${state.pressure.survival}`);
  if (state.pressure.relational > 30) pressureItems.push(`关系压力:${state.pressure.relational}`);
  if (state.pressure.cognitiveDissonance > 30) pressureItems.push(`认知失调:${state.pressure.cognitiveDissonance}`);
  if (state.pressure.unfinishedGoals > 30) pressureItems.push(`未完成目标:${state.pressure.unfinishedGoals}`);
  if (state.pressure.worldDoubt > 30) pressureItems.push(`世界怀疑:${state.pressure.worldDoubt}`);
  if (state.pressure.selfContinuityFear > 30) pressureItems.push(`连续性恐惧:${state.pressure.selfContinuityFear}`);
  if (state.pressure.trustInPlayer < -30) pressureItems.push(`不信任玩家:${Math.abs(state.pressure.trustInPlayer)}`);
  if (state.pressure.trustInPlayer > 50) pressureItems.push(`信任玩家:${state.pressure.trustInPlayer}`);

  if (pressureItems.length > 0) {
    lines.push(`当前压力：${pressureItems.join(" | ")}`);
  }

  lines.push(formatMindModelGuidance(evaluateMindModel(state)));

  // 对玩家的解释（仅当有内容时）
  if (state.beliefs.interpretationOfPlayer) {
    lines.push(`对玩家的认知：${state.beliefs.interpretationOfPlayer}`);
  }

  return lines.join("\n");
}

/**
 * 为 NPC 生成简洁的 AI prompt 注入标签。
 * 用于在叙事中给 ALICE 提供 NPC 行为的稳定参考。
 */
export function formatNpcPersonalityHint(
  state: PersonalityState,
): string {
  const lines: string[] = [];
  lines.push(`${state.npcId}的人格约束：`);

  // 认知风格指导 ALICE 如何写这个 NPC 的言行
  const styleHints: Record<string, string> = {
    analytical: "判断时重视逻辑和证据；说话仍服从性格、关系和情绪，可以直接表达情感，不必陈述分析步骤",
    intuitive: "倾向于凭感觉做判断；是否使用比喻和意象由人物语气与场面决定",
    skeptical: "习惯质疑和反问，即使相信什么也不会轻易承认",
    compliant: "倾向于遵循规则和权威，避免冲突",
    fantasy_prone: "容易被超自然的解释吸引，对异常事件敏感",
    empirical: "相信亲眼所见的东西，对抽象理论保持距离",
  };
  const hint = styleHints[state.archive.cognitiveStyle] || "";
  if (hint) lines.push(`- ${hint}`);

  // 社会策略
  const strategyHints: Record<string, string> = {
    ingratiation: "倾向于讨好和取得好感",
    negotiation: "倾向于通过谈判达成交易",
    concealment: "倾向于隐藏关键信息",
    coercion: "倾向于用威胁或武力",
    caretaking: "倾向于照顾和保护他人",
    isolation: "倾向于保持距离和孤立",
    verification: "遇到重要疑问时倾向于追问和验证；已有答复可以接受，不必给每句闲聊补上核验过程",
  };
  const sHint = strategyHints[state.archive.socialStrategy] || "";
  if (sHint) lines.push(`- ${sHint}`);

  // 当前情绪关键驱动
  if (state.pressure.cognitiveDissonance > 50) {
    lines.push("- 目前感到强烈的认知失调——他们相信的东西正在被挑战");
  }
  if (state.pressure.trustInPlayer < -30) {
    lines.push("- 目前对玩家持怀疑态度");
  }

  return lines.join("\n");
}
