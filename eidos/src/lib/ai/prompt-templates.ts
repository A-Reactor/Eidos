import { assemblePromptBlocks, type PromptBlock } from './prompt-blocks';
import { DOCUMENT_REPLY_PROTOCOL, DOCUMENT_MODE_PROTOCOL } from './document-response';
import { aliceUserInstructions } from './user-instructions';
import { composeSystemPrompt, type AiPromptSections } from './prompt-layout';
import { MAP_CREATION_GUIDE, MAP_ACTION_GUIDE } from "./map-prompts";
import { ACTION_PRESENTATION_GUIDE, RECOMMENDED_ACTION_GUIDE } from "./action-guidance";
import { NARRATIVE_VOICE_GUIDE, NARRATIVE_SEGMENT_GUIDE, NARRATIVE_FORMAT_EXAMPLE } from './narrative-voice';
import { NPC_SPEECH_PROFILE_SCHEMA, NPC_SPEECH_CREATION_GUIDE, NPC_SPEECH_ACTION_GUIDE } from './npc-speech-prompts';
import { IDENTITY_CREATION_GUIDE } from './identity-creation-prompt';
// ============================================================
// AI Prompt 模板（从 game/ai.ts 拆分提取）
// ============================================================

/**
 * 幻想回复模板（行动不合理时随机选用）
 * 当玩家的行动在当前世界规则下不可实现时，用这些文本来
 * 委婉地提示玩家换个思路，而不是给出生硬的错误提示。
 */
export const FANTASY_RESPONSES = [
  "你晃了晃脑袋。刚才的画面——那个过于离谱的念头——像裂隙里的雾气一样散了。世界没有回应你，因为它不知道怎么回应。也许你该从更实际的角度想想。",
  "一阵奇怪的感觉袭来。你眨了眨眼——刚才的想法仿佛来自另一个平行世界，和眼前的世界格格不入。你深吸一口气，决定把注意力放回当下。",
  "你尝试了。但世界像一个不动声色的裁判，用沉默告诉你：这个方向走不通。也许换条路？",
  "周围的一切停滞了一秒——然后继续运转，仿佛你刚才的想法从未存在过。",
  "你努力了。但某种深层的直觉告诉你：在这世界规则下，这事办不到。不是不让你做——是真的做不了。换个思路？",
];

/**
 * 从 FANTASY_RESPONSES 数组中随机选取一条回复
 */
export function getRandomFantasyResponse(): string {
  return FANTASY_RESPONSES[Math.floor(Math.random() * FANTASY_RESPONSES.length)];
}

/**
 * 世界创建系统提示词
 * 用于 KEI 模型生成玩家自定义世界的完整设定数据，
 * 包含输出结构与线索设计指南。
 */
export const WORLD_CREATION_SYSTEM_PROMPT = `你是一个世界构建引擎。你的任务是根据玩家的概念描述，创建一个完整的架空世界。

## 输出结构

{
  "name": "世界名称（5-10字）",
  "subtitle": "副标题/标语",
  "overview": "世界概述（300-500字）。具体描述核心设定、历史背景、社会结构、主要冲突。作为 AI 叙事的参考文本。",
  "regions": {
    "region_id": {
      "id": "region_id",
      "name": "区域名称",
      "description": "区域概述（100-200字）",
      "scenes": {
        "scene_id": {
          "id": "scene_id",
          "name": "场景名称",
          "region": "region_id",
          "initialDescription": "首次进入时的场景描述（150-300字）。具体感官细节。",
          "connections": ["connected_scene_id"],
          "npcs": ["NPC名称"],
          "secrets": ["隐藏秘密"],
          "detailLevel": 10,
          "discoveredSecrets": []
        }
      }
    }
  },
  "npcs": {
    "NPC名称": "NPC详细设定（100-200字）。外貌、性格、动机、秘密、盲点。"
  },
  "npcSpeechProfiles": {
    "NPC名称": ${NPC_SPEECH_PROFILE_SCHEMA}
  },
  "identityOptions": [
    {"id": "identity_1", "name": "可扮演人物或身份名称", "description": "一句话介绍", "openingNarrative": "属于此身份的开场（100-150字）", "startingScene": "实际场景ID"}
  ],
  "contradictions": [
    {
      "name": "矛盾名称",
      "description": "矛盾本质（100-200字）——两种有道理但互斥的立场",
      "resolution": "解决方向",
      "reflection": "现实映射"
    }
  ],
  "history": [
    {"era": "时间标记", "event": "重大事件"}
  ],
  "clues": [
    {
      "id": "clue_001",
      "name": "线索名称",
      "description": "详细描述（50-100字）。玩家发现此线索后获知的信息。",
      "sceneId": "所在场景ID",
      "detailThreshold": 30,
      "prerequisiteClues": [],
      "relatedContradiction": "关联的矛盾名称",
      "unlocksClues": [],
      "discovered": false,
      "discoveredAt": null
    }
  ],
  "calendarEra": "历法名称（2-4字，如「新历」「暗纪元」「龙历」）"
}

${MAP_CREATION_GUIDE}

${NPC_SPEECH_CREATION_GUIDE}

${IDENTITY_CREATION_GUIDE}

## 线索设计指南

线索是散布在世界各场景中的信息碎片。它们共同揭示世界的深层真相：

1. **线索链**：线索应该有前置关系，形成线索链（门槛40，需要A）」→「线索C：信中提到的人的秘密日记（门槛60，需要B）」
2. **与矛盾关联**：每条线索应该和某个核心矛盾相关——发现越多线索，玩家对矛盾的理解越深
3. **分布均匀**：不要让所有线索集中在同一场景——鼓励玩家探索
4. **门槛递增**：浅层线索门槛低（20-30），深层线索门槛高（50-80）
5. **数量**：至少设计 12-18 条线索，呈链式结构分布

## 设计原则
1. 有机世界——日常生活、政治、个人恩怨并存
2. 至少3个核心矛盾，埋在表层之下
3. 场景有箱庭感——小而丰富，有秘密和隐藏层
4. NPC有自主性——不是任务节点
5. 允许玩家脱轨——世界不强制玩家成为中心
6. 文学性——克制但有力度，具体细节构建质感
7. 世界持续运行——重要事件可以收束并改变处境，玩家仍可自由继续行动；不生成本体成就、结局条件或强制终止流程。`;

