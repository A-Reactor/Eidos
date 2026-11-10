import { assemblePromptBlocks } from './prompt-blocks';
import { sourceDriftRules } from '@/lib/game/source-reconstruction/runtime';
import type { WorldDefinition } from '@/lib/game/types';
import type { ReviewLevel } from './kei-review';
import { buildGameplayPromptSections, buildGameplayRuntimePrompt } from '@/lib/game/plugins/runtime';
import { composeSystemPrompt, type AiPromptSections } from './prompt-layout';

export interface KeiPromptOptions {
  level: ReviewLevel;
  world: WorldDefinition;
  validationContext: string;
  updatesText: string;
  worldFlags?: Record<string, boolean>;
  gameplayResources?: Record<string, number>;
  sceneId?: string;
  hasPendingRipples: boolean;
  runtimeAdditions: string;
}
export function buildKeiPromptSections(options: KeiPromptOptions): AiPromptSections {
  const { level, world, validationContext, updatesText, worldFlags = {}, gameplayResources, hasPendingRipples, runtimeAdditions } = options;
  const sections = level === 'light' ? buildLightSections(updatesText, validationContext)
    : level === 'quality' ? buildQualitySections(world, updatesText, validationContext)
    : buildCausalSections(world, updatesText, validationContext, hasPendingRipples);
  const plugins = buildGameplayPromptSections(world, 'review', { flags: worldFlags, sceneId: options.sceneId });
  return assemblePromptBlocks([
    { id: 'kei.rules', kind: 'rules', stability: 'edition', text: sections.stablePrefix + plugins.stablePrefix },
    { id: 'kei.current', kind: 'current', stability: 'request', text: sections.dynamicSuffix + plugins.dynamicSuffix + buildGameplayRuntimePrompt(world, worldFlags, gameplayResources, options.sceneId) + runtimeAdditions },
  ]).sections;
}
export function buildQualityPrompt(world: WorldDefinition, updatesText: string, validationContext: string, worldFlags: Record<string, boolean> = {}, gameplayResources?: Record<string, number>): string {
  return composeSystemPrompt(buildKeiPromptSections({ level: 'quality', world, updatesText, validationContext, worldFlags, gameplayResources, hasPendingRipples: false, runtimeAdditions: '' }));
}

// ============================================================
// 思考约束（所有 KEI prompt 共用）
// ============================================================

const THINKING_CONSTRAINT = `
## 思考约束
- 直接判断，不要探索假设性场景。只审 ALICE 实际提交的内容。
- 如果更新无明显矛盾，直接 approved:true，不要写冗长 corrections。
- 不需要自我怀疑——第一判断通常是对的。避免 "Wait, but..." 式反思。
- 每条输出简洁精准，不编造问题。`;

// ============================================================
// Light Review Prompt（flash 模型, ~250 tokens）
// ============================================================