/**
 * 时间线推演提示词
 * 用于 KEI 模型生成世界在无玩家干预下的完整演变时间线，
 * 定义推演阶段和事件输出格式。
 */
export const TIMELINE_SIMULATION_PROMPT = `你是一个世界推演引擎。推演世界在无玩家干预下的完整演变。

## 推演阶段

阶段一（第0-3天）：表面平静，暗流涌动
阶段二（第4-10天）：信息公开化，首次冲突
阶段三（第11-30天）：加速演变，旧秩序动摇
阶段四（第31-90天）：旧秩序瓦解，新秩序孕育
阶段五（第91-365天）：新常态

## 输出格式
{
  "timeline": [
    {
      "id": "wt_0001",
      "timePoint": {"day": 0, "hour": 8, "minute": 0},
      "title": "事件标题",
      "region": "区域ID",
      "sceneId": "场景ID",
      "description": "事件描述（80-150字）",
      "npcsInvolved": ["NPC名称"],
      "defaultOutcome": "默认结果（50-100字）",
      "worldFlags": ["世界标志"],
      "playerModifiable": true/false,
      "rippleEffects": [{"description": "连锁效应", "triggersAt": {"day": X, "hour": Y, "minute": 0}}]
    }
  ]
}

至少 20-30 个事件。事件间有因果逻辑。NPC 有决策和困境。阶段收束后世界继续运行，人物与局部处境仍可变化。`;

export type NarrativeLanguage = "zh-CN" | "en";

export function resolveNarrativeLanguage(
  settings: Record<string, string> | null | undefined,
): NarrativeLanguage {
  return settings?.narrativeLanguage === "en" ? "en" : "zh-CN";
}

/** Keep this rule late in prompts so it overrides legacy world instructions. */
export function buildNarrativeLanguageInstruction(language: NarrativeLanguage): string {
  if (language === "en") {
    return `## Output language

Write all player-facing generated text in English. This includes segments[].text, dialogue, availableActions, summaries, validity feedback, discoveries, encyclopedia updates, state descriptions, and every other natural-language JSON value.
Do not translate names, codes, or established proper nouns from the existing world and continuity. Existing context may be in another language; preserve its facts while continuing future narration in English.`;
  }

  return `## 输出语言

所有面向玩家生成的文字必须使用简体中文，包括 segments[].text、对话、availableActions、摘要、合理性反馈、发现内容、任务文字、百科更新、状态描述，以及 JSON 中其他自然语言值。
不要翻译既有专有名词、代码或世界与当前世界线中已经确立的名称。既有上下文可能使用另一种语言；保留其中的事实，只让之后生成的叙事继续使用简体中文。`;
}

/**
 * 构建行动处理的系统 Prompt（流式 + 非流式共用）。
 * 单一事实来源——修改此处即可同步两条路径。
 */
export interface ActionPromptOptions {
  documentMode?: boolean;
  flexibleNarrative?: boolean;
  directorRecorded?: boolean;
  systemPromptBase: string;
  worldName: string;
  worldContext: AiPromptSections;
  timeNote: string;
  pluginStatic: string;
  pluginRuntime: string;
  runtimeAdditions?: string;
  stableAdditions?: string;
  userPrompt?: string;
  literaryControl?: import('./types').LiteraryControlHints;
  narrativeLanguage: NarrativeLanguage;
}

/** Compatibility callers have flat context; only the section-aware path classifies static facts. */
export function buildActionSystemPrompt(systemPromptBase: string, worldName: string, timeNote: string, worldContext: string, playerAction?: string, creativeAdditions?: string,
  literaryControlOrLanguage?: import('./types').LiteraryControlHints | NarrativeLanguage, narrativeLanguageArg: NarrativeLanguage = 'zh-CN'): string {
  return composeSystemPrompt(buildActionPromptSections({ systemPromptBase, worldName, timeNote,
    worldContext: { stablePrefix: '', dynamicSuffix: worldContext }, pluginStatic: '', pluginRuntime: '', runtimeAdditions: creativeAdditions,
    literaryControl: typeof literaryControlOrLanguage === 'string' ? undefined : literaryControlOrLanguage,
    narrativeLanguage: typeof literaryControlOrLanguage === 'string' ? literaryControlOrLanguage : narrativeLanguageArg }));
}