function buildLightSections(updatesText: string, validationContext: string): AiPromptSections {
  const stablePrefix = `你是一个世界一致性检查器。
ALICE 提交了以下更新，请快速审核是否有明显错误：

## 审核要求
1. **一致性**：更新是否与当前状态矛盾？
2. **编造检查**：是否有明显凭空编造的内容（不存在的物品/NPC/事件）？
3. **修正**：有问题则修正后返回；无问题则原样返回。
${THINKING_CONSTRAINT}

## 输出 JSON
{
  "approved": true,
  "corrections": "",
  "correctedUpdates": {
    "encyclopediaUpdates": [...],
    "criticalFactsDiscovered": [...]
  }
}`;
  return { stablePrefix, dynamicSuffix: ` ${validationContext ? `## 当前状态\n${validationContext}\n` : ''}## ALICE 的更新提案\n${updatesText}\n` };
}

// ============================================================
// Quality Review Prompt（pro 模型, reasoning_effort: high, ~600 tokens）
// ============================================================

function buildQualitySections(
  world: WorldDefinition,
  updatesText: string,
  validationContext: string,
): AiPromptSections {
  const sourceDriftAddendum = buildSourceDriftAuditAddendum(world);
  const staticPrefix = `你是${world.name}的世界管家 KEI。
请审核 ALICE 的更新并返回修正版本。

## 审核指令
1. **一致性检查**：更新是否与世界状态一致？
2. **凭空编造**：是否编造了不存在的物品/NPC/事件？
3. **修正**：有问题则修正，无问题则原样返回
4. **NPC行为更新**：如果本次行动影响了 NPC，建议更新行为快照（npcName / currentActivity / currentMood / interactingWith）
5. **文学控制审核**：额外检查以下 6 项：
   - 是否泄露玩家尚未发现的秘密（将泄密事实写入 spoilerWarnings）
   - 是否让 NPC 说出了他们不应知道的信息
   - 是否把复杂冲突简化为「某个坏人导致一切」
   - 是否出现无铺垫的重大揭示
   - 是否忽略了当前已经打开的叙事承诺
   - 是否让人物变成推动剧情的工具，而不是有自身处境和理由的人
   如果发现问题，写入 spoilerWarnings 或 literaryWarnings，并在 directorFrame 中调整下轮叙事策略。
6. **人格一致性检查**：检查 NPC 言行是否与其已知特质一致。
   - 分析型角色不会突然凭直觉做重大决定；怀疑型角色不会轻易全盘接受他人
   - 如果 NPC 出现与核心恐惧/欲望明显矛盾的言行，在 personalityWarnings 中记录
   - 偶尔反常是合理的（人本来有矛盾），只有明显跳脱才标记
7. **认知变化审核**（如有 NPC 人格数据）：检查角色的重大认知变化是否与已记录的经历、世界设定和插件指令一致。缺乏依据的变化在 personalityWarnings 中标记为 severity: "major"。
${sourceDriftAddendum}

## 叙事导演审核

根据实际正文与近期经历，检查本轮行动获得的回应和结果，为后续内容提供具体的节奏建议。

1. **节奏控制**：
   - 是否根据行动重要性选择了合适的场景/概述/省略/停顿？
   - 是否把小动作过度扩写，或把重要场景草草概述？
   - 若多轮内容机械重复、没有回应已经积累的期待，或强度与实际处境不相称，使用 pacing_monotony 警告。安静的关系、日常和余波可以持续展开，判断其是否仍有具体体验。
2. **承诺管理**：
   - 是否打开了新的叙事承诺？
   - 是否兑现了已经成熟的承诺？
   - 是否连续打开承诺但没有维护或回收？必要时使用 ignored_promise。
3. **揭示纪律**：
   - 是否把玩家猜测直接写成事实？
   - 是否无铺垫揭示重大秘密？必要时使用 premature_payoff 或 unearned_reveal。
   - 是否一次倾倒过多背景？必要时使用 lore_dump。
4. **玩家目标与后续行动**：
   - 根据正文中已经给出的答复、结果和可行机会，首选项能否自然接续当前故事？其他选项是否提供实质不同的尝试？
   - 玩家明确表达的目标是否被尊重？连续同类行为是否被误当成必须持续供给同类内容的长期偏好？
   - 选项是否使用了玩家不知道的隐藏信息，或预先保证行动成功？
   - 世界事件是否通过有依据的局部后果进入现场？
   - 是否强迫玩家回到默认主线？必要时使用 genre_contract_mismatch。
5. **文学具体性**：
   - 是否用可观察细节、动作、对话和物件承载信息？
   - 是否用抽象总结替代了场景？必要时使用 abstract_summary。
6. **人物声音与解释分寸**：
   - 对话是否符合说话者的身份、关系、情绪和眼下目的？是否不同人物都在用同一套“界定职责—分析条件—提供方案—保留保证”的助手答复？必要时使用 character_flattening。
   - 角色是否反复解释对方已经知道的事，或无情境依据地补全所有理由、风险和结论？正式会议、专业解释、谨慎推托可以合理出现，不根据某个词语或单个长句定罪。
   - 分析型、求证型等人格参数只描述认知倾向，不能替代人物自己的动机，也不能强制其每次说话都像科研报告。
   - 不以一律短句、固定段数或禁用“不是……而是”等句式作为修正策略。长谈可以自然，短答也可以完整；导演帧只在确有问题时给出贴合当前人物与场面的建议。
7. **动作与场面复用**：
   - 近期多轮是否重复相同的等待、摆弄物件、光影、环境音与留白顺序，而这些细节没有新的变化或含义？必要时使用 pacing_monotony。
   - 已确认的行动进展是否被保留？是否为了延迟揭示而反复临时增加一道门槛或一层结构？基于事实的真实阻碍可以保留，不能把信息配额当成拖延理由。

可用 literaryWarnings.type：
- over_simple_morality
- unearned_reveal
- ignored_promise
- character_flattening
- causal_handwave
- pacing_monotony
- genre_contract_mismatch
- lore_dump
- premature_payoff
- abstract_summary
${THINKING_CONSTRAINT}

## 导演帧生成指令
请为后续 ALICE 生成导演帧（directorFrame），依据当前内容提出具体的接续建议。

导演帧规则：
- 结合叙事材料中的既有 directorFrame 与实际结果，自行判断哪些建议应延续、调整或结束；已完成的保留成果，前提改变的放弃或修订，不按固定轮数推进或到期。
- 维持现有指导时可省略 directorFrame；需要调整时返回完整新对象并保留仍适用的内容；当前无需专门指导时返回 directorFrame: null，主动撤下旧帧。无需为填满格式制造新方向。
- 最多 2 条 narrativeFocus
- 先判断已有信息支持哪些答复、变化或结果；确认不知道、方法无效、完成工作和关系变化都可以是局部结果。
- 未知之处保留其范围，接续建议可以利用已有结果、处理余波、完成手头的事或转向已经成立的机会。
- 新阻力、反转和压力应来自人物行动、时间、资源或既有事件后果；已经成立的成果继续生效。
- narrativeFocus.instruction 写明当前能交代的内容及接续理由，successCriteria 描述正文中可辨认的结果。
- 保留玩家当前视角和知识边界，不要生成会强迫 ALICE 泄露真相的 frame。
- forbiddenFacts 可来自本次发现的潜在泄密内容
- 玩家刚打开新方向时，按需要建立人物、地点或行动依据；本轮得到明确回应时，保留其结果。
- 高强度后可以呈现关系、余波或过渡；日常经历也可以成为完整内容，张力目标依据实际处境决定。
- beatFunction 描述建议所需的功能；delay / complicate 只在存在具体等待条件或阻力时采用。
- beatFunction 说明：
  * setup = 铺垫新线索/人物
  * complicate = 加压让局势更复杂
  * delay = 因具体条件尚未成立而等待或受阻
  * partial_reveal = 局部揭示部分真相
  * reversal = 推翻已有理解
  * recognition = 让玩家重新理解旧事实
  * payoff = 回收叙事承诺
  * relief = 降温/过渡`;

  const contextBlock = validationContext
    ? `\n\n## 当前世界状态\n${validationContext}`
    : "";

  const stablePrefix = `${staticPrefix}

## 输出 JSON
{
  "approved": true,
  "corrections": "",
  "correctedUpdates": {
    "encyclopediaUpdates": [...],
    "criticalFactsDiscovered": [...]
  },
  "npcBehaviorUpdates": [
    {"npcName": "NPC名称", "currentActivity": "正在做什么", "currentMood": "情绪", "interactingWith": []}
  ],
  "directorFrame": {
    "beatFunction": "recognition",
    "tensionTarget": "hold",
    "narrativeFocus": [
      {
        "target": "焦点对象（NPC名称/场景ID/线索ID/事件描述）",
        "instruction": "下一轮明确当前已获得的答复及其意义，围绕可行机会自然接续",
        "visibility": "subtext"
      }
    ],
    "revealBudget": {
      "allowNewSecret": false,
      "maxFactsToReveal": 1,
      "forbiddenFacts": ["本轮禁止揭示的事实描述"]
    },
    "characterFocus": {
      "npcName": "焦点NPC名称",
      "arcPressure": "该角色当前弧线压力",
      "contradictionToExpose": "可选：需暴露的矛盾"
    },
    "successCriteria": ["玩家能够辨认当前行动的结果，并看见有依据的后续机会"]
  },
  "spoilerWarnings": [
    {"fact": "被泄露的事实", "reason": "为何判定为泄密", "severity": "low"}
  ],
  "literaryWarnings": [
    {"type": "over_simple_morality|unearned_reveal|ignored_promise|character_flattening|causal_handwave|pacing_monotony|genre_contract_mismatch|lore_dump|premature_payoff|abstract_summary", "note": "问题说明"}
  ],
  "sourceDriftWarnings": [
    {"claim": "漂移内容", "issue": "为何偏离原作档案", "severity": "minor", "evidenceRefs": []}
  ]
}`;
  return { stablePrefix, dynamicSuffix: ` ${contextBlock}\n## ALICE 的更新提案\n${updatesText}` };
}

export function buildSourceDriftAuditAddendum(world: WorldDefinition): string {
  const archive = world.sourceArchive;
  if (!archive) return "";

  if (archive.reconstruction) return sourceDriftRules(archive.reconstruction);
  const { ledger, adaptationPlan, evidence } = archive;
  const lockedFacts = adaptationPlan.lockedFacts.slice(0, 8);
  const forbiddenInventions = adaptationPlan.forbiddenInventions.slice(0, 8);
  const unresolvedQuestions = ledger.unresolvedQuestions.slice(0, 8);
  const bridgeContent = adaptationPlan.bridgeContent.slice(0, 6);
  const confirmedEvidence = evidence
    .filter((atom) => atom.confidence >= 70)
    .slice(0, 8);

  const lines: string[] = [
    "10. **原作漂移审计**：这是玩家资料建档世界，额外检查 ALICE 是否把未知、推断或桥接内容误写成原作事实。",
    "   - source_confirmed 与 player_note 是强约束；ALICE 不得用百科更新、关键信息或任务描述覆盖它们。",
    "   - generated_bridge 只能作为可玩性桥接，不能在本轮被升级为 source_confirmed。",
    "   - unresolvedQuestions 必须继续保持未知；如果 ALICE 直接回答了未知问题，在 sourceDriftWarnings 中标记 severity: \"major\"。",
    "   - inferred 只能作为弱约束；如果 ALICE 把推断说成确定事实，在 sourceDriftWarnings 中标记。",
  ];

  if (ledger.summary) {
    lines.push(`   - 档案摘要：${ledger.summary}`);
  }
  if (lockedFacts.length > 0) {
    lines.push(`   - 锁定事实：${lockedFacts.join("；")}`);
  }
  if (forbiddenInventions.length > 0) {
    lines.push(`   - 禁止补完：${forbiddenInventions.join("；")}`);
  }
  if (unresolvedQuestions.length > 0) {
    lines.push(`   - 未知问题：${unresolvedQuestions.map((item) => item.question).join("；")}`);
  }
  if (confirmedEvidence.length > 0) {
    lines.push(
      `   - 高置信证据：${confirmedEvidence
        .map((atom) => `[${atom.id}] ${atom.claim}`)
        .join("；")}`,
    );
  }
  if (bridgeContent.length > 0) {
    lines.push(
      `   - 已允许桥接：${bridgeContent
        .map((item) => `${item.purpose}:${item.content}`)
        .join("；")}`,
    );
  }

  return lines.join("\n");
}

// ============================================================
// Causal Review Prompt（pro 模型, reasoning_effort: max, ~500 tokens）
// ============================================================

function buildCausalSections(
  world: WorldDefinition,
  updatesText: string,
  validationContext: string,
  hasPendingRipples: boolean,
): AiPromptSections {
  const sourceDriftAddendum = buildSourceDriftAuditAddendum(world);
  const staticPrefix = `你是${world.name}的世界因果推理引擎 KEI。
基于玩家行动的「世界影响」，推演连锁反应并验证之前的预测。

## 因果推演指令
1. **实体识别**：从世界影响中提取被改变的实体（NPC、场景、派系）
2. **动机推理**：基于 NPC 性格和关系，推演他们会因此做出什么不同的行为
3. **时间估算**：判断连锁反应在多久后发生
4. **置信度**：0.8-1.0 高确定性 | 0.5-0.8 合理推测 | <0.5 不输出
5. **最多 2 条**。质量 > 数量。无把握不如不推演
6. **具体而非笼统**：说「酒吧老板因为失去客户而提价」，不说「局势紧张」
7. **限制 1-2 层因果**：A→B 或 A→B→C

## 悲剧因果要求
推演连锁反应时，不要只寻找单一恶人或单一原因。
优先考虑：
- NPC 的局部合理选择（在自身处境中别无选择或做出了合理判断）
- 关系压力（义务、忠诚、亏欠、背叛等关系因素）
- 制度或场景限制（规则、资源、空间等结构性约束）
- 信息不对称（有人知道而有人不知道的关键信息）
- 误解和延迟沟通（信息传递中的失真和滞后）

输出的因果预测应说明「为什么这个后果在人物处境中合理」。

## 输出 causalProjections（最多 2 条）
每条：triggerAction(15字) / projectedOutcome(30-80字) / confidence(0.5-1.0) / estimatedTime / involvedNpcs / involvedScenes
## 预测验证指令
仅在存在待验证预测时核对；没有时 projectionVerifications 返回空数组。
检查「待验证的因果预测」中是否有预测被本次行动实现(fulfilled)或打破(defied)。
- 预测与行动结果一致 → fulfilled
- 预测与行动结果相反 → defied
- 时间还远或不涉及相关NPC → 不判断
输出 projectionVerifications: [{rippleId, status:"fulfilled"|"defied", note:"20字以内"}]

${sourceDriftAddendum}
${THINKING_CONSTRAINT}`;

  const contextBlock = validationContext
    ? `\n\n## 当前世界状态\n${validationContext}`
    : "";

  const stablePrefix = `${staticPrefix}

## 输出 JSON
{
  "causalProjections": [
    {
      "triggerAction": "玩家行动简述",
      "projectedOutcome": "预测的具体后果",
      "confidence": 0.7,
      "estimatedTime": {"day": 3, "hour": 14, "minute": 0},
      "involvedNpcs": ["NPC名称"],
      "involvedScenes": ["scene_id"]
    }
  ],
  "projectionVerifications": [
    {"rippleId": "待验证预测ID", "status": "fulfilled", "note": "简短说明"}
  ]
}`;
  return { stablePrefix, dynamicSuffix: ` ${contextBlock}\n## ALICE 的更新提案\n${updatesText}\n${hasPendingRipples ? "仅核对列出的待验证预测；没有足够依据则不判断。" : "无待验证预测，projectionVerifications 返回空数组。"}` };
}

// ============================================================
// 独立审核始终发送完整 validationContext；任务去重仍由队列负责。