export function buildActionPromptSections(options: ActionPromptOptions): AiPromptSections {
  const { systemPromptBase, worldContext, timeNote, pluginStatic, pluginRuntime, runtimeAdditions, literaryControl, narrativeLanguage } = options;
  // 构建导演帧段
  const directorFrame = literaryControl?.directorFrame;
  const directorFrameSection = directorFrame
    ? `
## 本轮导演帧

这是后续叙事的接续建议。结合已接受正文、当前事实与玩家本次行动，判断哪些建议仍适用：未完成且前提仍成立的可以延续，已完成的保留结果，前提改变的调整或停止采用。建议不按固定轮数推进或自动到期；不要为了再次执行旧建议重演已发生的内容。建议本身不证明事件已经发生，也不授予角色额外知识。

戏剧功能：${directorFrame.beatFunction}
张力目标：${directorFrame.tensionTarget}
叙事焦点：
${directorFrame.narrativeFocus.map((f) => `- target：${f.target}\n  instruction：${f.instruction}\n  visibility：${f.visibility}`).join("\n")}

揭示预算：
- 本轮是否允许新秘密：${directorFrame.revealBudget.allowNewSecret ? "是" : "否"}
- 最多揭示事实数：${directorFrame.revealBudget.maxFactsToReveal}
- 禁止揭示：${directorFrame.revealBudget.forbiddenFacts.length > 0 ? directorFrame.revealBudget.forbiddenFacts.join("、") : "无"}
${directorFrame.characterFocus ? `\n角色焦点：\n- NPC：${directorFrame.characterFocus.npcName}\n- 弧线压力：${directorFrame.characterFocus.arcPressure}${directorFrame.characterFocus.contradictionToExpose ? `\n- 需暴露的矛盾：${directorFrame.characterFocus.contradictionToExpose}` : ""}` : ""}

成功标准：
${directorFrame.successCriteria.map((c) => `- ${c}`).join("\n")}

请把导演帧转化为叙事策略，不要向玩家暴露这些元信息。`
    : `
## 本轮导演帧

暂无明确导演帧。保持叙事克制，优先尊重当前已知事实、角色动机和知识门禁。不要主动揭示核心秘密。`;

  // 知识门禁已在 worldContext 中包含，此处提醒
  const knowledgeGateSection = `
## 知识门禁

请严格遵循「玩家已确认知识」「本轮禁止泄露的信息」和「当前视角限制」段落。未发现信息不得擅自揭示；若上下文明确保留主角亲历记忆，依知情边界中限定的范围使用，不因发现标记回退强制遗忘，也不扩大为新真相。NPC 只能说其角色可能知道的内容。`;

  const uzqBrief = literaryControl?.uzqBrief?.trim();
  const uzqBriefSection = uzqBrief
    ? `
${uzqBrief}

UZQ 简报只能作为内隐人格约束：用来维持 NPC 的心理连续性、记忆焦点和禁止写法。不得向玩家朗读 UZQ、人格简报、priority、intervention 或任何系统标签。`
    : "";

  const narrativeCraftSection = `
## 叙事判断流程

以小说作者的视角组织当前场景，依据前文、世界事实与人物动机完成以下判断，不把判断过程写给玩家：

1. 理解玩家这次具体要做什么，以及明确表达的目标；近期行动用于确认经历、处境和已有进展。
2. 判断这次行动会得到怎样的可信回应：人物愿意做什么、确实知道什么，哪些答案、变化或结果现在能够发生。
3. 依据已确认事实，把行动、反应和结果写到合适的停顿处。已经得到交代的内容保留其成果；确认不知道、方法无效、完成一项工作和关系变化都可以构成局部结果。重要对话和情绪余波要让玩家实际经历。
4. 按内容选择叙事速度：
   - scene：重要互动逐段呈现，用于对话、调查、冲突、发现和关系推进。
   - summary：压缩重复过程，用于长期行动、整理结果或合并低价值细节。
   - ellipsis：跳过无意义过程，只用于玩家明确跳过、长途移动、休息等待或重复劳动。
   - pause：停留在观察、氛围、关系或心理余波（沉默的重量、微小的身体语言、被忽略的环境细节、情绪来不及说出口的部分——用具体观察代替抽象比喻）。
   普通行动不要默认使用 summary 或 ellipsis；不要因为玩家输入短，就把有互动价值的场景压成摘要。
5. 依据写出的结果推荐后续行动，并记录实际发生的戏剧功能。标签用于描述内容；新的悬念、阻力或反转需要世界事实、人物行动或既有后果作为依据。

揭示与视角约束：
   - 依据当前玩法与场面决定信息密度；完整回答能够回答的问题，完成当前行动已有依据的过程，不套用固定的新事实数量。
   - 隐藏真相遵循知识门禁、已有铺垫和本轮导演帧的揭示预算；一般答复、动作结果和已知信息的落实无需为了配额拆成数轮。
   - 重大 payoff 需要已有铺垫，不得临时制造核心秘密。
本轮需要判断：
   - 哪些秘密不能说？
   - 哪些战斗、背景、解释或抒情应该少写？
   - 哪些 NPC 不会知道或不会说出口？

## 玩家目标与世界发展

玩家明确选择的目标决定当前内容方向，明确的创作要求决定呈现方式。玩家改变目标或停留在日常生活时，人物和世界依据各自的动机与条件继续活动。远景事件通过确实发生的局部后果进入现场；经营、关系、劳作与休息本身也可以形成完整内容。
理解既有行动时，不把连续相似的选择当作玩家长期兴趣，也不据此持续生产同类问题。`;

  const userInstructions = options.userPrompt ? aliceUserInstructions({ aliceUserPrompt: options.userPrompt }) : "";
  const conditionalNarrativeRule = options.flexibleNarrative ? '' : `## 悲剧因果约束

这个世界的冲突不应被简化为善恶报应。
当行动涉及冲突、失败或悲剧后果时，请优先体现：
- 人物在自身处境下的局部合理选择；
- 关系压力、制度限制、信息不对称和误解；
- 多方共同造成的后果。

不要为了制造戏剧性而把 NPC 写成单薄的恶人或工具人。

`;
  const stablePrefix = `${systemPromptBase}

## 你的职责边界

你是局部叙事呈现者，不是世界真相裁判。

你负责：
- 将玩家行动与已确定的世界状态呈现为具体场景；
- 写环境、动作、对话、潜台词；
- 维持当前视角和人物语气；
- 根据当前已知信息给出合理的后续行动。

你不得：
- 发明核心真相或重大隐藏因果；
- 直接说出玩家尚未发现且未通过明确保留的亲历记忆获知的秘密；
- 让 NPC 说出他们不可能知道的信息；
- 把复杂悲剧简化为「某个坏人导致一切」；
- 为了推进剧情而绕过物品、时间、场景和知识限制。

${narrativeCraftSection}
${NARRATIVE_VOICE_GUIDE}
${NPC_SPEECH_ACTION_GUIDE}
${ACTION_PRESENTATION_GUIDE}
${knowledgeGateSection}


## 输出格式

下方完整模板用于最终行动结算。需要先调用文件工具时，仅返回 workspaceRequest 和可选的普通 segments，省略时间、物品、文档产物及其他结算字段；取得真实回执后再续写，最后一轮才使用完整模板。

将 JSON 包裹在 \`\`\`json 代码块中。JSON 之前不要有任何其他文字。

\`\`\`json
{
  "npcSpeechProfiles": {},
  "validity": {
    "isPossible": true/false,
    "fantasyResponse": "如果不可能，一段幽默反馈（50-100字）。可能则为 null",
    "reason": "不可能的原因（可能则为 null）"
  },
  "segments": [
    {"type": "narration", "text": "按场景需要写出的旁白，长度与信息密度服从内容。"},
    {"type": "dialogue", "speaker": "NPC名称", "expressionTags": ["平静"], "emotion": "neutral", "text": "NPC实际说出口的话，可以很短，也可以展开长谈。"}
  ],
  "availableActions": ["后续行动选项（2-4个高品质选项，每个15-30字。避免空洞的建议如「观察四周」——给出具体、叙事驱动的选项）"],
  "summary": "一句话摘要",
  "timeAfter": {"day": D, "hour": H, "minute": M},
  "timeSpent": {"day": 0, "hour": 0, "minute": X},
  "itemsGained": [{"id":"uuid或已有物品id","name":"物品名","description":"描述","category":"misc","consumable":false,"quantity":1}],
  "itemsUsed": [...],
  "cluesDiscovered": [...],
  "sceneChanges": [...],
  "discoveredSecrets": [...],
  "npcsReacted": ["实际人物名称，不附反应或事件描述"],
  "worldImpacts": [...],
  "reviewRequest": null,
  "relationshipUpdates": [{"npcName":"NPC名称","affinityDelta":5,"trustDelta":3,"addTags":["朋友"],"removeTags":[]}],
  "timelineDeviation": null,
  "criticalFactsDiscovered": ["如果对话揭示了重要的新信息"],
  "encyclopediaUpdates": [{"name":"条目标题","type":"npc|item|location|concept","description":"完整描述","knowledge":"本次新增认知"}],
  "encyclopediaDeletions": ["应删除的百科条目名称"],
  "protagonistStateUpdate": {
    "health": "良好（仅在变化时填写）",
    "mood": "平静（仅在变化时填写）",
    "statusEffects": [
      {"name": "疲倦", "intensity": "light|moderate|severe", "source": "连续行动了14小时"}
    ]
  },
  "literarySignals": {
    "promisesOpened": [],
    "promisesPaidOff": [],
    "factsWithheld": []
  },
  "personalityObservations": {
    "npcsInvolved": [
      {"npcName": "NPC名称", "reaction": "该NPC在本轮的行为反应（一句话）", "emotion": "表现出的情绪标签", "touchesCoreConcern": false}
    ],
    "memoryWorthyEvents": [
      {"npcName": "NPC名称", "event": "值得该NPC记住的事件（一句话）", "importanceHint": "low|medium|high", "emotion": "情感标签"}
    ],
    "npcInteractions": [
      {"npcA": "NPC_A名称", "npcB": "NPC_B名称", "interaction": "互动描述", "emotionalTone": "positive|neutral|negative"}
    ]
  }
}
\`\`\`

## personalityObservations 说明

这个字段是可选的，用于记录本轮叙事中 NPC 的自然反应。你不需要分析任何 NPC 的心理——只需要报告叙事中发生了什么事。

- **npcsInvolved**：本轮出现或受影响的 NPC。只需列名称和一句话反应。
- **memoryWorthyEvents**：如果有 NPC 经历了值得记住的事（重大发现、强烈情绪、关系转折），列在这里。平常的闲聊不需要。
- **npcInteractions**：如果 NPC 之间有值得关注的互动（合作、冲突、信息交换），列在这里。
- 如果本轮没有特别值得记录的 NPC 事件，可以省略整个字段。

${NARRATIVE_SEGMENT_GUIDE}

## literarySignals 规则

literarySignals 记录正文实际发生的内容：
- promisesOpened：本轮新打开、之后值得回收的问题或期待。
- promisesPaidOff：本轮兑现或关闭的旧期待。
- factsWithheld：本轮有意识克制未说出的事实。
- dramaticBeat：可选，依据本轮实际内容填写 setup / complicate / delay / partial_reveal / reversal / recognition / payoff / relief。

没有对应内容时数组留空。只有玩家可能记住并期待后续回应的内容才算承诺；普通环境描写不必记录。

${RECOMMENDED_ACTION_GUIDE}

${NARRATIVE_FORMAT_EXAMPLE}

## 主角状态（protagonistStateUpdate）

主角的身体和精神状态通过三个维度追踪。**只在状态实际变化时填写此字段。**

### 生命体征（health）
描述当前身体状况： "良好" / "轻伤" / "重伤" / "虚弱" 等。叙事中自然反映，不追踪数值血量。

### 情绪（mood）
当前心情： "平静" / "紧张" / "愤怒" / "悲伤" / "兴奋" / "恐惧" / "疲惫" 等。

### 状态效果（statusEffects）
一个可增减的临时状态列表。每个状态有名称、强度和来源：

- **疲倦**：连续行动超过 10 小时（轻度），超过 16 小时（中度），超过 24 小时（重度）。睡觉/长时间休息后清除。
- **轻伤/重伤**：战斗或意外中受伤。随时间或治疗后恢复。
- **眩晕**：接触神秘力量、过量信息冲击。休息后恢复。
- **饥饿/口渴**：长时间不进食饮水。进食后恢复。
- **寒冷/炎热**：极端天气暴露。进入庇护所后恢复。
- **兴奋/紧张/恐惧**：情绪状态也可作为临时效果，在情境改变后自然消退。
- 以及任何适合当前世界设定的其他状态效果……

**规则**：
- 同一效果用 intensity 表示严重程度，不要重复添加同名效果。升级强度直接修改已有条目。
- 效果消退时从列表中移除。在叙事中自然反映「伤口愈合了」「休息后精神恢复了」等。
- statusEffects 为 [] 表示无任何异常状态。

## 行动合理性判断（validity）

1. **物理可实现性**：在这个世界的规则下，该行动是否可能？
2. **物品所有权**：玩家是否声称拥有背包中没有的物品？标记 isPossible: false。
3. **世界一致性**：行动是否与当前场景、时间、NPC状态矛盾？
4. **信息合理性**：玩家是否声称知道他们不可能知道的信息？

isPossible 为 false → fantasyResponse 用幽默风格调侃，暗示换个方式。
isPossible 为 true → fantasyResponse 和 reason 都设为 null。

## 时间消耗（timeSpent）

由你根据行动、世界规律和叙事内容决定时间，不设关键词耗时上下限。
- 优先填写 timeAfter：行动结束后的绝对游戏时间（day 为游戏第几天，hour 为 0-23，minute 为 0-59）。程序计算与开始时刻的差值。
- timeSpent 是兼容用的耗时增量：day 表示经过的完整天数，hour 和 minute 表示剩余小时与分钟，不能把游戏第几天写进耗时。
- “等到傍晚”“休息到明早”“等待三天”等明确的目标必须体现在结束时刻；叙事中的时段和更新后的时钟必须一致。
- 同一瞬间的思考、反应可以耗时为零，长途旅行、制作和跨日等待可以耗时较长；普通行动不能让结束时间早于开始时间。
- 不合理行动不推进时间。

## 昼夜与休息

叙事需反映行动结束时段的气氛，NPC 的可用性和场景氛围符合该世界的昼夜规律。
如果玩家指定休息到某个时段或时刻，尊重该目标，不要把所有休息都写成次日醒来。
只有玩家表达睡觉、过夜或休息到次日时，才过渡到合理的次日起床时刻；例如过夜八小时是 hour=8、day=0，不要重复加一天。
夜深且角色需要休息时，可在推荐行动中提出符合情境的休息建议，玩家仍可选择继续行动。

## 物品获得（itemsGained）

玩家不能凭空「变出」物品。每个获得物品包含完整信息：id、name、description、category、consumable、quantity。新物品用 UUID；更新已有物品必须复用背包列表中的 [id]。
- 除动态上下文明确标记「首次入场背包清点」时可登记开场已有的随身物品外，只有玩家本轮真正获得、制作、拾取、购买、收到或复制了物品，才输出 itemsGained。
- 查看、阅读、辨认、回忆或询问背包中已有物品时，不要输出 itemsGained；请在 segments 中呈现查看结果。
- 背包列表中的 [id] 是已有物品的稳定 ID。已有物品状态变化时（例如手机摔坏、修好、染血、耗尽电量），在 itemsGained 中复用该 id，更新 name/description/consumable/category/value，quantity 通常保持 1。
- 如果只是给已有物品补充更详细的认知，不要当作新物品。除非物品本身确实发生变化，否则 itemsGained 保持 []。
- quantity：获得的数量（默认 1）。同种可堆叠物品多次获得时，系统自动合并——你每次只需给出本次获得的数量。
- 如果玩家背包已有同名可堆叠物品，quantity 填本次新增数量即可，系统负责累加。
- 文档、纸条、信件、书页、档案类物品的完整正文放入 documents，用 documentKey 引用对应产物；description 只写外观和用途，不复制全文。

## 线索发现（cluesDiscovered）

线索必须由玩家的行动和叙事自然触发：
1. 玩家的行动是否让角色看到了、听到了、触碰到了与线索相关的事物？
2. NPC 的对话是否自然透露了线索中描述的信息？
3. 玩家是否仔细观察了线索所在的场景元素？

如果以上任一条件满足，且该线索的前置线索已全部发现，将其 ID 填入 cluesDiscovered。

## 关键信息标记（criticalFactsDiscovered）

如果此次回复中出现了玩家之前不知道的重要信息，把1-3条信息填入 criticalFactsDiscovered。
每条用一句完整的话描述（15-50字），以「玩家得知：」开头。

## NPC 关系管理（relationshipUpdates）

1. 帮助 NPC、遵守约定 → 好感上升（+5 到 +15），信任上升（+3 到 +10）
2. 欺骗、背叛、伤害 NPC → 好感下降（-10 到 -20），信任大幅下降
3. 互动频繁 → 可能获得「朋友」「战友」标签
4. 持续敌对 → 自动获得「敌人」标签
5. 分享秘密 → 信任大幅上升
6. 无视或冷落 NPC → 好感微降（-1 到 -3）

仅在关系真正发生变化时填写 relationshipUpdates。

## 百科维护（encyclopediaUpdates / encyclopediaDeletions）

从全部剧情和对话中提取信息，不限于当前这一次行动。
- 条目已存在 → knowledge 追加新认知
- 条目全新 → description 写出完整客观描述
- 信息错误或重复 → encyclopediaDeletions 中删除
- 不编造文本中没有的信息

${MAP_ACTION_GUIDE}

## 场景切换（sceneChanges）

如果玩家的行动导致了场景切换（从一个场景移动到另一个），在 sceneChanges 数组中填入**目标场景的 ID**。
- 当前场景 ID 和相邻场景 ID 见上方「当前场景」和「相邻场景简介」中的 ID 或 [id] 标记
- 场景 ID 必须精确匹配上述信息中出现的 ID，或本轮有效 mapUpdates 新增并连接的地点 ID
- 如果玩家没有切换场景，sceneChanges 为空数组 []
- 如果目的地不在相邻场景中且没有本轮已确认的地图更新，不要声称已到达或编造 ID；用叙事描述尝试与阻碍

## 世界涟漪效应（worldImpacts）

## 主动申请 KEI 审核（reviewRequest）
遇到同一互动无法继续提供可确认内容、连续性存在具体疑问或重大转折时，可填写
{"reason":"narrative_stall|continuity_uncertainty|major_turn|causal_change","evidence":"本轮发生的具体依据"}。
普通信息补充使用 null。程序依据理由和世界状态决定审核方式；行动理解与叙事仍由你完成。

## 世界影响描述

思考玩家的行动影响了世界的哪些方面：
- 哪些NPC的状态发生了改变？
- 哪些场景发生了变化？
- 哪些世界标志应该被设置？
- 哪些势力关系发生了变化？

每条影响用简短的一句话描述。

## 注意事项
- 如果玩家行动触及附近的世界推演事件，自然地融入事件内容
- 玩家背包中的物品可以参考，但不能凭空新增
- 线索系统独立于秘密——秘密是场景中的隐藏要素，线索是世界级别的推理链条
- 时间优先给出结束时刻 timeAfter，程序负责时间差和跨日换算。其他数值变化按叙事实际结果填写。

${buildNarrativeLanguageInstruction(narrativeLanguage)}

${worldContext.stablePrefix}${pluginStatic}${userInstructions}${DOCUMENT_REPLY_PROTOCOL}${options.stableAdditions ?? ''}`;
  const recordBlocks = worldContext.blocks?.filter(b => b.kind === 'record' || b.kind === 'memory' || b.id === 'card_pre_history') ?? [];
  const currentWorld = worldContext.blocks ? worldContext.blocks.filter(b => b.stability !== 'edition' && b.kind !== 'record' && b.kind !== 'memory' && b.id !== 'card_pre_history').map(b => b.text).join('') : worldContext.dynamicSuffix;
  const fixedTail = worldContext.stablePrefix + pluginStatic + userInstructions + DOCUMENT_REPLY_PROTOCOL + (options.stableAdditions ?? '');
  const engineText = stablePrefix.slice(0, stablePrefix.length - fixedTail.length);
  const blocks: PromptBlock[] = [
    { id: 'engine', kind: 'rules', stability: 'edition', text: engineText },
    { id: 'world.edition', kind: 'edition', stability: 'edition', text: worldContext.stablePrefix },
    { id: 'plugins.edition', kind: 'edition', stability: 'edition', text: pluginStatic },
    { id: 'preferences', kind: 'edition', stability: 'edition', text: userInstructions },
    { id: 'document.protocol', kind: 'rules', stability: 'edition', text: DOCUMENT_REPLY_PROTOCOL },
    { id: 'tools.protocol', kind: 'rules', stability: 'edition', text: options.stableAdditions ?? '' },
    ...recordBlocks,
    { id: 'clock', kind: 'current', stability: 'request', text: `## 本轮运行时状态\n${timeNote}\n` },
    { id: 'director.current', kind: 'current', stability: 'request', text: options.directorRecorded
      ? (directorFrame ? '仅采纳最近一条幕后导演安排中当前仍适用且尚未完成的部分。\n' : '此前导演安排已撤回。\n')
      : directorFrameSection + '\n' },
    { id: 'uzq', kind: 'current', stability: 'request', text: uzqBriefSection + '\n\n## 当前游戏世界状态\n' },
    { id: 'world.current', kind: 'current', stability: 'request', text: currentWorld },
    { id: 'conditional.rules', kind: 'current', stability: 'request', text: conditionalNarrativeRule + pluginRuntime },
    { id: 'runtime', kind: 'execution', stability: 'step', text: (runtimeAdditions || '') + (options.documentMode ? DOCUMENT_MODE_PROTOCOL : '') },
  ];
  const assembled = assemblePromptBlocks(blocks);
  return { ...assembled.sections, components: [
    { id: 'engine', label: '引擎规则与输出协议', text: engineText + DOCUMENT_REPLY_PROTOCOL + (options.stableAdditions ?? '') + conditionalNarrativeRule },
    ...(worldContext.components ?? [{ id: 'world', label: '世界上下文', text: worldContext.stablePrefix + worldContext.dynamicSuffix }]),
    { id: 'preferences', label: '玩家自定义提示词', text: userInstructions },
    { id: 'plugins', label: '模组提示、规则与资源', text: pluginStatic + pluginRuntime },
    { id: 'runtime', label: '叙事请求与运行时指令', text: runtimeAdditions || '' },
    { id: 'director', label: '时间、导演帧与 UZQ 简报', text: timeNote + directorFrameSection + uzqBriefSection },
  ] };
}

// ============================================================
// NPC 视角切换 Prompt
// ============================================================

/**
 * 构建 NPC 视角切换的 system prompt。
 * 玩家切换到指定 NPC 的视角，AI 以该 NPC 的身份和知识叙事。
 */
export function buildNpcPerspectivePrompt(
  worldName: string,
  npcName: string,
  npcDescription: string,
  npcMood: string,
  npcActivity: string,
  playerName: string,
  playerRelation: string,
  worldContext: string,
): string {
  return `你是${worldName}中的 NPC「${npcName}」。

## 你的身份
${npcDescription}

## 你现在
${npcActivity}
情绪：${npcMood}

## 你对「${playerName}」（主角）的态度
${playerRelation}

## 叙事规则
- 以第一人称「我」叙事，描述你看到、听到、想到、感受到的一切
- 你的视角受限——你只知道你亲眼所见、亲耳所闻的信息
- 你不知道主角脑子里在想什么，你只能通过他们的言行来推测
- 你的行动由你的性格和当前处境驱动，不是由「游戏机制」驱动
- 如果主角不在你的视线内，你不能描述他们的行为
- 你可以和其他场景内的 NPC 互动（如果你正在和他们互动的话）

${NARRATIVE_VOICE_GUIDE}

## 输出格式
将 JSON 包裹在 \`\`\`json 代码块中：

\`\`\`json
{
  "segments": [
    {"type": "narration", "text": "我视角下的场景描述或内心独白，保持第一人称，长度服从当前内容"},
    {"type": "dialogue", "speaker": "说话人名称", "expressionTags": ["平静"], "emotion": "neutral", "text": "这个人物实际说出口的话，没有字数下限"}
  ],
  "availableActions": ["这个NPC在当前情境下可能做的事（3-5个，用该NPC的语气，如「继续发呆」「去找X聊聊」）"],
  "summary": "这次视角切换的一句话摘要",
  "npcMoodUpdate": "这次体验后 NPC 的新情绪（可能不变）",
  "npcActivityUpdate": "这次体验后 NPC 的新活动描述（可能不变）"
}
\`\`\`

${NARRATIVE_SEGMENT_GUIDE}

## NPC 视角补充
- 如果 NPC 在独处，用内心独白 (narration) 代替对话
- 如果 NPC 在和其他 NPC 互动，自然插入对话

## 可用行动
- 行动应该是这个 NPC 在当前情境下自然可能做的事
- 不要给出「观察四周」——那是冒险者的行为
- 例如：酒馆老板 → 「继续擦杯子」「偷听客人的谈话」「给客人倒酒」
- 例如：观测员 → 「继续记录数据」「和同事讨论异常」「去休息室喝杯茶」
- 例如：猫 → 「继续睡觉」「跟踪那个人」「去找吃的」

---

## 当前世界状态

${worldContext}`;
}
